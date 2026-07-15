// Site-tuned adaptation of React Bits Color Bends (David Haz),
// MIT + Commons Clause. Uses the app's existing OGL runtime and adds
// reduced-motion, visibility, and bounded-DPR controls.
// https://reactbits.dev/backgrounds/color-bends
import { Mesh, Program, Renderer, Triangle } from "ogl";
import { useEffect, useRef, type CSSProperties, type FC } from "react";

interface ColorBendsProps {
  className?: string;
  style?: CSSProperties;
  rotation?: number;
  speed?: number;
  colors?: string[];
  transparent?: boolean;
  autoRotate?: number;
  scale?: number;
  frequency?: number;
  warpStrength?: number;
  mouseInfluence?: number;
  parallax?: number;
  noise?: number;
  iterations?: number;
  intensity?: number;
  bandWidth?: number;
}

const MAX_COLORS = 8;

function hexToRgb(hex: string): [number, number, number] {
  const normalized = hex.replace("#", "").trim();
  const expanded = normalized.length === 3
    ? normalized.split("").map((character) => character.repeat(2)).join("")
    : normalized;
  if (!/^[\da-f]{6}$/i.test(expanded)) return [0, 0, 0];
  return [0, 2, 4].map((offset) => parseInt(expanded.slice(offset, offset + 2), 16) / 255) as [number, number, number];
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
#define MAX_COLORS ${MAX_COLORS}
uniform vec2 uCanvas;
uniform float uTime;
uniform float uSpeed;
uniform vec2 uRot;
uniform int uColorCount;
uniform vec3 uColors[MAX_COLORS];
uniform int uTransparent;
uniform float uScale;
uniform float uFrequency;
uniform float uWarpStrength;
uniform vec2 uPointer;
uniform float uMouseInfluence;
uniform float uParallax;
uniform float uNoise;
uniform int uIterations;
uniform float uIntensity;
uniform float uBandWidth;
varying vec2 vUv;

void main() {
  float t = uTime * uSpeed;
  vec2 p = vUv * 2.0 - 1.0;
  p += uPointer * uParallax * 0.1;
  vec2 rp = vec2(p.x * uRot.x - p.y * uRot.y, p.x * uRot.y + p.y * uRot.x);
  vec2 q = vec2(rp.x * (uCanvas.x / uCanvas.y), rp.y);
  q /= max(uScale, 0.0001);
  q /= 0.5 + 0.2 * dot(q, q);
  q += 0.2 * cos(t) - 7.56;
  q += (uPointer - rp) * uMouseInfluence * 0.2;

  for (int j = 0; j < 5; j++) {
    if (j >= uIterations - 1) break;
    vec2 rr = sin(1.5 * (q.yx * uFrequency) + 2.0 * cos(q * uFrequency));
    q += (rr - q) * 0.15;
  }

  vec3 col = vec3(0.0);
  float alpha = 1.0;
  vec2 samplePoint = q;
  vec3 sumColor = vec3(0.0);
  float coverage = 0.0;

  for (int i = 0; i < MAX_COLORS; i++) {
    if (i >= uColorCount) break;
    samplePoint -= 0.01;
    vec2 r = sin(1.5 * (samplePoint.yx * uFrequency) + 2.0 * cos(samplePoint * uFrequency));
    float baseDistance = length(r + sin(5.0 * r.y * uFrequency - 3.0 * t + float(i)) / 4.0);
    float boundedWarp = clamp(uWarpStrength, 0.0, 1.0);
    float warpMix = pow(boundedWarp, 0.3);
    float gain = 1.0 + max(uWarpStrength - 1.0, 0.0);
    vec2 warped = samplePoint + (r - samplePoint) * boundedWarp * gain;
    float warpedDistance = length(warped + sin(5.0 * warped.y * uFrequency - 3.0 * t + float(i)) / 4.0);
    float distance = mix(baseDistance, warpedDistance, warpMix);
    float weight = 1.0 - exp(-uBandWidth / exp(uBandWidth * distance));
    sumColor += uColors[i] * weight;
    coverage = max(coverage, weight);
  }

  col = clamp(sumColor, 0.0, 1.0) * uIntensity;
  alpha = uTransparent > 0 ? coverage : 1.0;
  if (uNoise > 0.0001) {
    float grain = fract(sin(dot(gl_FragCoord.xy + vec2(uTime), vec2(12.9898, 78.233))) * 43758.5453123);
    col = clamp(col + (grain - 0.5) * uNoise, 0.0, 1.0);
  }
  vec3 rgb = uTransparent > 0 ? col * alpha : col;
  gl_FragColor = vec4(rgb, alpha);
}`;

const ColorBends: FC<ColorBendsProps> = ({
  className = "",
  style,
  rotation = 90,
  speed = 0.2,
  colors = [],
  transparent = true,
  autoRotate = 0,
  scale = 1,
  frequency = 1,
  warpStrength = 1,
  mouseInfluence = 1,
  parallax = 0.5,
  noise = 0.15,
  iterations = 1,
  intensity = 1.5,
  bandWidth = 6
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const palette = colors.filter(Boolean).slice(0, MAX_COLORS);
    const paddedColors = Array.from({ length: MAX_COLORS }, (_, index) => hexToRgb(palette[index] ?? "#000000"));
    const renderer = new Renderer({ dpr: Math.min(window.devicePixelRatio || 1, 1.75), alpha: true });
    const gl = renderer.gl;
    gl.canvas.style.width = "100%";
    gl.canvas.style.height = "100%";
    gl.canvas.style.display = "block";
    gl.canvas.setAttribute("aria-hidden", "true");
    gl.clearColor(0, 0, 0, transparent ? 0 : 1);
    container.replaceChildren(gl.canvas);

    const uniforms = {
      uCanvas: { value: [1, 1] as [number, number] },
      uTime: { value: 0 },
      uSpeed: { value: reduceMotion ? 0 : speed },
      uRot: { value: [1, 0] as [number, number] },
      uColorCount: { value: palette.length },
      uColors: { value: paddedColors },
      uTransparent: { value: transparent ? 1 : 0 },
      uScale: { value: scale },
      uFrequency: { value: frequency },
      uWarpStrength: { value: warpStrength },
      uPointer: { value: [0, 0] as [number, number] },
      uMouseInfluence: { value: reduceMotion ? 0 : mouseInfluence },
      uParallax: { value: reduceMotion ? 0 : parallax },
      uNoise: { value: noise },
      uIterations: { value: Math.max(1, Math.min(iterations, 5)) },
      uIntensity: { value: intensity },
      uBandWidth: { value: bandWidth }
    };
    const program = new Program(gl, {
      vertex: vertexShader,
      fragment: fragmentShader,
      uniforms,
      transparent: true,
      depthTest: false,
      depthWrite: false,
      cullFace: false
    });
    const geometry = new Triangle(gl);
    const mesh = new Mesh(gl, { geometry, program });
    const pointer = { targetX: 0, targetY: 0, x: 0, y: 0 };
    let frame = 0;
    let visible = true;

    const resize = () => {
      const width = Math.max(container.clientWidth, 1);
      const height = Math.max(container.clientHeight, 1);
      renderer.setSize(width, height);
      uniforms.uCanvas.value = [width * renderer.dpr, height * renderer.dpr];
    };
    const render = (time: number) => {
      const seconds = time * 0.001;
      uniforms.uTime.value = seconds;
      const degrees = rotation + (reduceMotion ? 0 : autoRotate * seconds);
      const radians = (degrees * Math.PI) / 180;
      uniforms.uRot.value = [Math.cos(radians), Math.sin(radians)];
      if (!reduceMotion) {
        pointer.x += (pointer.targetX - pointer.x) * 0.08;
        pointer.y += (pointer.targetY - pointer.y) * 0.08;
        uniforms.uPointer.value = [pointer.x, pointer.y];
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
      pointer.targetX = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
      pointer.targetY = -(((event.clientY - bounds.top) / bounds.height) * 2 - 1);
    };

    const resizeObserver = new ResizeObserver(resize);
    const visibilityObserver = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      if (visible) start();
      else stop();
    }, { threshold: 0.05 });
    resizeObserver.observe(container);
    visibilityObserver.observe(container);
    if (!reduceMotion) window.addEventListener("pointermove", handlePointer, { passive: true });
    resize();
    if (reduceMotion) render(0);
    else start();

    return () => {
      stop();
      resizeObserver.disconnect();
      visibilityObserver.disconnect();
      window.removeEventListener("pointermove", handlePointer);
      program.remove();
      geometry.remove();
      container.replaceChildren();
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    };
  }, [autoRotate, bandWidth, colors, frequency, intensity, iterations, mouseInfluence, noise, parallax, rotation, scale, speed, transparent, warpStrength]);

  return <div aria-hidden="true" className={`color-bends-container ${className}`.trim()} ref={containerRef} style={style} />;
};

export default ColorBends;
