import type {
  BackgroundLayer,
  BoxGradientLayer,
  LinearGradientLayer,
  RadialGradientLayer,
} from "./types";

const EPSILON = 1e-6;

export interface LayerProgress {
  t: number;
  mask: number;
}

export const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export function smoothstep(edge0: number, edge1: number, value: number): number {
  if (Math.abs(edge1 - edge0) < EPSILON) {
    return value >= edge1 ? 1 : 0;
  }

  const t = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function applyExponent(value: number, exponent: number | undefined): number {
  if (!exponent || exponent === 1) {
    return value;
  }

  const safeExponent = exponent > 0 ? exponent : 1;
  return Math.pow(value, safeExponent);
}

export function sampleLinearProgress(
  layer: LinearGradientLayer,
  x: number,
  y: number,
  width: number,
  height: number,
): LayerProgress {
  const hasExplicitPoints =
    Number.isFinite(layer.startX) &&
    Number.isFinite(layer.startY) &&
    Number.isFinite(layer.endX) &&
    Number.isFinite(layer.endY);

  let rawT = 0;

  if (hasExplicitPoints) {
    const startX = layer.startX as number;
    const startY = layer.startY as number;
    const endX = layer.endX as number;
    const endY = layer.endY as number;

    const dirX = endX - startX;
    const dirY = endY - startY;
    const lenSq = dirX * dirX + dirY * dirY;

    if (lenSq < EPSILON) {
      rawT = 0;
    } else {
      rawT = ((x - startX) * dirX + (y - startY) * dirY) / lenSq;
    }
  } else {
    const angle = layer.angle ?? 180;
    const rad = (angle * Math.PI) / 180;
    const dirX = Math.sin(rad);
    const dirY = -Math.cos(rad);
    const gradientLength =
      Math.abs(width * Math.sin(rad)) + Math.abs(height * Math.cos(rad));
    const safeLength = Math.max(EPSILON, gradientLength);
    const halfLength = safeLength / 2;

    const cx = width / 2;
    const cy = height / 2;
    const projection = (x - cx) * dirX + (y - cy) * dirY;
    rawT = (projection + halfLength) / safeLength;
  }

  const t = applyExponent(clamp(rawT, 0, 1), layer.easing);
  return { t, mask: 1 };
}

export function sampleRadialProgress(
  layer: RadialGradientLayer,
  x: number,
  y: number,
  width: number,
  height: number,
): LayerProgress {
  const cx = layer.centerX ?? width / 2;
  const cy = layer.centerY ?? height / 2;

  const rx = Math.max(EPSILON, layer.radiusX ?? width / 2);
  const ry = Math.max(EPSILON, layer.radiusY ?? height / 2);

  const dx = (x - cx) / rx;
  const dy = (y - cy) / ry;
  const distance = Math.sqrt(dx * dx + dy * dy);

  const innerRadius = layer.innerRadius ?? 0;
  const outerRadius = layer.outerRadius ?? 1;
  const span = Math.max(EPSILON, outerRadius - innerRadius);

  const rawT = clamp((distance - innerRadius) / span, 0, 1);
  const t = applyExponent(rawT, layer.falloff);

  return { t, mask: 1 };
}

function signedDistanceRoundedRect(
  x: number,
  y: number,
  rectX: number,
  rectY: number,
  rectW: number,
  rectH: number,
  radius: number,
): number {
  const cx = rectX + rectW / 2;
  const cy = rectY + rectH / 2;
  const halfW = rectW / 2;
  const halfH = rectH / 2;
  const clampedRadius = clamp(radius, 0, Math.min(halfW, halfH));

  const qx = Math.abs(x - cx) - (halfW - clampedRadius);
  const qy = Math.abs(y - cy) - (halfH - clampedRadius);

  const outside = Math.hypot(Math.max(qx, 0), Math.max(qy, 0));
  const inside = Math.min(Math.max(qx, qy), 0);

  return outside + inside - clampedRadius;
}

export function sampleBoxProgress(
  layer: BoxGradientLayer,
  x: number,
  y: number,
  width: number,
  height: number,
): LayerProgress {
  const rectX = (layer.x ?? 0) + (layer.offsetX ?? 0);
  const rectY = (layer.y ?? 0) + (layer.offsetY ?? 0);
  const rectW = Math.max(1, layer.width ?? width);
  const rectH = Math.max(1, layer.height ?? height);

  const radius = layer.radius ?? 0;
  const spread = layer.spread ?? 0;
  const blur = Math.max(0, layer.blur ?? 0);
  const inset = layer.inset ?? true;

  const sdf = signedDistanceRoundedRect(x, y, rectX, rectY, rectW, rectH, radius);

  if (inset) {
    const insideDistance = -sdf + spread;
    if (insideDistance <= 0) {
      return { t: 0, mask: 0 };
    }

    if (blur <= EPSILON) {
      return { t: 1, mask: 1 };
    }

    return {
      t: clamp(insideDistance / blur, 0, 1),
      mask: 1,
    };
  }

  const outsideDistance = sdf - spread;
  if (outsideDistance <= 0) {
    return { t: 0, mask: 0 };
  }

  if (blur <= EPSILON) {
    return { t: 1, mask: 1 };
  }

  return {
    t: clamp(outsideDistance / blur, 0, 1),
    mask: 1,
  };
}

export function sampleLayerProgress(
  layer: BackgroundLayer,
  x: number,
  y: number,
  width: number,
  height: number,
): LayerProgress {
  if (layer.type === "linear") {
    return sampleLinearProgress(layer, x, y, width, height);
  }

  if (layer.type === "radial") {
    return sampleRadialProgress(layer, x, y, width, height);
  }

  return sampleBoxProgress(layer, x, y, width, height);
}
