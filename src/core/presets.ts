import type {
  BackgroundArgs,
  BackgroundDitherMode,
  BackgroundPreset,
} from "./types";
import { linearRgbaToHex, parseColorToLinearRgba } from "./color";

const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

function normalizeHex(hex: string): string {
  const trimmed = hex.trim();
  const noHash = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;

  if (noHash.length === 3 || noHash.length === 4) {
    const expanded = noHash
      .slice(0, 3)
      .split("")
      .map((c) => `${c}${c}`)
      .join("");
    return `#${expanded}`;
  }

  if (noHash.length === 6 || noHash.length === 8) {
    return `#${noHash.slice(0, 6)}`;
  }

  throw new Error(`Unsupported hex color format: ${hex}`);
}

export function withHexAlpha(hex: string, alpha: number): string {
  const normalized = normalizeHex(hex);
  const a = Math.round(clamp01(alpha) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${normalized}${a}`;
}

function mixHex(baseHex: string, tintHex: string, strength: number): string {
  const t = clamp01(strength);
  const base = parseColorToLinearRgba(baseHex);
  const tint = parseColorToLinearRgba(tintHex);

  return linearRgbaToHex({
    r: base.r + (tint.r - base.r) * t,
    g: base.g + (tint.g - base.g) * t,
    b: base.b + (tint.b - base.b) * t,
    a: 1,
  });
}

export interface VignetteNoisePresetOptions {
  width?: number;
  height?: number;
  baseColor?: string;
  baseDarken?: number;
  colorShift?: number;
  preset?: BackgroundPreset;
  edgeShadowIntensity?: number;
  cornerShadowIntensity?: number;
  blur?: number;
  radius?: number;
  grainAmount?: number;
  grainScale?: number;
  grainSeed?: number;
  ditherMode?: BackgroundDitherMode;
  ditherAmplitude?: number;
}

/**
 * Video-first vignette preset: rounded inner box-shadow + subtle radial edge shadow + luma grain.
 */
export function createVignetteNoiseBackgroundArgs(
  options: VignetteNoisePresetOptions = {},
): BackgroundArgs {
  const width = options.width ?? DEFAULT_WIDTH;
  const height = options.height ?? DEFAULT_HEIGHT;
  const preset = options.preset ?? "video";

  const baseColor = options.baseColor ?? "#0d0d0e";
  const baseDarken = clamp01(options.baseDarken ?? (preset === "still" ? 0.14 : 0.2));
  const colorShift = clamp01(options.colorShift ?? 1);
  const baseFloor = mixHex(baseColor, "#070708", baseDarken);
  const minDim = Math.min(width, height);

  const blur = options.blur ?? Math.round(minDim * 0.30);
  const radius = options.radius ?? Math.round(minDim * 0.06);

  const edgeShadowIntensity =
    options.edgeShadowIntensity ?? (preset === "still" ? 0.5 : 0.56);
  const cornerShadowIntensity =
    options.cornerShadowIntensity ?? (preset === "still" ? 0.2 : 0.24);

  const grainAmount =
    options.grainAmount ?? (preset === "still" ? 0.0028 : 0.0036);
  const grainSeed = options.grainSeed ?? 0;

  const warmCenter = mixHex(
    baseFloor,
    "#20130f",
    (preset === "still" ? 0.14 : 0.11) * colorShift,
  );
  const coolEdge = mixHex(
    baseFloor,
    "#0b1623",
    (preset === "still" ? 0.30 : 0.26) * colorShift,
  );
  const deepEdge = mixHex(
    baseFloor,
    "#070b11",
    (preset === "still" ? 0.45 : 0.4) * colorShift,
  );

  return {
    preset,
    baseColor: baseFloor,
    dither:
      options.ditherMode || options.ditherAmplitude
        ? {
            mode: options.ditherMode,
            amplitude: options.ditherAmplitude,
          }
        : undefined,
    grain: {
      amount: grainAmount,
      scale: options.grainScale ?? 1.85,
      seed: grainSeed,
      monochrome: true,
    },
    layers: [
      // Broad asymmetric box vignette: primary edge sculpting.
      {
        type: "box",
        blendMode: "multiply",
        opacity: 0.62,
        x: 0,
        y: 0,
        width,
        height,
        radius,
        spread: Math.round(minDim * 0.01),
        blur,
        inset: true,
        offsetX: Math.round(-width * 0.01),
        offsetY: Math.round(-height * 0.015),
        stops: [
          { position: 0, color: warmCenter },
          { position: 0.58, color: baseFloor },
          { position: 1, color: coolEdge },
        ],
        colorSpace: "oklab",
        shadow: {
          startIntensity: edgeShadowIntensity * 0.65,
          endIntensity: 0.04,
          curve: 1.2,
        },
        grain: {
          amount: grainAmount * 0.35,
          scale: 0.85,
          seed: grainSeed + 101,
          monochrome: true,
        },
      },
      // Secondary tighter box layer to avoid a single mechanical falloff curve.
      {
        type: "box",
        blendMode: "multiply",
        opacity: 0.46,
        x: 0,
        y: 0,
        width,
        height,
        radius: Math.round(minDim * 0.045),
        spread: 0,
        blur: Math.round(minDim * 0.19),
        inset: true,
        offsetX: Math.round(width * 0.015),
        offsetY: Math.round(height * 0.02),
        stops: [
          { position: 0, color: baseFloor },
          { position: 0.66, color: coolEdge },
          { position: 1, color: deepEdge },
        ],
        colorSpace: "oklab",
        shadow: {
          startIntensity: edgeShadowIntensity,
          endIntensity: 0.08,
          curve: 1.6,
        },
        grain: {
          amount: grainAmount * 0.28,
          scale: 2.8,
          seed: grainSeed + 37,
          monochrome: true,
        },
      },
      // Off-axis radial to break symmetry and keep focus up-left.
      {
        type: "radial",
        blendMode: "multiply",
        opacity: 0.5,
        centerX: width * 0.46,
        centerY: height * 0.42,
        radiusX: width * 0.7,
        radiusY: height * 0.63,
        innerRadius: 0.48,
        outerRadius: 1.16,
        falloff: 1.35,
        stops: [
          { position: 0, color: warmCenter },
          { position: 0.72, color: coolEdge },
          { position: 1, color: deepEdge },
        ],
        colorSpace: "oklab",
        shadow: {
          startIntensity: 0,
          endIntensity: cornerShadowIntensity * 0.78,
          curve: 1.4,
        },
        grain: {
          amount: grainAmount * 0.22,
          scale: 1.35,
          seed: grainSeed + 73,
          monochrome: true,
        },
      },
      // High-falloff corner pass for richer edge separation.
      {
        type: "radial",
        blendMode: "multiply",
        opacity: 0.42,
        centerX: width * 0.56,
        centerY: height * 0.54,
        radiusX: width * 0.6,
        radiusY: height * 0.56,
        innerRadius: 0.62,
        outerRadius: 1.22,
        falloff: 2.9,
        stops: [
          { position: 0, color: baseFloor },
          { position: 0.78, color: coolEdge },
          { position: 1, color: deepEdge },
        ],
        colorSpace: "oklab",
        shadow: {
          startIntensity: 0,
          endIntensity: cornerShadowIntensity,
          curve: 2.3,
        },
        grain: {
          amount: grainAmount * 0.18,
          scale: 4.2,
          seed: grainSeed + 149,
          monochrome: true,
        },
      },
    ],
  };
}

export interface GrainOnlyPresetOptions {
  baseColor?: string;
  preset?: BackgroundPreset;
  grainAmount?: number;
  grainScale?: number;
  grainSeed?: number;
  ditherMode?: BackgroundDitherMode;
  ditherAmplitude?: number;
}

export function createGrainBackgroundArgs(
  options: GrainOnlyPresetOptions = {},
): BackgroundArgs {
  const preset = options.preset ?? "video";

  return {
    preset,
    baseColor: options.baseColor ?? "#0d0d0e",
    dither:
      options.ditherMode || options.ditherAmplitude
        ? {
            mode: options.ditherMode,
            amplitude: options.ditherAmplitude,
          }
        : undefined,
    grain: {
      amount: options.grainAmount ?? (preset === "still" ? 0.001 : 0.0013),
      scale: options.grainScale ?? 1.6,
      seed: options.grainSeed ?? 0,
      monochrome: true,
    },
  };
}

export interface SignatureBackgroundOptions {
  width?: number;
  height?: number;
  grainSeed?: number;
}

/**
 * Signature background preset: a mid-tone center with subtle shadow-only vignette transitions.
 */
export function createSignatureBackgroundArgs(
  options: SignatureBackgroundOptions = {},
): BackgroundArgs {
  const width = options.width ?? DEFAULT_WIDTH;
  const height = options.height ?? DEFAULT_HEIGHT;
  const baseColor = "#1c1c22";

  return {
    preset: "still",
    baseColor,
    grain: {
      amount: 0.0013,
      scale: 1.9,
      seed: options.grainSeed ?? 777,
      monochrome: true,
    },
    layers: [
      {
        type: "box",
        x: 0,
        y: 0,
        width,
        height,
        radius: 72,
        spread: 10,
        blur: 310,
        inset: true,
        colors: {
          start: baseColor,
          end: baseColor,
        },
        colorSpace: "oklab",
        shadow: {
          startIntensity: 0.36,
          endIntensity: 0.02,
          curve: 1.35,
        },
        opacity: 0.86,
      },
      {
        type: "radial",
        centerX: width * 0.5,
        centerY: height * 0.463,
        radiusX: width * 0.51,
        radiusY: height * 0.574,
        innerRadius: 0.56,
        outerRadius: 1.14,
        falloff: 1.9,
        colors: {
          start: baseColor,
          end: baseColor,
        },
        colorSpace: "oklab",
        shadow: {
          startIntensity: 0,
          endIntensity: 0.14,
          curve: 2.1,
        },
        opacity: 0.55,
      },
    ],
  };
}
