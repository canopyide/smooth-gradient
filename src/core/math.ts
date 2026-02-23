import type {
  BackgroundLayer,
  BoxGradientLayer,
  LinearGradientLayer,
  RadialGradientLayer,
} from "./types";

const EPSILON = 1e-6;
const SQRT2 = Math.SQRT2;

/**
 * Approximate error function (erf) using the Abramowitz & Stegun formula 7.1.26.
 * Maximum error < 1.5 × 10⁻⁷ — more than adequate for rendering.
 */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);

  const t = 1.0 / (1.0 + 0.3275911 * ax);
  const y =
    1.0 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-ax * ax);

  return sign * y;
}

/**
 * Gaussian CDF shadow intensity, matching the CSS box-shadow spec.
 *
 * CSS defines blur-radius → σ = blur / 2.  The shadow mask is then
 * convolved with a Gaussian, giving an erf-based transition at the
 * shape boundary.
 *
 * Returns 0 (no shadow) deep inside the hole, 0.5 at the boundary,
 * and approaches 1 in the fully-shadowed walls.
 */
function gaussianShadow(sdf: number, blur: number): number {
  const sigma = blur / 2;
  return 0.5 * (1 + erf(sdf / (sigma * SQRT2)));
}

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

  // Lp norm: p=2 is standard ellipse (L2), p>2 gives squircle shapes.
  const p = layer.power ?? 2;
  const distance =
    p === 2
      ? Math.sqrt(dx * dx + dy * dy)
      : Math.pow(
          Math.pow(Math.abs(dx), p) + Math.pow(Math.abs(dy), p),
          1 / p,
        );

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

/**
 * CSS-like inset / outer box shadow using SDF + Gaussian CDF (erf).
 *
 * Per the W3C CSS Backgrounds & Borders Level 3 spec, the blur-radius
 * defines a Gaussian with σ = blur / 2.  The shadow mask (a filled
 * rounded rectangle) is convolved with this Gaussian, producing an
 * erf-based intensity transition at the shape boundary.
 *
 * **Inset shadow**:
 *   1. Clip to the outer box (pixels outside → mask 0).
 *   2. Compute an inner "hole" contracted by `spread` on every side.
 *   3. SDF from the inner hole boundary.
 *   4. Apply `gaussianShadow(innerSdf, blur)` — this gives 0 deep
 *      inside the hole, 0.5 at the boundary, and ≈1 in the walls.
 *      The Gaussian naturally extends ~1.5 × blur from the boundary,
 *      producing a much softer, more organic fade than smoothstep.
 *
 * **Outer shadow**:
 *   1. Clip to the box exterior (pixels inside → mask 0).
 *   2. Gaussian fade outward from spread-inflated boundary.
 *
 * The returned `t` follows the convention: **t = 0 at the shadow edge
 * (maximum shadow), t = 1 at the shadow-free centre / far field**.
 */
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

  if (inset) {
    // ── Step 1: Outer clip ──────────────────────────────────────────
    const outerSdf = signedDistanceRoundedRect(
      x, y, rectX, rectY, rectW, rectH, radius,
    );
    if (outerSdf > 0) {
      return { t: 0, mask: 0 }; // outside the box
    }

    // ── Step 2: Inner contracted "hole" ─────────────────────────────
    const innerW = Math.max(0, rectW - 2 * spread);
    const innerH = Math.max(0, rectH - 2 * spread);
    const innerR = Math.max(0, radius - spread);

    // If spread consumed the entire interior → full shadow everywhere
    if (innerW <= 0 || innerH <= 0) {
      return { t: 0, mask: 1 };
    }

    // ── Step 3: SDF from the inner boundary ─────────────────────────
    const innerSdf = signedDistanceRoundedRect(
      x, y,
      rectX + spread, rectY + spread,
      innerW, innerH,
      innerR,
    );

    // ── Step 4: Gaussian CDF transition (matches CSS spec) ──────────
    if (blur <= EPSILON) {
      // Hard edge: inside hole → no shadow, in walls → full shadow
      return { t: innerSdf < 0 ? 1 : 0, mask: 1 };
    }

    // gaussianShadow: 0 deep inside hole, 0.5 at boundary, ~1 in walls.
    // Fade extends ~1.5 × blur from the boundary (3σ).
    const rawShadow = gaussianShadow(innerSdf, blur);

    // Invert: t = 0 at edges (shadow), t = 1 at centre (no shadow)
    return { t: 1.0 - rawShadow, mask: 1 };
  }

  // ── Outer shadow ────────────────────────────────────────────────────
  const sdf = signedDistanceRoundedRect(
    x, y, rectX, rectY, rectW, rectH, radius,
  );

  if (sdf <= 0) {
    return { t: 0, mask: 0 }; // inside the box — no outer shadow
  }

  if (blur <= EPSILON) {
    // Hard edge: within spread → full shadow, beyond → nothing
    return sdf <= spread
      ? { t: 0, mask: 1 }
      : { t: 0, mask: 0 };
  }

  // Gaussian fade outward.  `sdf - spread` is the distance past the
  // solid-shadow region inflated by spread.
  // gaussianShadow gives ~1 near the boundary and ~0 far away, but we
  // need the inverse (shadow=1 near box, shadow=0 far away), so we
  // use 1 - gaussianShadow on the negated distance.
  const d = sdf - spread;
  const rawAlpha = 1.0 - gaussianShadow(d, blur);

  if (rawAlpha < 0.001) {
    return { t: 0, mask: 0 };
  }

  // t = 0 near box (shadow), t = 1 far away (no shadow)
  return { t: 1.0 - rawAlpha, mask: 1 };
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
