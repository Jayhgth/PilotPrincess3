// Site-tuned adaptation of React Bits Evil Eye (David Haz),
// MIT + Commons Clause. Uses the project's existing Three.js runtime and adds
// reduced-motion, visibility, resize, and WebGL fallbacks.
// https://reactbits.dev/backgrounds/evil-eye
import { memo, useEffect, useRef } from "react";
import {
  DataTexture,
  LinearFilter,
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  RepeatWrapping,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  Vector3,
  WebGLRenderer
} from "three";

interface EvilEyeProps {
  backgroundColor?: string;
  className?: string;
  eyeColor?: string;
  flameSpeed?: number;
  glowIntensity?: number;
  intensity?: number;
  irisWidth?: number;
  noiseScale?: number;
  pupilFollow?: number;
  pupilSize?: number;
  scale?: number;
}

const vertexShader = `
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const fragmentShader = `
precision highp float;

uniform float uTime;
uniform vec3 uResolution;
uniform sampler2D uNoiseTexture;
uniform float uPupilSize;
uniform float uIrisWidth;
uniform float uGlowIntensity;
uniform float uIntensity;
uniform float uScale;
uniform float uNoiseScale;
uniform vec2 uMouse;
uniform float uPupilFollow;
uniform float uFlameSpeed;
uniform vec3 uEyeColor;
uniform vec3 uBgColor;

void main() {
  vec2 uv = (gl_FragCoord.xy * 2.0 - uResolution.xy) / uResolution.y;
  uv /= uScale;
  float flameTime = uTime * uFlameSpeed;

  float polarRadius = length(uv) * 2.0;
  float polarAngle = (2.0 * atan(uv.x, uv.y)) / 6.28 * 0.3;
  vec2 polarUv = vec2(polarRadius, polarAngle);

  vec4 noiseA = texture2D(uNoiseTexture, polarUv * vec2(0.2, 7.0) * uNoiseScale + vec2(-flameTime * 0.1, 0.0));
  vec4 noiseB = texture2D(uNoiseTexture, polarUv * vec2(0.3, 4.0) * uNoiseScale + vec2(-flameTime * 0.2, 0.0));
  vec4 noiseC = texture2D(uNoiseTexture, polarUv * vec2(0.1, 5.0) * uNoiseScale + vec2(-flameTime * 0.1, 0.0));

  float distanceMask = 1.0 - length(uv);

  float innerRing = clamp(-1.0 * ((distanceMask - 0.7) / uIrisWidth), 0.0, 1.0);
  innerRing = (innerRing * distanceMask - 0.2) / 0.28;
  innerRing += noiseA.r - 0.5;
  innerRing *= 1.3;
  innerRing = clamp(innerRing, 0.0, 1.0);

  float outerRing = clamp(-1.0 * ((distanceMask - 0.5) / 0.2), 0.0, 1.0);
  outerRing = (outerRing * distanceMask - 0.1) / 0.38;
  outerRing += noiseC.r - 0.5;
  outerRing *= 1.3;
  outerRing = clamp(outerRing, 0.0, 1.0);
  innerRing += outerRing;

  float innerEye = distanceMask - 0.2;
  innerEye *= noiseB.r * 2.0;

  vec2 pupilOffset = uMouse * uPupilFollow * 0.12;
  vec2 pupilUv = uv - pupilOffset;
  float pupil = 1.0 - length(pupilUv * vec2(9.0, 2.3));
  pupil *= uPupilSize;
  pupil = clamp(pupil, 0.0, 1.0);
  pupil /= 0.35;

  float outerEyeGlow = 1.0 - length(uv * vec2(0.5, 1.5));
  outerEyeGlow = clamp(outerEyeGlow + 0.5, 0.0, 1.0);
  outerEyeGlow += noiseC.r - 0.5;
  float outerBackgroundGlow = outerEyeGlow;
  outerEyeGlow = pow(outerEyeGlow, 2.0);
  outerEyeGlow += distanceMask;
  outerEyeGlow *= uGlowIntensity;
  outerEyeGlow = clamp(outerEyeGlow, 0.0, 1.0);
  outerEyeGlow *= pow(1.0 - distanceMask, 2.0) * 2.5;

  outerBackgroundGlow += distanceMask;
  outerBackgroundGlow = pow(outerBackgroundGlow, 0.5);
  outerBackgroundGlow *= 0.15;

  vec3 color = uEyeColor * uIntensity * clamp(max(innerRing + innerEye, outerEyeGlow + outerBackgroundGlow) - pupil, 0.0, 3.0);
  color += uBgColor;
  gl_FragColor = vec4(color, 1.0);
}
`;

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

function generateNoiseTexture(size = 256) {
  const data = new Uint8Array(size * size * 4);

  function hash(x: number, y: number, seed: number) {
    let value = x * 374761393 + y * 668265263 + seed * 1274126177;
    value = Math.imul(value ^ (value >>> 13), 1274126177);
    return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
  }

  function noise(pixelX: number, pixelY: number, frequency: number, seed: number) {
    const frequencyX = (pixelX / size) * frequency;
    const frequencyY = (pixelY / size) * frequency;
    const integerX = Math.floor(frequencyX);
    const integerY = Math.floor(frequencyY);
    const transitionX = frequencyX - integerX;
    const transitionY = frequencyY - integerY;
    const wrap = frequency | 0;
    const valueAt = (x: number, y: number) => hash(((x % wrap) + wrap) % wrap, ((y % wrap) + wrap) % wrap, seed);
    const top = valueAt(integerX, integerY) * (1 - transitionX) + valueAt(integerX + 1, integerY) * transitionX;
    const bottom = valueAt(integerX, integerY + 1) * (1 - transitionX) + valueAt(integerX + 1, integerY + 1) * transitionX;
    return top * (1 - transitionY) + bottom * transitionY;
  }

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      let value = 0;
      let amplitude = 0.4;
      let totalAmplitude = 0;
      for (let octave = 0; octave < 8; octave += 1) {
        value += amplitude * noise(x, y, 32 * (1 << octave), octave * 31);
        totalAmplitude += amplitude;
        amplitude *= 0.65;
      }
      value /= totalAmplitude;
      value = Math.max(0, Math.min(1, (value - 0.5) * 2.2 + 0.5));
      const channel = Math.round(value * 255);
      const index = (y * size + x) * 4;
      data[index] = channel;
      data[index + 1] = channel;
      data[index + 2] = channel;
      data[index + 3] = 255;
    }
  }

  const texture = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  texture.needsUpdate = true;
  return texture;
}

function EvilEye({
  backgroundColor = "#0c0d0f",
  className = "",
  eyeColor = "#b84d6a",
  flameSpeed = 0.7,
  glowIntensity = 0.3,
  intensity = 1.15,
  irisWidth = 0.28,
  noiseScale = 1,
  pupilFollow = 0.75,
  pupilSize = 0.68,
  scale = 0.74
}: EvilEyeProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const precisePointer = window.matchMedia("(pointer: fine)").matches;
    const shouldInteract = precisePointer && !reduceMotion && pupilFollow > 0;
    container.dataset.motion = reduceMotion ? "reduced" : "animated";

    let renderer: WebGLRenderer;
    try {
      renderer = new WebGLRenderer({ alpha: false, antialias: false, powerPreference: "low-power" });
    } catch {
      container.dataset.renderer = "fallback";
      return;
    }

    container.dataset.renderer = "webgl";
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    renderer.domElement.setAttribute("aria-hidden", "true");
    renderer.domElement.style.display = "block";
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    container.appendChild(renderer.domElement);

    const scene = new Scene();
    const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1);
    camera.position.z = 1;
    const noiseTexture = generateNoiseTexture();
    const uniforms = {
      uTime: { value: reduceMotion ? 4.5 : 0 },
      uResolution: { value: new Vector3(1, 1, 1) },
      uNoiseTexture: { value: noiseTexture },
      uPupilSize: { value: pupilSize },
      uIrisWidth: { value: irisWidth },
      uGlowIntensity: { value: glowIntensity },
      uIntensity: { value: intensity },
      uScale: { value: scale },
      uNoiseScale: { value: noiseScale },
      uMouse: { value: new Vector2(0, 0) },
      uPupilFollow: { value: shouldInteract ? pupilFollow : 0 },
      uFlameSpeed: { value: flameSpeed },
      uEyeColor: { value: hexToVector(eyeColor) },
      uBgColor: { value: hexToVector(backgroundColor) }
    };
    const material = new ShaderMaterial({ fragmentShader, uniforms, vertexShader });
    const geometry = new PlaneGeometry(2, 2);
    scene.add(new Mesh(geometry, material));

    const render = () => renderer.render(scene, camera);
    const setSize = () => {
      const width = container.clientWidth || 1;
      const height = container.clientHeight || 1;
      renderer.setSize(width, height, false);
      uniforms.uResolution.value.set(renderer.domElement.width, renderer.domElement.height, renderer.domElement.width / renderer.domElement.height);
      if (reduceMotion) render();
    };
    setSize();

    const resizeObserver = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(setSize);
    resizeObserver?.observe(container);

    const targetMouse = new Vector2(0, 0);
    const currentMouse = new Vector2(0, 0);
    const pointerSurface = container.parentElement ?? container;
    const handlePointerMove = (event: PointerEvent) => {
      const rect = renderer.domElement.getBoundingClientRect();
      targetMouse.set(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -(((event.clientY - rect.top) / rect.height) * 2 - 1)
      );
    };
    const handlePointerLeave = () => targetMouse.set(0, 0);

    if (shouldInteract) {
      pointerSurface.addEventListener("pointermove", handlePointerMove);
      pointerSurface.addEventListener("pointerleave", handlePointerLeave);
    }

    let active = true;
    let visible = true;
    let animationFrame = 0;
    let elapsed = reduceMotion ? 4.5 : 0;
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
      uniforms.uTime.value = elapsed;
      if (shouldInteract) {
        currentMouse.lerp(targetMouse, 0.055);
        uniforms.uMouse.value.copy(currentMouse);
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
      noiseTexture.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      renderer.domElement.remove();
    };
  }, [backgroundColor, eyeColor, flameSpeed, glowIntensity, intensity, irisWidth, noiseScale, pupilFollow, pupilSize, scale]);

  return <div aria-hidden="true" className={`evil-eye-container ${className}`.trim()} ref={containerRef} />;
}

export default memo(EvilEye);
