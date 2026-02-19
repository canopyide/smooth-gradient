# @canopyide/smooth-gradient

Band-free canvas gradient rendering with TPDF dithering, Oklab color space interpolation, and WebGL acceleration.

Renders smooth, perceptually uniform gradients to HTML Canvas without the banding artifacts that plague 8-bit sRGB output — especially in dark UI color ranges. Ships a framework-agnostic core plus optional React and Svelte 5 components.

## Features

- **TPDF dithering** — Triangular probability distribution dither eliminates banding in 8-bit output, even in dark gradients where sRGB quantization steps are perceptually large
- **Two dither modes** — Interleaved Gradient Noise (IGN) for video frames, void-and-cluster blue noise for still images
- **Oklab interpolation** — Perceptually uniform color blending that avoids the muddy midtones of linear-sRGB mixing
- **Multi-layer composition** — Linear, radial, and box (SDF) gradient layers with blend modes, shadows, and per-layer grain
- **Dual renderers** — CPU Canvas2D (always available) with automatic WebGL acceleration when possible
- **HiDPI-aware** — Separates design-space coordinates from physical pixels for correct rendering at any device pixel ratio
- **Framework-agnostic** — Vanilla TypeScript core with zero dependencies; optional React and Svelte wrappers

## Install

```bash
npm install @canopyide/smooth-gradient
```

## Quick Start

### Vanilla TypeScript

Render a simple dithered gradient to a canvas:

```typescript
import { renderDitheredCanvas, hexToLinearRgb } from "@canopyide/smooth-gradient";

const [r0, g0, b0] = hexToLinearRgb("#18181b");
const [r1, g1, b1] = hexToLinearRgb("#0d0d0e");

const canvas = document.querySelector("canvas")!;
canvas.width = 1920;
canvas.height = 1080;

renderDitheredCanvas(canvas, 1920, 1080, (x, y) => {
  const t = y / 1080; // vertical gradient
  return [
    r0 + (r1 - r0) * t,
    g0 + (g1 - g0) * t,
    b0 + (b1 - b0) * t,
  ];
});
```

### Multi-Layer Background

Use the full engine for complex backgrounds with multiple gradient layers, blend modes, shadows, and grain:

```typescript
import {
  renderBackgroundToCanvas,
  type BackgroundArgs,
} from "@canopyide/smooth-gradient";

const args: BackgroundArgs = {
  preset: "still",
  baseColor: "#0d0d0e",
  grain: { amount: 0.002, scale: 1.5, monochrome: true },
  layers: [
    {
      type: "radial",
      centerX: 960,
      centerY: 540,
      radiusX: 960,
      radiusY: 540,
      innerRadius: 0,
      outerRadius: 1,
      falloff: 1.5,
      colors: { start: "#1a1a2e", end: "#0d0d0e" },
      colorSpace: "oklab",
      shadow: { startIntensity: 0, endIntensity: 0.3, curve: 1.5 },
    },
    {
      type: "box",
      x: 0,
      y: 0,
      width: 1920,
      height: 1080,
      radius: 60,
      blur: 300,
      inset: true,
      colors: { start: "#18181b", end: "#0a0a0c" },
      blendMode: "multiply",
      opacity: 0.6,
    },
  ],
};

const canvas = document.querySelector("canvas")!;
renderBackgroundToCanvas(canvas, 1920, 1080, args);
```

### React

```tsx
import { DitheredBackground } from "@canopyide/smooth-gradient/react";

function App() {
  return (
    <div style={{ position: "relative", width: 1920, height: 1080 }}>
      <DitheredBackground
        args={{
          preset: "still",
          baseColor: "#0d0d0e",
          layers: [
            {
              type: "radial",
              colors: { start: "#1a1a2e", end: "#0d0d0e" },
              colorSpace: "oklab",
            },
          ],
        }}
        width={1920}
        height={1080}
        renderer="auto"
      />
      <div style={{ position: "relative", zIndex: 1 }}>
        {/* Your content */}
      </div>
    </div>
  );
}
```

### Svelte

```svelte
<script lang="ts">
  import DitheredBackground from "@canopyide/smooth-gradient/svelte/DitheredBackground.svelte";
  import type { BackgroundArgs } from "@canopyide/smooth-gradient/svelte";

  const args: BackgroundArgs = {
    preset: "still",
    baseColor: "#0d0d0e",
    layers: [
      {
        type: "radial",
        colors: { start: "#1a1a2e", end: "#0d0d0e" },
        colorSpace: "oklab",
      },
    ],
  };
</script>

<div style="position: relative; width: 1920px; height: 1080px;">
  <DitheredBackground {args} width={1920} height={1080} />
  <div style="position: relative; z-index: 1;">
    <!-- Your content -->
  </div>
</div>
```

## Presets

Three preset factory functions produce ready-to-use `BackgroundArgs`:

### Vignette Noise

A multi-layer vignette background with asymmetric box shadows, off-axis radial gradients, per-layer grain, and warm-to-cool color shifts. Produces a natural, non-mechanical falloff.

```typescript
import { createVignetteNoiseBackgroundArgs } from "@canopyide/smooth-gradient";

const args = createVignetteNoiseBackgroundArgs({
  baseColor: "#0d0d0e",
  preset: "video",    // "video" (IGN dither) or "still" (blue-noise dither)
  width: 1920,
  height: 1080,
  edgeShadowIntensity: 0.56,
  cornerShadowIntensity: 0.24,
  grainAmount: 0.0036,
  colorShift: 1,       // 0 = neutral, 1 = full warm/cool tint
});
```

### Grain Only

Solid color with subtle monochrome film grain and dithering. No gradient layers.

```typescript
import { createGrainBackgroundArgs } from "@canopyide/smooth-gradient";

const args = createGrainBackgroundArgs({
  baseColor: "#0d0d0e",
  preset: "still",
  grainAmount: 0.001,
});
```

### Signature

A mid-tone background with a subtle shadow-only vignette — no color gradient, just depth from box and radial shadow layers.

```typescript
import { createSignatureBackgroundArgs } from "@canopyide/smooth-gradient";

const args = createSignatureBackgroundArgs({
  width: 1920,
  height: 1080,
  grainSeed: 777,
});
```

## API Reference

### Entrypoints

| Import path | Description |
|---|---|
| `@canopyide/smooth-gradient` | Core library — all types, renderers, utilities, presets |
| `@canopyide/smooth-gradient/react` | React `<DitheredBackground>` component + core re-exports |
| `@canopyide/smooth-gradient/svelte` | Svelte `DitheredBackground.svelte` component + core re-exports |

### Low-Level Dithered Canvas

For custom gradient math where you supply the color function:

```typescript
renderDitheredCanvas(
  canvas: HTMLCanvasElement,
  designWidth: number,
  designHeight: number,
  colorFn: (x: number, y: number) => [number, number, number],
  options?: DitheredCanvasOptions,
): void
```

- `colorFn` receives **design-space** coordinates and returns linear RGB in `[0, 1]`
- Physical canvas size can differ from design size (HiDPI support)
- Dither noise is applied at physical pixel coordinates to avoid block artifacts

```typescript
interface DitheredCanvasOptions {
  dither?: DitherMode;    // "ign" (default) or "blue-noise"
  amplitude?: number;     // TPDF amplitude in LSB. Default: 1.5
}
```

### Background Engine

The full multi-layer compositing engine:

```typescript
// Render to Uint8ClampedArray (works in Node.js — no canvas needed)
renderBackgroundPixels(
  args: BackgroundArgs,
  designWidth: number,
  designHeight: number,
  physicalWidth?: number,   // defaults to designWidth
  physicalHeight?: number,  // defaults to designHeight
): Uint8ClampedArray

// Render directly to a canvas element
renderBackgroundToCanvas(
  canvas: HTMLCanvasElement,
  designWidth: number,
  designHeight: number,
  args: BackgroundArgs,
): void
```

### WebGL Renderer

GPU-accelerated rendering with automatic fallback. Supports up to 6 layers with 4 color stops each.

```typescript
// Check if args can be rendered with WebGL
canRenderBackgroundWithWebGL(args: BackgroundArgs): BackgroundWebGLSupportResult

// Render via WebGL. Returns false if WebGL unavailable or args exceed limits.
renderBackgroundToCanvasWebGL(
  canvas: HTMLCanvasElement,
  designWidth: number,
  designHeight: number,
  args: BackgroundArgs,
): boolean
```

```typescript
const BACKGROUND_WEBGL_LIMITS = {
  maxLayers: 6,
  maxStopsPerLayer: 4,
};
```

### `BackgroundArgs`

The root configuration object:

```typescript
interface BackgroundArgs {
  preset?: "video" | "still";       // Affects dither/grain defaults
  baseColor?: string;                // Hex color, default "#000000"
  layers?: BackgroundLayer[];        // Gradient layers composited in order
  grain?: BackgroundGrain;           // Global film grain overlay
  dither?: BackgroundDither;         // Dithering configuration
  opaque?: boolean;                  // Force alpha=255, default true
}
```

### Gradient Layers

Three layer types, all sharing common properties:

```typescript
// Common to all layers
interface BackgroundLayerBase {
  opacity?: number;                           // [0, 1], default 1
  blendMode?: "normal" | "add" | "multiply" | "screen";
  colorSpace?: "linear-srgb" | "oklab";      // Interpolation space
  colors?: { start: string; mid?: string; end: string };
  stops?: BackgroundColorStop[];              // Explicit stops (overrides colors)
  midpoint?: number;                          // Position of mid color [0, 1]
  shadow?: BackgroundShadow;                  // Multiplicative darkening
  grain?: BackgroundGrain;                    // Per-layer grain
}
```

#### Linear Gradient

```typescript
interface LinearGradientLayer extends BackgroundLayerBase {
  type: "linear";
  angle?: number;           // CSS-style degrees. 180 = top→bottom (default)
  startX?: number;          // Explicit start point (overrides angle)
  startY?: number;
  endX?: number;            // Explicit end point
  endY?: number;
  easing?: number;          // Exponent on progress. >1 = ease-in, <1 = ease-out
}
```

#### Radial Gradient

```typescript
interface RadialGradientLayer extends BackgroundLayerBase {
  type: "radial";
  centerX?: number;         // Default: width / 2
  centerY?: number;         // Default: height / 2
  radiusX?: number;         // Ellipse X radius. Default: width / 2
  radiusY?: number;         // Ellipse Y radius. Default: height / 2
  innerRadius?: number;     // Start of gradient [0, 1]. Default: 0
  outerRadius?: number;     // End of gradient [0, 1]. Default: 1
  falloff?: number;         // Exponent on distance. Default: 1
}
```

#### Box Gradient (SDF)

Uses a signed distance field around a rounded rectangle:

```typescript
interface BoxGradientLayer extends BackgroundLayerBase {
  type: "box";
  x?: number;               // Box position. Default: 0
  y?: number;
  width?: number;            // Box size. Default: canvas width
  height?: number;
  radius?: number;           // Corner radius. Default: 0
  spread?: number;           // SDF distance adjustment. Default: 0
  blur?: number;             // Falloff distance. Default: 0
  inset?: boolean;           // true = shadow inside box (default)
  offsetX?: number;          // SDF offset. Default: 0
  offsetY?: number;
}
```

### Shadow

Multiplicative darkening along a layer's gradient progress:

```typescript
interface BackgroundShadow {
  startIntensity?: number;   // Shadow at t=0. [0, 1], default 0
  endIntensity?: number;     // Shadow at t=1. [0, 1], default 0
  curve?: number;            // Exponent on progress before interpolation. Default: 1
}
```

A shadow with `startIntensity: 0` and `endIntensity: 0.5` will leave the gradient center untouched and darken edges by 50%.

### Grain

Film-style noise overlay:

```typescript
interface BackgroundGrain {
  amount?: number;           // Blend strength [0, 1]. Default: 0 (off)
  scale?: number;            // Frequency multiplier. Default: preset-dependent (~1.5)
  seed?: number;             // Deterministic seed. Default: 0
  monochrome?: boolean;      // Same noise on R/G/B (avoids chroma speckle). Default: true
}
```

### Dither

```typescript
interface BackgroundDither {
  mode?: "ign" | "blue-noise" | "none";   // Default: preset-dependent
  amplitude?: number;                       // TPDF amplitude in LSB. Default: preset-dependent
}
```

### Color Stops

Two ways to define gradient colors:

```typescript
// Simple: start → (optional mid) → end
colors: { start: "#18181b", mid: "#1a1a2e", end: "#0d0d0e" }
midpoint: 0.4  // position of mid color [0, 1]

// Explicit: full control over positions
stops: [
  { position: 0, color: "#18181b" },
  { position: 0.3, color: "#1a1a2e" },
  { position: 0.7, color: "#141420" },
  { position: 1, color: "#0d0d0e" },
]
```

### Color Utilities

```typescript
// Hex parsing
hexToRgb(hex: string): [number, number, number]         // → sRGB 0–255
hexToLinearRgb(hex: string): [number, number, number]    // → linear 0–1
parseColorToLinearRgba(hex: string): LinearRgba          // Supports #RGB #RGBA #RRGGBB #RRGGBBAA

// Conversion
srgbToLinear(c: number): number              // sRGB 0–255 → linear 0–1
linearToSrgb8(c: number): number             // linear 0–1 → sRGB float 0–255 (pre-dither)
linearRgbaToHex(color: LinearRgba): string   // → #RRGGBB or #RRGGBBAA

// Oklab
linearRgbToOklab(color: LinearRgba): Oklab                       // → [L, a, b]
oklabToLinearRgb(lab: Oklab, alpha?: number): LinearRgba          // → clamped LinearRgba
interpolateLinearRgba(start, end, t, colorSpace): LinearRgba      // Blend in linear-srgb or oklab

// Helpers
lerp(start: number, end: number, t: number): number
clamp(value: number, min: number, max: number): number
clampLinearRgba(color: LinearRgba): LinearRgba
withHexAlpha(hex: string, alpha: number): string   // "#abc", 0.5 → "#aabbcc80"
```

### Gradient Math

```typescript
sampleLinearProgress(layer, x, y, width, height): LayerProgress
sampleRadialProgress(layer, x, y, width, height): LayerProgress
sampleBoxProgress(layer, x, y, width, height): LayerProgress
sampleLayerProgress(layer, x, y, width, height): LayerProgress   // Auto-dispatch

smoothstep(edge0: number, edge1: number, value: number): number  // Hermite smoothing
```

```typescript
interface LayerProgress {
  t: number;     // Gradient position [0, 1]
  mask: number;  // Visibility [0, 1]. 0 = outside layer bounds.
}
```

### Noise Functions

```typescript
ign(x: number, y: number): number   // Interleaved Gradient Noise [0, 1)
getBlueNoiseTexture64(): Uint8Array  // 64×64 void-and-cluster texture (lazy, cached)
getDitherValue(x, y, mode, amplitude): number  // TPDF-shaped noise in [-amp, +amp]
```

### React Component

```tsx
<DitheredBackground
  args={BackgroundArgs | string}     // Configuration object or JSON string
  width={1920}                        // Design-space width
  height={1080}                       // Design-space height
  renderScale={2}                     // Manual DPR (default: window.devicePixelRatio)
  renderer="auto"                     // "auto" | "canvas2d" | "webgl"
  zIndex={0}                          // CSS z-index
  className="bg"                      // CSS class
  style={{ opacity: 0.9 }}            // CSS style object
  absolute={true}                     // Absolute positioning (default: true)
/>
```

### Svelte Component

```svelte
<DitheredBackground
  args={backgroundArgs}
  width={1920}
  height={1080}
  renderScale={2}
  renderer="auto"
  zIndex={0}
  class="bg"
  style="opacity: 0.9"
  absolute={true}
/>
```

### Preset Defaults

| Setting | Video | Still |
|---|---|---|
| Dither mode | `"ign"` | `"blue-noise"` |
| Dither amplitude | 1.35 | 1.0 |
| Color space | `"oklab"` | `"oklab"` |
| Grain scale | 1.5 | 1.5 |
| Grain monochrome | `true` | `true` |

**Video** defaults use IGN because YouTube/Vimeo re-encoding introduces its own noise floor that masks dither differences. IGN is faster and requires no texture memory.

**Still** defaults use blue noise because there is no compression to mask the dither pattern, so the higher spectral quality of blue noise (error energy at high frequencies) produces less perceptible grain.

## How It Works

### The Banding Problem

8-bit sRGB gradients band visibly in dark color ranges because the sRGB gamma curve allocates fewer code values to shadows. A gradient from `#0d0d0e` to `#18181b` has only ~10 distinct sRGB values — producing visible staircase steps.

### The Dithering Solution

This library adds carefully shaped noise **before** quantization to break up band edges:

1. Compute gradient color in **linear RGB** (perceptually correct math)
2. Convert to **sRGB float** (do NOT round yet)
3. Add **TPDF-shaped dither noise** (triangular distribution from two uncorrelated samples)
4. **Quantize** to 8-bit: `round(sRGB_float + noise)`

The TPDF shape (sum of two uniform random samples) eliminates noise-modulation artifacts that simpler uniform dither leaves behind. The default amplitude of ±1.5 LSB bridges 2–3 code levels, fully masking banding in typical dark-UI gradients.

### Oklab Color Space

Gradients interpolated in sRGB or linear-sRGB can produce unexpected hue shifts and muddy midtones. Oklab is a perceptually uniform color space where equal numerical distances correspond to equal perceived differences. This library defaults to Oklab interpolation, which produces cleaner transitions especially between colors that differ in hue.

### Rendering Pipeline

For each pixel in the output:

1. Map physical pixel to design-space coordinates (sub-pixel precision at HiDPI)
2. Start with `baseColor`
3. For each layer, in order:
   - Sample gradient progress (`t`) and mask from the layer's geometry
   - Interpolate color stops at `t` (in configured color space)
   - Apply shadow darkening
   - Apply layer grain
   - Composite onto accumulated color using layer blend mode and opacity
4. Apply global grain
5. Apply dither noise and quantize to 8-bit RGBA

The WebGL renderer implements this entire pipeline in a fragment shader for GPU acceleration, with automatic fallback to the CPU path if WebGL is unavailable or the configuration exceeds shader limits (>6 layers or >4 stops per layer).

## Server-Side Rendering

`renderBackgroundPixels()` returns a `Uint8ClampedArray` and requires no DOM APIs, making it usable in Node.js for generating gradient images server-side. The canvas-dependent functions (`renderBackgroundToCanvas`, `renderDitheredCanvas`, `renderBackgroundToCanvasWebGL`) require a browser environment or a canvas polyfill like `node-canvas`.

## License

MIT
