// Dither core
export {
  type DitherMode,
  type DitheredCanvasOptions,
  hexToRgb,
  hexToLinearRgb,
  srgbToLinear,
  linearToSrgb8,
  ign,
  getBlueNoiseTexture64,
  getDitherValue,
  renderDitheredCanvas,
} from "./dither";

// Types
export type {
  BackgroundArgs,
  BackgroundBlendMode,
  BackgroundColorSpace,
  BackgroundColorStop,
  BackgroundDither,
  BackgroundDitherMode,
  BackgroundGrain,
  BackgroundLayer,
  BackgroundLayerBase,
  BackgroundPreset,
  BackgroundGradientColors,
  BackgroundShadow,
  BoxGradientLayer,
  LinearGradientLayer,
  LinearRgba,
  RadialGradientLayer,
} from "./types";

// Defaults
export {
  BACKGROUND_STILL_DEFAULTS,
  BACKGROUND_VIDEO_DEFAULTS,
  getPresetDefaults,
} from "./defaults";

// Color utilities
export {
  type Oklab,
  parseColorToLinearRgba,
  linearRgbaToHex,
  clampLinearRgba,
  linearRgbToOklab,
  oklabToLinearRgb,
  interpolateLinearRgba,
  lerp,
} from "./color";

// Gradient math
export {
  type LayerProgress,
  clamp,
  smoothstep,
  sampleLinearProgress,
  sampleRadialProgress,
  sampleBoxProgress,
  sampleLayerProgress,
} from "./math";

// Engine (CPU renderer)
export {
  type PreparedStop,
  type PreparedShadow,
  type PreparedGrain,
  type PreparedLayer,
  type ResolvedBackgroundArgs,
  parseBackgroundArgs,
  resolveBackgroundArgs,
  renderBackgroundPixels,
  renderBackgroundToCanvas,
} from "./engine";

// WebGL renderer
export {
  BACKGROUND_WEBGL_LIMITS,
  type BackgroundWebGLSupportResult,
  canRenderBackgroundWithWebGL,
  renderBackgroundToCanvasWebGL,
} from "./webgl";

// Presets
export {
  type VignetteNoisePresetOptions,
  type GrainOnlyPresetOptions,
  type SignatureBackgroundOptions,
  withHexAlpha,
  createVignetteNoiseBackgroundArgs,
  createGrainBackgroundArgs,
  createSignatureBackgroundArgs,
} from "./presets";
