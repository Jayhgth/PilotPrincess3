// Site-tuned adaptation of React Bits Light Rays (David Haz),
// MIT + Commons Clause. Adds reduced-motion, visibility, and resize controls.
// https://reactbits.dev/backgrounds/light-rays
import { Mesh, Program, Renderer, Triangle } from "ogl";
import { useEffect, useRef, type FC } from "react";

export type RaysOrigin =
  | "top-center"
  | "top-left"
  | "top-right"
  | "right"
  | "left"
  | "bottom-center"
  | "bottom-right"
  | "bottom-left";

interface LightRaysProps {
  raysOrigin?: RaysOrigin;
  raysColor?: string;
  raysSpeed?: number;
  lightSpread?: number;
  rayLength?: number;
  fadeDistance?: number;
  saturation?: number;
  followMouse?: boolean;
  mouseInfluence?: number;
  noiseAmount?: number;
  distortion?: number;
  className?: string;
}

function hexToRgb(hex: string): [number, number, number] {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return match
    ? [parseInt(match[1], 16) / 255, parseInt(match[2], 16) / 255, parseInt(match[3], 16) / 255]
    : [1, 1, 1];
}

function placement(origin: RaysOrigin, width: number, height: number) {
  const outside = 0.2;
  switch (origin) {
    case "top-left": return { anchor: [0, -outside * height], direction: [0, 1] };
    case "top-right": return { anchor: [width, -outside * height], direction: [0, 1] };
    case "left": return { anchor: [-outside * width, 0.5 * height], direction: [1, 0] };
    case "right": return { anchor: [(1 + outside) * width, 0.5 * height], direction: [-1, 0] };
    case "bottom-left": return { anchor: [0, (1 + outside) * height], direction: [0, -1] };
    case "bottom-center": return { anchor: [0.5 * width, (1 + outside) * height], direction: [0, -1] };
    case "bottom-right": return { anchor: [width, (1 + outside) * height], direction: [0, -1] };
    default: return { anchor: [0.5 * width, -outside * height], direction: [0, 1] };
  }
}

const vertexShader = `
attribute vec2 position;
varying vec2 vUv;
void main() {
  vUv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}`;

const fragmentShader = `
precision highp float;
uniform float iTime;
uniform vec2 iResolution;
uniform vec2 rayPos;
uniform vec2 rayDir;
uniform vec3 raysColor;
uniform float raysSpeed;
uniform float lightSpread;
uniform float rayLength;
uniform float fadeDistance;
uniform float saturation;
uniform vec2 mousePos;
uniform float mouseInfluence;
uniform float noiseAmount;
uniform float distortion;
varying vec2 vUv;

float noise(vec2 point) {
  return fract(sin(dot(point.xy, vec2(12.9898, 78.233))) * 43758.5453123);
}

float rayStrength(vec2 source, vec2 referenceDirection, vec2 coordinate, float seedA, float seedB, float speed) {
  vec2 sourceToCoordinate = coordinate - source;
  vec2 direction = normalize(sourceToCoordinate);
  float angle = dot(direction, referenceDirection);
  float distortedAngle = angle + distortion * sin(iTime * 2.0 + length(sourceToCoordinate) * 0.01) * 0.2;
  float spread = pow(max(distortedAngle, 0.0), 1.0 / max(lightSpread, 0.001));
  float distance = length(sourceToCoordinate);
  float maximumDistance = iResolution.x * rayLength;
  float lengthFalloff = clamp((maximumDistance - distance) / maximumDistance, 0.0, 1.0);
  float fadeFalloff = clamp((iResolution.x * fadeDistance - distance) / (iResolution.x * fadeDistance), 0.5, 1.0);
  float base = clamp(
    (0.45 + 0.15 * sin(distortedAngle * seedA + iTime * speed)) +
    (0.3 + 0.2 * cos(-distortedAngle * seedB + iTime * speed)),
    0.0,
    1.0
  );
  return base * lengthFalloff * fadeFalloff * spread;
}

void main() {
  vec2 coordinate = vec2(gl_FragCoord.x, iResolution.y - gl_FragCoord.y);
  vec2 finalDirection = rayDir;
  if (mouseInfluence > 0.0) {
    vec2 mouseDirection = normalize(mousePos * iResolution.xy - rayPos);
    finalDirection = normalize(mix(rayDir, mouseDirection, mouseInfluence));
  }
  vec4 first = vec4(1.0) * rayStrength(rayPos, finalDirection, coordinate, 36.2214, 21.11349, 1.5 * raysSpeed);
  vec4 second = vec4(1.0) * rayStrength(rayPos, finalDirection, coordinate, 22.3991, 18.0234, 1.1 * raysSpeed);
  vec4 color = first * 0.5 + second * 0.4;
  if (noiseAmount > 0.0) {
    float grain = noise(coordinate * 0.01 + iTime * 0.1);
    color.rgb *= 1.0 - noiseAmount + noiseAmount * grain;
  }
  float brightness = 1.0 - coordinate.y / iResolution.y;
  color.r *= 0.1 + brightness * 0.8;
  color.g *= 0.3 + brightness * 0.6;
  color.b *= 0.5 + brightness * 0.5;
  if (saturation != 1.0) {
    float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    color.rgb = mix(vec3(gray), color.rgb, saturation);
  }
  gl_FragColor = vec4(color.rgb * raysColor, color.a);
}`;

const LightRays: FC<LightRaysProps> = ({
  raysOrigin = "top-center",
  raysColor = "#ffffff",
  raysSpeed = 1,
  lightSpread = 0.5,
  rayLength = 1,
  fadeDistance = 1,
  saturation = 1,
  followMouse = false,
  mouseInfluence = 0.1,
  noiseAmount = 0,
  distortion = 0,
  className = ""
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const renderer = new Renderer({ dpr: Math.min(window.devicePixelRatio, 1.75), alpha: true });
    const gl = renderer.gl;
    gl.canvas.style.width = "100%";
    gl.canvas.style.height = "100%";
    gl.canvas.setAttribute("aria-hidden", "true");
    container.replaceChildren(gl.canvas);

    const uniforms = {
      iTime: { value: 0 },
      iResolution: { value: [1, 1] as [number, number] },
      rayPos: { value: [0, 0] as [number, number] },
      rayDir: { value: [0, 1] as [number, number] },
      raysColor: { value: hexToRgb(raysColor) },
      raysSpeed: { value: raysSpeed },
      lightSpread: { value: lightSpread },
      rayLength: { value: rayLength },
      fadeDistance: { value: fadeDistance },
      saturation: { value: saturation },
      mousePos: { value: [0.5, 0.5] as [number, number] },
      mouseInfluence: { value: reduceMotion ? 0 : mouseInfluence },
      noiseAmount: { value: noiseAmount },
      distortion: { value: reduceMotion ? 0 : distortion }
    };
    const program = new Program(gl, { vertex: vertexShader, fragment: fragmentShader, uniforms });
    const mesh = new Mesh(gl, { geometry: new Triangle(gl), program });
    const pointer = { targetX: 0.5, targetY: 0.5, x: 0.5, y: 0.5 };
    let frame = 0;
    let visible = true;

    const resize = () => {
      const width = Math.max(container.clientWidth, 1);
      const height = Math.max(container.clientHeight, 1);
      renderer.setSize(width, height);
      const pixelWidth = width * renderer.dpr;
      const pixelHeight = height * renderer.dpr;
      uniforms.iResolution.value = [pixelWidth, pixelHeight];
      const next = placement(raysOrigin, pixelWidth, pixelHeight);
      uniforms.rayPos.value = next.anchor as [number, number];
      uniforms.rayDir.value = next.direction as [number, number];
    };

    const render = (time: number) => {
      uniforms.iTime.value = time * 0.001;
      if (followMouse && !reduceMotion) {
        pointer.x += (pointer.targetX - pointer.x) * 0.08;
        pointer.y += (pointer.targetY - pointer.y) * 0.08;
        uniforms.mousePos.value = [pointer.x, pointer.y];
      }
      renderer.render({ scene: mesh });
      if (!reduceMotion && visible) frame = requestAnimationFrame(render);
    };

    const start = () => {
      if (reduceMotion || frame) return;
      frame = requestAnimationFrame(render);
    };
    const stop = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
    };
    const handlePointer = (event: PointerEvent) => {
      const bounds = container.getBoundingClientRect();
      if (!bounds.width || !bounds.height) return;
      pointer.targetX = (event.clientX - bounds.left) / bounds.width;
      pointer.targetY = (event.clientY - bounds.top) / bounds.height;
    };

    const resizeObserver = new ResizeObserver(resize);
    const visibilityObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) start();
      else stop();
    }, { threshold: 0.05 });
    resizeObserver.observe(container);
    visibilityObserver.observe(container);
    if (followMouse && !reduceMotion) window.addEventListener("pointermove", handlePointer, { passive: true });
    resize();
    if (reduceMotion) render(0);
    else start();

    return () => {
      stop();
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      window.removeEventListener("pointermove", handlePointer);
      container.replaceChildren();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [distortion, fadeDistance, followMouse, lightSpread, mouseInfluence, noiseAmount, rayLength, raysColor, raysOrigin, raysSpeed, saturation]);

  return <div aria-hidden="true" className={`light-rays-container ${className}`.trim()} ref={containerRef} />;
};

export default LightRays;
