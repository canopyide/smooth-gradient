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
  const baseDarken = clamp01(options.baseDarken ?? (preset === "still" ? 0.10 : 0.14));
  const colorShift = clamp01(options.colorShift ?? 1);
  const baseFloor = mixHex(baseColor, "#070708", baseDarken);
  const minDim = Math.min(width, height);

  // Blur sized to cover roughly half the short dimension from each edge,
  // so the vignette extends well into the interior (CSS inner-SDF approach).
  const blur = options.blur ?? Math.round(minDim * 0.55);
  const radius = options.radius ?? Math.round(minDim * 0.06);

  const edgeShadowIntensity =
    options.edgeShadowIntensity ?? (preset === "still" ? 0.45 : 0.50);
  const cornerShadowIntensity =
    options.cornerShadowIntensity ?? (preset === "still" ? 0.18 : 0.22);

  const grainAmount =
    options.grainAmount ?? (preset === "still" ? 0.0028 : 0.0036);
  const grainSeed = options.grainSeed ?? 0;

  // For multiply-blend vignette layers, stop colors are "preservation factors":
  // white (~1.0) preserves the base colour; darker values darken it more.
  // Subtle tints (warm centre, cool edges) give the vignette colour character.
  const vigCenter = mixHex("#fefefe", "#fef4ee", 0.6 * colorShift);
  const vigMid = mixHex("#d8d8dc", "#d0ccd8", 0.4 * colorShift);
  const vigEdge = mixHex("#a8a8b0", "#98a0b8", 0.5 * colorShift);
  const vigDeep = mixHex("#808088", "#707888", 0.5 * colorShift);

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
      // Primary squircle vignette (Lp norm, p=5): smooth screen-shaped edge
      // sculpting without the C¹-discontinuity ridge artifacts of a box SDF.
      // Radial: t=0 at centre (position 0), t=1 at edge (position 1).
      {
        type: "radial",
        blendMode: "multiply",
        opacity: 0.35,
        centerX: width * 0.49 + Math.round(-width * 0.01),
        centerY: height * 0.49 + Math.round(-height * 0.015),
        radiusX: width * 0.58,
        radiusY: height * 0.58,
        innerRadius: 0.30,
        outerRadius: 1.20,
        falloff: 1.3,
        power: 5,
        stops: [
          { position: 0, color: vigCenter },
          { position: 0.55, color: vigMid },
          { position: 1, color: vigEdge },
        ],
        colorSpace: "oklab",
        shadow: {
          startIntensity: 0,
          endIntensity: edgeShadowIntensity * 0.20,
          curve: 1.2,
        },
        grain: {
          amount: grainAmount * 0.35,
          scale: 0.85,
          seed: grainSeed + 101,
          monochrome: true,
        },
      },
      // Secondary tighter squircle layer with offset for asymmetry.
      {
        type: "radial",
        blendMode: "multiply",
        opacity: 0.28,
        centerX: width * 0.51 + Math.round(width * 0.015),
        centerY: height * 0.51 + Math.round(height * 0.02),
        radiusX: width * 0.52,
        radiusY: height * 0.52,
        innerRadius: 0.25,
        outerRadius: 1.15,
        falloff: 1.5,
        power: 5,
        stops: [
          { position: 0, color: vigMid },
          { position: 0.6, color: vigEdge },
          { position: 1, color: vigDeep },
        ],
        colorSpace: "oklab",
        shadow: {
          startIntensity: 0,
          endIntensity: edgeShadowIntensity * 0.25,
          curve: 1.6,
        },
        grain: {
          amount: grainAmount * 0.28,
          scale: 2.8,
          seed: grainSeed + 37,
          monochrome: true,
        },
      },
      // Off-axis elliptical radial to break symmetry and keep focus up-left.
      {
        type: "radial",
        blendMode: "multiply",
        opacity: 0.25,
        centerX: width * 0.46,
        centerY: height * 0.42,
        radiusX: width * 0.7,
        radiusY: height * 0.63,
        innerRadius: 0.48,
        outerRadius: 1.16,
        falloff: 1.35,
        stops: [
          { position: 0, color: vigCenter },
          { position: 0.72, color: vigEdge },
          { position: 1, color: vigDeep },
        ],
        colorSpace: "oklab",
        shadow: {
          startIntensity: 0,
          endIntensity: cornerShadowIntensity * 0.20,
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
        opacity: 0.20,
        centerX: width * 0.56,
        centerY: height * 0.54,
        radiusX: width * 0.6,
        radiusY: height * 0.56,
        innerRadius: 0.62,
        outerRadius: 1.22,
        falloff: 2.9,
        stops: [
          { position: 0, color: vigMid },
          { position: 0.78, color: vigEdge },
          { position: 1, color: vigDeep },
        ],
        colorSpace: "oklab",
        shadow: {
          startIntensity: 0,
          endIntensity: cornerShadowIntensity * 0.25,
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
        type: "radial",
        centerX: width * 0.5,
        centerY: height * 0.5,
        radiusX: width * 0.56,
        radiusY: height * 0.56,
        innerRadius: 0.25,
        outerRadius: 1.18,
        falloff: 1.35,
        power: 5,
        colors: {
          start: baseColor,
          end: baseColor,
        },
        colorSpace: "oklab",
        shadow: {
          startIntensity: 0.02,
          endIntensity: 0.36,
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
