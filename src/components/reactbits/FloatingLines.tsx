// Site-tuned adaptation of React Bits Floating Lines (David Haz),
// MIT + Commons Clause. Adds reduced-motion, visibility, and WebGL fallbacks.
// https://www.reactbits.dev/backgrounds/floating-lines
import { memo, useEffect, useRef, type CSSProperties } from "react";
import {
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderer
} from "three";

const vertexShader = `
precision highp float;

void main() {
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = `
precision highp float;

uniform float iTime;
uniform vec3 iResolution;
uniform float animationSpeed;
uniform vec3 backgroundColor;
uniform float lineOpacity;

uniform bool enableTop;
uniform bool enableMiddle;
uniform bool enableBottom;

uniform int topLineCount;
uniform int middleLineCount;
uniform int bottomLineCount;

uniform float topLineDistance;
uniform float middleLineDistance;
uniform float bottomLineDistance;

uniform vec3 topWavePosition;
uniform vec3 middleWavePosition;
uniform vec3 bottomWavePosition;

uniform vec2 iMouse;
uniform bool interactive;
uniform float bendRadius;
uniform float bendStrength;
uniform float bendInfluence;

uniform bool parallax;
uniform vec2 parallaxOffset;

uniform vec3 lineGradient[8];
uniform int lineGradientCount;

mat2 rotate(float radians) {
  return mat2(cos(radians), sin(radians), -sin(radians), cos(radians));
}

vec3 getLineColor(float progress) {
  if (lineGradientCount <= 0) return vec3(1.0);
  if (lineGradientCount == 1) return lineGradient[0];

  float clampedProgress = clamp(progress, 0.0, 0.9999);
  float scaled = clampedProgress * float(lineGradientCount - 1);
  int firstIndex = int(floor(scaled));
  int secondIndex = min(firstIndex + 1, lineGradientCount - 1);
  return mix(lineGradient[firstIndex], lineGradient[secondIndex], fract(scaled));
}

float wave(vec2 uv, float offset, vec2 screenUv, vec2 mouseUv, bool shouldBend) {
  float time = iTime * animationSpeed;
  float amplitude = sin(offset + time * 0.2) * 0.3;
  float y = sin(uv.x + offset + time * 0.1) * amplitude;

  if (shouldBend) {
    vec2 distanceFromPointer = screenUv - mouseUv;
    float influence = exp(-dot(distanceFromPointer, distanceFromPointer) * bendRadius);
    y += (mouseUv.y - screenUv.y) * influence * bendStrength * bendInfluence;
  }

  float lineDistance = uv.y - y;
  return 0.0175 / max(abs(lineDistance) + 0.01, 0.001) + 0.01;
}

void mainImage(out vec4 fragmentColor, in vec2 fragmentCoordinate) {
  vec2 baseUv = (2.0 * fragmentCoordinate - iResolution.xy) / iResolution.y;
  baseUv.y *= -1.0;
  if (parallax) baseUv += parallaxOffset;

  vec2 mouseUv = vec2(0.0);
  if (interactive) {
    mouseUv = (2.0 * iMouse - iResolution.xy) / iResolution.y;
    mouseUv.y *= -1.0;
  }

  vec3 lines = vec3(0.0);

  if (enableBottom) {
    for (int index = 0; index < bottomLineCount; ++index) {
      float lineIndex = float(index);
      float progress = lineIndex / max(float(bottomLineCount - 1), 1.0);
      float angle = bottomWavePosition.z * log(length(baseUv) + 1.0);
      vec2 rotatedUv = baseUv * rotate(angle);
      lines += getLineColor(progress) * wave(
        rotatedUv + vec2(bottomLineDistance * lineIndex + bottomWavePosition.x, bottomWavePosition.y),
        1.5 + 0.2 * lineIndex,
        baseUv,
        mouseUv,
        interactive
      ) * 0.24;
    }
  }

  if (enableMiddle) {
    for (int index = 0; index < middleLineCount; ++index) {
      float lineIndex = float(index);
      float progress = lineIndex / max(float(middleLineCount - 1), 1.0);
      float angle = middleWavePosition.z * log(length(baseUv) + 1.0);
      vec2 rotatedUv = baseUv * rotate(angle);
      lines += getLineColor(progress) * wave(
        rotatedUv + vec2(middleLineDistance * lineIndex + middleWavePosition.x, middleWavePosition.y),
        2.0 + 0.15 * lineIndex,
        baseUv,
        mouseUv,
        interactive
      );
    }
  }

  if (enableTop) {
    for (int index = 0; index < topLineCount; ++index) {
      float lineIndex = float(index);
      float progress = lineIndex / max(float(topLineCount - 1), 1.0);
      float angle = topWavePosition.z * log(length(baseUv) + 1.0);
      vec2 rotatedUv = baseUv * rotate(angle);
      rotatedUv.x *= -1.0;
      lines += getLineColor(progress) * wave(
        rotatedUv + vec2(topLineDistance * lineIndex + topWavePosition.x, topWavePosition.y),
        1.0 + 0.2 * lineIndex,
        baseUv,
        mouseUv,
        interactive
      ) * 0.12;
    }
  }

  fragmentColor = vec4(backgroundColor + lines * lineOpacity, 1.0);
}

void main() {
  vec4 color = vec4(0.0);
  mainImage(color, gl_FragCoord.xy);
  gl_FragColor = color;
}
`;

const MAX_GRADIENT_STOPS = 8;
const DEFAULT_GRADIENT = ["#5f2638", "#a84d67", "#d1879a", "#f0d4dc"];
const DEFAULT_WAVES: WaveType[] = ["middle", "bottom"];
const DEFAULT_LINE_COUNT = [5, 7];
const DEFAULT_LINE_DISTANCE = [8, 6];
const DEFAULT_TOP_POSITION = { x: 9, y: 0.55, rotate: -0.35 };
const DEFAULT_MIDDLE_POSITION = { x: 4.4, y: 0.12, rotate: 0.14 };
const DEFAULT_BOTTOM_POSITION = { x: 1.8, y: -0.72, rotate: -0.32 };

type WaveType = "top" | "middle" | "bottom";

interface WavePosition {
  x: number;
  y: number;
  rotate: number;
}

interface FloatingLinesProps {
  animationSpeed?: number;
  backgroundColor?: string;
  bendRadius?: number;
  bendStrength?: number;
  className?: string;
  enabledWaves?: WaveType[];
  interactive?: boolean;
  lineCount?: number | number[];
  lineDistance?: number | number[];
  lineOpacity?: number;
  linesGradient?: string[];
  mixBlendMode?: CSSProperties["mixBlendMode"];
  mouseDamping?: number;
  parallax?: boolean;
  parallaxStrength?: number;
  topWavePosition?: WavePosition;
  middleWavePosition?: WavePosition;
  bottomWavePosition?: WavePosition;
}

function hexToVector(hex: string) {
  const value = hex.trim().replace(/^#/, "");
  const expanded = value.length === 3
    ? value.split("").map((character) => `${character}${character}`).join("")
    : value;
  const parsed = Number.parseInt(expanded, 16);

  if (!Number.isFinite(parsed) || expanded.length !== 6) return new Vector3(1, 1, 1);
  return new Vector3(
    ((parsed >> 16) & 255) / 255,
    ((parsed >> 8) & 255) / 255,
    (parsed & 255) / 255
  );
}

function indexedValue(value: number | number[], index: number, fallback: number) {
  return typeof value === "number" ? value : (value[index] ?? fallback);
}

function FloatingLines({
  animationSpeed = 0.38,
  backgroundColor = "#17181b",
  bendRadius = 4.5,
  bendStrength = -0.24,
  className = "",
  enabledWaves = DEFAULT_WAVES,
  interactive = true,
  lineCount = DEFAULT_LINE_COUNT,
  lineDistance = DEFAULT_LINE_DISTANCE,
  lineOpacity = 0.56,
  linesGradient = DEFAULT_GRADIENT,
  mixBlendMode = "screen",
  mouseDamping = 0.045,
  parallax = true,
  parallaxStrength = 0.07,
  topWavePosition = DEFAULT_TOP_POSITION,
  middleWavePosition = DEFAULT_MIDDLE_POSITION,
  bottomWavePosition = DEFAULT_BOTTOM_POSITION
}: FloatingLinesProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const precisePointer = window.matchMedia("(pointer: fine)").matches;
    const shouldInteract = interactive && precisePointer && !reduceMotion;
    container.dataset.motion = reduceMotion ? "reduced" : "animated";

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({
        alpha: false,
        antialias: false,
        powerPreference: "low-power"
      });
    } catch {
      container.dataset.renderer = "fallback";
      return;
    }

    container.dataset.renderer = "webgl";
    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    camera.position.z = 1;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.domElement.setAttribute("aria-hidden", "true");
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    container.appendChild(renderer.domElement);

    const waveIndex = (wave: WaveType) => enabledWaves.indexOf(wave);
    const waveCount = (wave: WaveType) => {
      const index = waveIndex(wave);
      return index < 0 ? 0 : indexedValue(lineCount, index, 6);
    };
    const waveDistance = (wave: WaveType) => {
      const index = waveIndex(wave);
      return index < 0 ? 0.01 : indexedValue(lineDistance, index, 6) * 0.01;
    };

    const uniforms = {
      iTime: { value: reduceMotion ? 5.5 : 0 },
      iResolution: { value: new Vector3(1, 1, 1) },
      animationSpeed: { value: animationSpeed },
      backgroundColor: { value: hexToVector(backgroundColor) },
      lineOpacity: { value: lineOpacity },
      enableTop: { value: enabledWaves.includes("top") },
      enableMiddle: { value: enabledWaves.includes("middle") },
      enableBottom: { value: enabledWaves.includes("bottom") },
      topLineCount: { value: waveCount("top") },
      middleLineCount: { value: waveCount("middle") },
      bottomLineCount: { value: waveCount("bottom") },
      topLineDistance: { value: waveDistance("top") },
      middleLineDistance: { value: waveDistance("middle") },
      bottomLineDistance: { value: waveDistance("bottom") },
      topWavePosition: { value: new Vector3(topWavePosition.x, topWavePosition.y, topWavePosition.rotate) },
      middleWavePosition: { value: new Vector3(middleWavePosition.x, middleWavePosition.y, middleWavePosition.rotate) },
      bottomWavePosition: { value: new Vector3(bottomWavePosition.x, bottomWavePosition.y, bottomWavePosition.rotate) },
      iMouse: { value: new Vector2(-1000, -1000) },
      interactive: { value: shouldInteract },
      bendRadius: { value: bendRadius },
      bendStrength: { value: bendStrength },
      bendInfluence: { value: 0 },
      parallax: { value: parallax && shouldInteract },
      parallaxOffset: { value: new Vector2(0, 0) },
      lineGradient: {
        value: Array.from({ length: MAX_GRADIENT_STOPS }, () => new Vector3(1, 1, 1))
      },
      lineGradientCount: { value: Math.min(linesGradient.length, MAX_GRADIENT_STOPS) }
    };

    linesGradient.slice(0, MAX_GRADIENT_STOPS).forEach((color, index) => {
      uniforms.lineGradient.value[index].copy(hexToVector(color));
    });

    const material = new ShaderMaterial({ uniforms, vertexShader, fragmentShader });
    const geometry = new PlaneGeometry(2, 2);
    scene.add(new Mesh(geometry, material));

    const render = () => renderer.render(scene, camera);
    const setSize = () => {
      const width = container.clientWidth || 1;
      const height = container.clientHeight || 1;
      renderer.setSize(width, height, false);
      uniforms.iResolution.value.set(renderer.domElement.width, renderer.domElement.height, 1);
      if (reduceMotion) render();
    };
    setSize();

    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(setSize);
    resizeObserver?.observe(container);

    const targetMouse = new Vector2(-1000, -1000);
    const currentMouse = new Vector2(-1000, -1000);
    const targetParallax = new Vector2(0, 0);
    const currentParallax = new Vector2(0, 0);
    let targetInfluence = 0;
    let currentInfluence = 0;
    const pointerSurface = container.parentElement ?? container;

    const handlePointerMove = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      const pixelRatio = renderer.getPixelRatio();
      targetMouse.set(x * pixelRatio, (rect.height - y) * pixelRatio);
      targetInfluence = 1;
      targetParallax.set(
        ((x - rect.width / 2) / rect.width) * parallaxStrength,
        (-(y - rect.height / 2) / rect.height) * parallaxStrength
      );
    };
    const handlePointerLeave = () => {
      targetInfluence = 0;
      targetParallax.set(0, 0);
    };

    if (shouldInteract) {
      pointerSurface.addEventListener("pointermove", handlePointerMove);
      pointerSurface.addEventListener("pointerleave", handlePointerLeave);
    }

    let active = true;
    let visible = true;
    let animationFrame = 0;
    let elapsed = reduceMotion ? 5.5 : 0;
    let previousTime = performance.now();

    const stopAnimation = () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
      animationFrame = 0;
    };
    const animate = (time: number) => {
      animationFrame = 0;
      if (!active || !visible || document.hidden) return;
      elapsed += Math.min((time - previousTime) / 1000, 0.05);
      previousTime = time;
      uniforms.iTime.value = elapsed;

      if (shouldInteract) {
        currentMouse.lerp(targetMouse, mouseDamping);
        uniforms.iMouse.value.copy(currentMouse);
        currentInfluence += (targetInfluence - currentInfluence) * mouseDamping;
        uniforms.bendInfluence.value = currentInfluence;
        currentParallax.lerp(targetParallax, mouseDamping);
        uniforms.parallaxOffset.value.copy(currentParallax);
      }

      render();
      animationFrame = requestAnimationFrame(animate);
    };
    const startAnimation = () => {
      if (reduceMotion || animationFrame || !active || !visible || document.hidden) return;
      previousTime = performance.now();
      animationFrame = requestAnimationFrame(animate);
    };

    const intersectionObserver = typeof IntersectionObserver === "undefined" ? null : new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      if (visible) startAnimation();
      else stopAnimation();
    }, { threshold: 0.01 });
    intersectionObserver?.observe(container);

    const handleVisibilityChange = () => {
      if (document.hidden) stopAnimation();
      else startAnimation();
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    if (reduceMotion) render();
    else startAnimation();

    return () => {
      active = false;
      stopAnimation();
      resizeObserver?.disconnect();
      intersectionObserver?.disconnect();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      if (shouldInteract) {
        pointerSurface.removeEventListener("pointermove", handlePointerMove);
        pointerSurface.removeEventListener("pointerleave", handlePointerLeave);
      }
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [
    animationSpeed,
    backgroundColor,
    bendRadius,
    bendStrength,
    bottomWavePosition,
    enabledWaves,
    interactive,
    lineCount,
    lineDistance,
    lineOpacity,
    linesGradient,
    middleWavePosition,
    mouseDamping,
    parallax,
    parallaxStrength,
    topWavePosition
  ]);

  return (
    <div
      aria-hidden="true"
      className={`floating-lines-container ${className}`.trim()}
      ref={containerRef}
      style={{ mixBlendMode }}
    />
  );
}

export default memo(FloatingLines);
