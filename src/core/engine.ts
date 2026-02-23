import { getDitherValue, ign, linearToSrgb8 } from "./dither";
import {
  clampLinearRgba,
  lerp,
  linearRgbToOklab,
  oklabToLinearRgb,
  parseColorToLinearRgba,
} from "./color";
import { getPresetDefaults } from "./defaults";
import { clamp, sampleLayerProgress } from "./math";
import type {
  BackgroundArgs,
  BackgroundBlendMode,
  BackgroundColorSpace,
  BackgroundColorStop,
  BackgroundPreset,
  BackgroundDitherMode,
  BackgroundGrain,
  BackgroundLayer,
  BackgroundShadow,
  LinearRgba,
} from "./types";

export interface PreparedStop {
  position: number;
  color: LinearRgba;
  lab: [number, number, number];
}

export interface PreparedShadow {
  startIntensity: number;
  endIntensity: number;
  curve: number;
}

export interface PreparedGrain {
  amount: number;
  scale: number;
  seed: number;
  monochrome: boolean;
}

export interface PreparedLayer {
  layer: BackgroundLayer;
  opacity: number;
  blendMode: BackgroundBlendMode;
  colorSpace: BackgroundColorSpace;
  stops: PreparedStop[];
  shadow: PreparedShadow;
  grain: PreparedGrain | null;
}

export interface ResolvedBackgroundArgs {
  baseColor: LinearRgba;
  layers: PreparedLayer[];
  preset: BackgroundPreset;
  ditherMode: BackgroundDitherMode;
  ditherAmplitude: number;
  grain: PreparedGrain | null;
  opaque: boolean;
}

const DEFAULT_BASE_COLOR = "#000000";

function toPreparedGrain(
  grain: BackgroundGrain | undefined,
  presetScale: number,
  presetMonochrome: boolean,
): PreparedGrain | null {
  if (!grain) {
    return null;
  }

  const amount = clamp(grain.amount ?? 0, 0, 1);
  if (amount <= 0) {
    return null;
  }

  return {
    amount,
    scale: grain.scale ?? presetScale,
    seed: grain.seed ?? 0,
    monochrome: grain.monochrome ?? presetMonochrome,
  };
}

function toPreparedShadow(shadow: BackgroundShadow | undefined): PreparedShadow {
  return {
    startIntensity: clamp(shadow?.startIntensity ?? 0, 0, 1),
    endIntensity: clamp(shadow?.endIntensity ?? 0, 0, 1),
    curve: Math.max(0.001, shadow?.curve ?? 1),
  };
}

function resolveStops(layer: BackgroundLayer): BackgroundColorStop[] {
  if (layer.stops && layer.stops.length > 0) {
    return [...layer.stops]
      .map((stop) => ({
        position: clamp(stop.position, 0, 1),
        color: stop.color,
        alpha: stop.alpha,
      }))
      .sort((a, b) => a.position - b.position);
  }

  const start = layer.colors?.start ?? DEFAULT_BASE_COLOR;
  const end = layer.colors?.end ?? start;
  const midpoint = clamp(layer.midpoint ?? 0.5, 0, 1);
  const mid = layer.colors?.mid;

  if (!mid) {
    return [
      { position: 0, color: start },
      { position: 1, color: end },
    ];
  }

  return [
    { position: 0, color: start },
    { position: midpoint, color: mid },
    { position: 1, color: end },
  ];
}

function toPreparedStop(stop: BackgroundColorStop): PreparedStop {
  const parsed = parseColorToLinearRgba(stop.color);
  const color: LinearRgba = {
    ...parsed,
    a: clamp(stop.alpha ?? parsed.a, 0, 1),
  };

  return {
    position: clamp(stop.position, 0, 1),
    color,
    lab: linearRgbToOklab(color),
  };
}

function prepareLayer(
  layer: BackgroundLayer,
  defaults: ReturnType<typeof getPresetDefaults>,
): PreparedLayer {
  const stops = resolveStops(layer).map(toPreparedStop);

  return {
    layer,
    opacity: clamp(layer.opacity ?? 1, 0, 1),
    blendMode: layer.blendMode ?? "normal",
    colorSpace: layer.colorSpace ?? defaults.colorSpace,
    stops,
    shadow: toPreparedShadow(layer.shadow),
    grain: toPreparedGrain(
      layer.grain,
      defaults.grainScale,
      defaults.grainMonochrome,
    ),
  };
}

export function parseBackgroundArgs(args: BackgroundArgs | string): BackgroundArgs {
  if (typeof args !== "string") {
    return args;
  }

  const parsed = JSON.parse(args) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Background args JSON must evaluate to an object.");
  }

  return parsed as BackgroundArgs;
}

export function resolveBackgroundArgs(args: BackgroundArgs): ResolvedBackgroundArgs {
  const preset = args.preset ?? "video";
  const defaults = getPresetDefaults(preset);
  const ditherMode: BackgroundDitherMode = args.dither?.mode ?? defaults.ditherMode;

  return {
    baseColor: parseColorToLinearRgba(args.baseColor ?? DEFAULT_BASE_COLOR),
    layers: (args.layers ?? []).map((layer) => prepareLayer(layer, defaults)),
    preset,
    ditherMode,
    ditherAmplitude: Math.max(0, args.dither?.amplitude ?? defaults.ditherAmplitude),
    grain: toPreparedGrain(
      args.grain,
      defaults.grainScale,
      defaults.grainMonochrome,
    ),
    opaque: args.opaque ?? true,
  };
}

function sampleStops(
  stops: PreparedStop[],
  t: number,
  colorSpace: BackgroundColorSpace,
): LinearRgba {
  if (stops.length === 0) {
    return { r: 0, g: 0, b: 0, a: 0 };
  }

  if (stops.length === 1) {
    return stops[0].color;
  }

  const tt = clamp(t, 0, 1);

  if (tt <= stops[0].position) {
    return stops[0].color;
  }

  const last = stops[stops.length - 1];
  if (tt >= last.position) {
    return last.color;
  }

  for (let i = 0; i < stops.length - 1; i++) {
    const start = stops[i];
    const end = stops[i + 1];

    if (tt > end.position) {
      continue;
    }

    const span = Math.max(1e-6, end.position - start.position);
    const segT = (tt - start.position) / span;

    if (colorSpace === "linear-srgb") {
      return {
        r: lerp(start.color.r, end.color.r, segT),
        g: lerp(start.color.g, end.color.g, segT),
        b: lerp(start.color.b, end.color.b, segT),
        a: lerp(start.color.a, end.color.a, segT),
      };
    }

    return oklabToLinearRgb(
      [
        lerp(start.lab[0], end.lab[0], segT),
        lerp(start.lab[1], end.lab[1], segT),
        lerp(start.lab[2], end.lab[2], segT),
      ],
      lerp(start.color.a, end.color.a, segT),
    );
  }

  return last.color;
}

function applyShadow(
  color: LinearRgba,
  progress: number,
  shadow: PreparedShadow,
): LinearRgba {
  const shapedT = Math.pow(clamp(progress, 0, 1), shadow.curve);
  const intensity = clamp(
    lerp(shadow.startIntensity, shadow.endIntensity, shapedT),
    0,
    1,
  );

  if (intensity <= 0) {
    return color;
  }

  const multiplier = 1 - intensity;
  return {
    r: color.r * multiplier,
    g: color.g * multiplier,
    b: color.b * multiplier,
    a: color.a,
  };
}

function triangularNoise(x: number, y: number, seed: number): number {
  const base = seed * 17.71;
  const u1 = ign(x + 11.2 + base, y + 37.9 + base * 0.5);
  const u2 = ign(x + 59.4 + base * 1.3, y + 7.3 + base * 0.9);
  return u1 + u2 - 1;
}

/**
 * Compute perceptual correction factor for grain applied in linear space.
 *
 * The sRGB gamma curve amplifies small linear-space changes at low luminance
 * (dark values). Without correction, grain produces ±10-20 sRGB levels at
 * near-black but only ±1 level at mid-tones — the primary cause of banding
 * in dark gradients.
 *
 * This scales grain by sqrt(luminance / 0.18) capped at 1, normalising so
 * that mid-gray (0.18) is unchanged while dark areas are damped.
 */
function perceptualGrainScale(color: LinearRgba): number {
  const luminance = Math.max(
    0.0001,
    0.2126 * color.r + 0.7152 * color.g + 0.0722 * color.b,
  );
  return Math.min(1, Math.sqrt(luminance / 0.18));
}

function applyGrain(
  color: LinearRgba,
  grain: PreparedGrain | null,
  x: number,
  y: number,
): LinearRgba {
  if (!grain) {
    return color;
  }

  const scale = grain.scale;
  const sx = x * scale;
  const sy = y * scale;
  const pScale = perceptualGrainScale(color);

  if (grain.monochrome) {
    const n = triangularNoise(sx, sy, grain.seed) * grain.amount * pScale;
    return clampLinearRgba({
      r: color.r + n,
      g: color.g + n,
      b: color.b + n,
      a: color.a,
    });
  }

  const nr = triangularNoise(sx + 13.1, sy + 7.7, grain.seed) * grain.amount * pScale;
  const ng = triangularNoise(sx + 29.3, sy + 19.1, grain.seed + 1) * grain.amount * pScale;
  const nb = triangularNoise(sx + 47.9, sy + 31.3, grain.seed + 2) * grain.amount * pScale;

  return clampLinearRgba({
    r: color.r + nr,
    g: color.g + ng,
    b: color.b + nb,
    a: color.a,
  });
}

/**
 * Compute grain noise in sRGB space (perceptually uniform).
 *
 * Returns noise values to be added directly to sRGB [0-255] float channels.
 * The amount parameter is interpreted as a fraction of the sRGB range, so
 * amount=0.004 produces ±1.0 sRGB levels of noise regardless of pixel
 * brightness.
 */
function computeGrainSrgb(
  grain: PreparedGrain | null,
  x: number,
  y: number,
): { r: number; g: number; b: number } | null {
  if (!grain) {
    return null;
  }

  const sx = x * grain.scale;
  const sy = y * grain.scale;
  const amplitude = grain.amount * 255;

  if (grain.monochrome) {
    const n = triangularNoise(sx, sy, grain.seed) * amplitude;
    return { r: n, g: n, b: n };
  }

  return {
    r: triangularNoise(sx + 13.1, sy + 7.7, grain.seed) * amplitude,
    g: triangularNoise(sx + 29.3, sy + 19.1, grain.seed + 1) * amplitude,
    b: triangularNoise(sx + 47.9, sy + 31.3, grain.seed + 2) * amplitude,
  };
}

function blendChannel(
  destination: number,
  source: number,
  blendMode: BackgroundBlendMode,
): number {
  if (blendMode === "add") {
    return Math.min(1, destination + source);
  }

  if (blendMode === "multiply") {
    return destination * source;
  }

  if (blendMode === "screen") {
    return 1 - (1 - destination) * (1 - source);
  }

  return source;
}

function compositeLinear(
  destination: LinearRgba,
  source: LinearRgba,
  blendMode: BackgroundBlendMode,
): LinearRgba {
  const alpha = clamp(source.a, 0, 1);
  if (alpha <= 0) {
    return destination;
  }

  const blendedR = blendChannel(destination.r, source.r, blendMode);
  const blendedG = blendChannel(destination.g, source.g, blendMode);
  const blendedB = blendChannel(destination.b, source.b, blendMode);

  return clampLinearRgba({
    r: destination.r * (1 - alpha) + blendedR * alpha,
    g: destination.g * (1 - alpha) + blendedG * alpha,
    b: destination.b * (1 - alpha) + blendedB * alpha,
    a: alpha + destination.a * (1 - alpha),
  });
}

function sampleLayerColor(
  preparedLayer: PreparedLayer,
  x: number,
  y: number,
  width: number,
  height: number,
): LinearRgba | null {
  const progress = sampleLayerProgress(preparedLayer.layer, x, y, width, height);
  if (progress.mask <= 0) {
    return null;
  }

  const sampled = sampleStops(preparedLayer.stops, progress.t, preparedLayer.colorSpace);
  const shadowed = applyShadow(sampled, progress.t, preparedLayer.shadow);
  const withGrain = applyGrain(shadowed, preparedLayer.grain, x, y);

  const alpha = withGrain.a * preparedLayer.opacity * progress.mask;
  if (alpha <= 0) {
    return null;
  }

  return {
    ...withGrain,
    a: alpha,
  };
}

function quantizeChannel(value: number): number {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function renderBackgroundPixels(
  args: BackgroundArgs,
  designWidth: number,
  designHeight: number,
  physicalWidth = designWidth,
  physicalHeight = designHeight,
): Uint8ClampedArray {
  const resolved = resolveBackgroundArgs(args);
  const pixelData = new Uint8ClampedArray(physicalWidth * physicalHeight * 4);

  const scaleX = designWidth / physicalWidth;
  const scaleY = designHeight / physicalHeight;

  for (let py = 0; py < physicalHeight; py++) {
    for (let px = 0; px < physicalWidth; px++) {
      const index = (py * physicalWidth + px) * 4;
      const x = px * scaleX;
      const y = py * scaleY;

      let accumulated: LinearRgba = resolved.baseColor;

      for (const layer of resolved.layers) {
        const sampled = sampleLayerColor(layer, x, y, designWidth, designHeight);
        if (!sampled) {
          continue;
        }

        accumulated = compositeLinear(accumulated, sampled, layer.blendMode);
      }

      accumulated = clampLinearRgba(accumulated);

      const ditherNoise =
        resolved.ditherMode === "none"
          ? 0
          : getDitherValue(px, py, resolved.ditherMode, resolved.ditherAmplitude);

      // Convert to sRGB float (do NOT round yet — dither first)
      let sR = linearToSrgb8(accumulated.r);
      let sG = linearToSrgb8(accumulated.g);
      let sB = linearToSrgb8(accumulated.b);

      // Apply global grain in sRGB space (perceptually uniform).
      // This avoids the massive sRGB-level jumps that linear-space grain
      // creates in dark regions due to the sRGB gamma curve.
      const grainNoise = computeGrainSrgb(resolved.grain, x, y);
      if (grainNoise) {
        sR += grainNoise.r;
        sG += grainNoise.g;
        sB += grainNoise.b;
      }

      pixelData[index] = quantizeChannel(sR + ditherNoise);
      pixelData[index + 1] = quantizeChannel(sG + ditherNoise);
      pixelData[index + 2] = quantizeChannel(sB + ditherNoise);
      pixelData[index + 3] = resolved.opaque
        ? 255
        : quantizeChannel(accumulated.a * 255);
    }
  }

  return pixelData;
}

export function renderBackgroundToCanvas(
  canvas: HTMLCanvasElement,
  designWidth: number,
  designHeight: number,
  args: BackgroundArgs,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }

  const pixels = renderBackgroundPixels(
    args,
    designWidth,
    designHeight,
    canvas.width,
    canvas.height,
  );

  const imageData = ctx.createImageData(canvas.width, canvas.height);
  imageData.data.set(pixels);
  ctx.putImageData(imageData, 0, 0);
}
