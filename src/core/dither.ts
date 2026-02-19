// ─── Dithered Canvas Core ──────────────────────────────────────────────────────
// ───────────────────────────────────────────────────────────────────────────────
//
// Shared rendering pipeline for band-free opaque gradients on HTML Canvas.
//
// Pipeline (per pixel):
//   1. colorFn(x, y) → linear RGB [0–1]
//   2. Linear → sRGB float [0–255]
//   3. Add dither noise (TPDF-shaped, luminance-coherent)
//   4. Round + clamp → Uint8
//
// ── Dither modes ──────────────────────────────────────────────────────────────
//
//   "ign" (default) — TPDF-shaped Interleaved Gradient Noise
//     Jorge Jimenez, Activision, SIGGRAPH 2014. Hash-based, no precomputation,
//     no texture fetches. Excellent spectral properties for a texture-free method.
//     TPDF shaping (sum of two decorrelated samples) eliminates noise-modulation
//     artifacts that uniform dither leaves behind.
//
//     Best for: video frames. YouTube's VP9/AV1 re-encode introduces its own
//     noise floor, masking any difference between IGN and blue noise. IGN is
//     faster and has zero memory overhead.
//
//   "blue-noise" — TPDF-shaped 64×64 void-and-cluster blue noise texture
//     Concentrates error energy at high spatial frequencies, producing less
//     perceptible grain than IGN at the same amplitude. The texture is generated
//     once (lazy, ~30ms) using a Gaussian-energy void-and-cluster algorithm
//     with toroidal wrapping for seamless tiling.
//
//     Best for: still image exports — thumbnails, social cards, OG images,
//     screenshots. No compression noise to mask the dither pattern, so the
//     higher spectral quality of blue noise is visible.
//
// ── Amplitude ─────────────────────────────────────────────────────────────────
//
//   Default ±1.5 LSB. Standard ±0.5 LSB is insufficient for near-black sRGB
//   gradients because gamma encoding makes dark quantization steps perceptually
//   larger. ±1.5 bridges 2–3 code levels, fully masking banding in typical
//   dark-UI color ranges (#0d0d0e → #18181b).
//
// ── Usage ─────────────────────────────────────────────────────────────────────
//
//   import { renderDitheredCanvas, hexToLinearRgb } from "@canopyide/smooth-gradient";
//
//   const [r0, g0, b0] = hexToLinearRgb("#18181b");
//   const [r1, g1, b1] = hexToLinearRgb("#0d0d0e");
//
//   renderDitheredCanvas(canvas, 1920, 1080, (x, y) => {
//     const t = /* your gradient math */;
//     return [lerp(r0, r1, t), lerp(g0, g1, t), lerp(b0, b1, t)];
//   });

// ─── Types ──────────────────────────────────────────────────────────────────

export type DitherMode = "ign" | "blue-noise";

// ─── Color utilities ────────────────────────────────────────────────────────

/** Parse hex color (#RGB or #RRGGBB) to [r, g, b] in 0–255 */
export const hexToRgb = (hex: string): [number, number, number] => {
  const c = hex.replace("#", "");
  const e =
    c.length === 3
      ? c
          .split("")
          .map((ch) => `${ch}${ch}`)
          .join("")
      : c;
  const n = Number.parseInt(e, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

/** sRGB 8-bit channel → linear float [0, 1] */
export const srgbToLinear = (c: number): number => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
};

/** Linear float [0, 1] → sRGB float [0, 255]. Do NOT round — dither first. */
export const linearToSrgb8 = (c: number): number => {
  const s =
    c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
  return s * 255;
};

/** Parse hex color to linear RGB triplet [0, 1] — ready for interpolation */
export const hexToLinearRgb = (hex: string): [number, number, number] => {
  const [r, g, b] = hexToRgb(hex);
  return [srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)];
};

// ─── Interleaved Gradient Noise ─────────────────────────────────────────────
// Jorge Jimenez, Activision — SIGGRAPH 2014 (Call of Duty: Advanced Warfare)

export const ign = (x: number, y: number): number => {
  const dot = x * 0.06711056 + y * 0.00583715;
  return (52.9829189 * (dot - Math.floor(dot))) % 1;
};

// ─── Blue noise texture (64×64, void-and-cluster) ───────────────────────────
//
// Generated lazily on first use (~30ms). The algorithm places pixels one at a
// time at the position farthest from all existing pixels (the "largest void"),
// using a Gaussian energy field with toroidal wrapping for seamless tiling.
// Placement rank becomes the threshold value — early-placed pixels (isolated)
// get low values, late-placed pixels (gap-filling) get high values. This gives
// the characteristic blue-noise property: nearby pixels have very different
// threshold values, pushing error energy to high spatial frequencies.

const BN_SIZE = 64;
const BN_N = BN_SIZE * BN_SIZE; // 4096

let _blueNoise: Uint8Array | null = null;

function generateBlueNoise(): Uint8Array {
  const texture = new Uint8Array(BN_N);
  const placed = new Uint8Array(BN_N);
  const energy = new Float64Array(BN_N); // accumulated Gaussian coverage
  const order: number[] = [];

  // Gaussian influence: sigma=1.9, radius=6 (ceil(1.9*3))
  const SIGMA = 1.9;
  const RADIUS = 6;

  // Precompute Gaussian kernel (13×13 = 169 values)
  const kernelWidth = 2 * RADIUS + 1;
  const kernel = new Float64Array(kernelWidth * kernelWidth);
  for (let dy = -RADIUS; dy <= RADIUS; dy++) {
    for (let dx = -RADIUS; dx <= RADIUS; dx++) {
      kernel[(dy + RADIUS) * kernelWidth + (dx + RADIUS)] = Math.exp(
        -(dx * dx + dy * dy) / (2 * SIGMA * SIGMA),
      );
    }
  }

  // Add Gaussian energy around a newly placed pixel (toroidal wrapping)
  function addInfluence(idx: number): void {
    const px = idx % BN_SIZE;
    const py = (idx / BN_SIZE) | 0;
    let k = 0;
    for (let dy = -RADIUS; dy <= RADIUS; dy++) {
      for (let dx = -RADIUS; dx <= RADIUS; dx++) {
        const nx = ((px + dx) % BN_SIZE + BN_SIZE) % BN_SIZE;
        const ny = ((py + dy) % BN_SIZE + BN_SIZE) % BN_SIZE;
        energy[ny * BN_SIZE + nx] += kernel[k++];
      }
    }
  }

  // Place first pixel at a fixed position (deterministic)
  const first = 33 * BN_SIZE + 33; // near center
  placed[first] = 1;
  order.push(first);
  addInfluence(first);

  // Iteratively place at the largest void (lowest energy among unplaced)
  for (let rank = 1; rank < BN_N; rank++) {
    let bestIdx = 0;
    let bestEnergy = Infinity;

    for (let i = 0; i < BN_N; i++) {
      if (placed[i]) continue;
      if (energy[i] < bestEnergy) {
        bestEnergy = energy[i];
        bestIdx = i;
      }
    }

    placed[bestIdx] = 1;
    order.push(bestIdx);
    addInfluence(bestIdx);
  }

  // Rank → threshold value: first placed (most isolated) = 0, last = 255
  for (let rank = 0; rank < BN_N; rank++) {
    texture[order[rank]] = Math.round((rank / (BN_N - 1)) * 255);
  }

  return texture;
}

function getBlueNoise(): Uint8Array {
  if (!_blueNoise) {
    _blueNoise = generateBlueNoise();
  }
  return _blueNoise;
}

/** Public accessor used by GPU renderers that need the same blue-noise field. */
export function getBlueNoiseTexture64(): Uint8Array {
  return getBlueNoise();
}

// ─── Dither value ───────────────────────────────────────────────────────────
//
// Returns a TPDF-shaped noise value in [-amp, +amp].
// Same value used for R, G, B (luminance-coherent) to avoid chroma speckle.

export function getDitherValue(
  x: number,
  y: number,
  mode: DitherMode,
  amp: number,
): number {
  if (mode === "blue-noise") {
    const bn = getBlueNoise();
    // Two samples at well-separated offsets → TPDF (triangular distribution).
    // Offset (37, 17) gives ~41px toroidal distance, well beyond the ~6px
    // correlation radius of our blue noise texture.
    const u1 = bn[(x & 63) + ((y & 63) << 6)] / 255;
    const u2 = bn[((x + 37) & 63) + (((y + 17) & 63) << 6)] / 255;
    return (u1 + u2 - 1.0) * amp;
  }

  // IGN TPDF: two decorrelated IGN samples summed for triangular distribution
  const u1 = ign(x, y);
  const u2 = ign(x + 5.3, y + 3.7);
  return (u1 + u2 - 1.0) * amp;
}

// ─── Canvas renderer ────────────────────────────────────────────────────────
//
// The main workhorse. Accepts a colorFn that returns linear RGB for each pixel,
// handles sRGB encoding, dithering, and quantization in the correct order.
//
// colorFn receives DESIGN-SPACE coordinates (e.g., 0–1920, 0–1080) regardless
// of the canvas physical resolution. The renderer maps physical pixels to
// design-space coordinates, so gradients are sampled at sub-pixel precision
// when the canvas is larger than the design space (e.g., 4K canvas for a
// 1080p design via Remotion's Config.setScale(2)).
//
// Dither noise uses PHYSICAL pixel coordinates — one unique noise value per
// output pixel, no 2×2 block artifacts at higher DPR.

export interface DitheredCanvasOptions {
  /** Dither algorithm. Default: "ign" */
  dither?: DitherMode;
  /** TPDF amplitude in LSB units. Default: 1.5 (tuned for dark sRGB gradients) */
  amplitude?: number;
}

export function renderDitheredCanvas(
  canvas: HTMLCanvasElement,
  designWidth: number,
  designHeight: number,
  colorFn: (x: number, y: number) => [number, number, number],
  options: DitheredCanvasOptions = {},
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const { dither = "ign", amplitude = 1.5 } = options;

  // Canvas physical resolution (may be > design size on HiDPI / Remotion scale)
  const physW = canvas.width;
  const physH = canvas.height;

  // Scale from physical pixels to design-space coordinates
  const scaleX = designWidth / physW;
  const scaleY = designHeight / physH;

  const imageData = ctx.createImageData(physW, physH);
  const data = imageData.data;

  for (let py = 0; py < physH; py++) {
    for (let px = 0; px < physW; px++) {
      const i = (py * physW + px) * 4;

      // 1. Map physical pixel to design-space coordinate (sub-pixel precision)
      const [linR, linG, linB] = colorFn(px * scaleX, py * scaleY);

      // 2. Convert to sRGB float (do NOT round yet)
      const sR = linearToSrgb8(linR);
      const sG = linearToSrgb8(linG);
      const sB = linearToSrgb8(linB);

      // 3. Add TPDF dither noise at physical pixel coords (unique per output pixel)
      const noise = getDitherValue(px, py, dither, amplitude);

      // 4. Quantize to 8-bit
      data[i] = Math.max(0, Math.min(255, Math.round(sR + noise)));
      data[i + 1] = Math.max(0, Math.min(255, Math.round(sG + noise)));
      data[i + 2] = Math.max(0, Math.min(255, Math.round(sB + noise)));
      data[i + 3] = 255; // opaque
    }
  }

  ctx.putImageData(imageData, 0, 0);
}
