import type { DitherMode } from "./dither";

export type BackgroundBlendMode = "normal" | "add" | "multiply" | "screen";

export type BackgroundColorSpace = "linear-srgb" | "oklab";

export type BackgroundDitherMode = DitherMode | "none";
export type BackgroundPreset = "video" | "still";

export interface BackgroundColorStop {
  position: number;
  color: string;
  alpha?: number;
}

export interface BackgroundGradientColors {
  start: string;
  mid?: string;
  end: string;
}

export interface BackgroundShadow {
  startIntensity?: number;
  endIntensity?: number;
  curve?: number;
}

export interface BackgroundGrain {
  amount?: number;
  scale?: number;
  seed?: number;
  monochrome?: boolean;
}

export interface BackgroundLayerBase {
  id?: string;
  opacity?: number;
  blendMode?: BackgroundBlendMode;
  colorSpace?: BackgroundColorSpace;
  colors?: BackgroundGradientColors;
  stops?: BackgroundColorStop[];
  midpoint?: number;
  shadow?: BackgroundShadow;
  grain?: BackgroundGrain;
}

export interface LinearGradientLayer extends BackgroundLayerBase {
  type: "linear";
  angle?: number;
  startX?: number;
  startY?: number;
  endX?: number;
  endY?: number;
  easing?: number;
}

export interface RadialGradientLayer extends BackgroundLayerBase {
  type: "radial";
  centerX?: number;
  centerY?: number;
  radiusX?: number;
  radiusY?: number;
  innerRadius?: number;
  outerRadius?: number;
  falloff?: number;
  /** Lp-norm exponent controlling the shape of the distance field.
   *  2 = ellipse (default), 4–6 = squircle, higher = more rectangular.
   *  Values > 2 produce C∞-smooth rectangular vignettes without the
   *  diagonal seam artifacts of a true rectangular SDF. */
  power?: number;
}

export interface BoxGradientLayer extends BackgroundLayerBase {
  type: "box";
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  radius?: number;
  spread?: number;
  blur?: number;
  inset?: boolean;
  offsetX?: number;
  offsetY?: number;
}

export type BackgroundLayer =
  | LinearGradientLayer
  | RadialGradientLayer
  | BoxGradientLayer;

export interface BackgroundDither {
  mode?: BackgroundDitherMode;
  amplitude?: number;
}

export interface BackgroundArgs {
  preset?: BackgroundPreset;
  baseColor?: string;
  layers?: BackgroundLayer[];
  grain?: BackgroundGrain;
  dither?: BackgroundDither;
  opaque?: boolean;
}

export interface LinearRgba {
  r: number;
  g: number;
  b: number;
  a: number;
}
