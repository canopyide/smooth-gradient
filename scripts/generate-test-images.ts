/**
 * Generate test PNG images to visually verify gradient rendering quality.
 *
 * Run:  npx tsx scripts/generate-test-images.ts
 *
 * Output goes to  test-output/
 */

import { PNG } from "pngjs";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { renderBackgroundPixels } from "../src/core/engine";
import {
  createVignetteNoiseBackgroundArgs,
  createSignatureBackgroundArgs,
} from "../src/core/presets";
import type { BackgroundArgs } from "../src/core/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, "../test-output");

function savePng(
  name: string,
  width: number,
  height: number,
  pixels: Uint8ClampedArray,
): void {
  const png = new PNG({ width, height });
  for (let i = 0; i < width * height * 4; i++) {
    png.data[i] = pixels[i];
  }
  const filePath = path.join(OUT_DIR, `${name}.png`);
  const buffer = PNG.sync.write(png);
  fs.writeFileSync(filePath, buffer);
  console.log(`  ✓ ${filePath}`);
}

function render(
  name: string,
  width: number,
  height: number,
  args: BackgroundArgs,
): void {
  const pixels = renderBackgroundPixels(args, width, height);
  savePng(name, width, height, pixels);
}

// ── Ensure output dir exists ────────────────────────────────────────────

fs.mkdirSync(OUT_DIR, { recursive: true });
console.log("Generating test images…\n");

// ── 1. Dark linear gradient — dithered, no grain ───────────────────────
// Expected: Smooth top-to-bottom gradient, no visible banding.

render("01-dark-linear-no-grain", 640, 360, {
  preset: "still",
  baseColor: "#2a2a30",
  layers: [
    {
      type: "linear",
      angle: 180,
      colors: { start: "#2a2a30", end: "#0d0d0e" },
      colorSpace: "oklab",
    },
  ],
});

// ── 2. Radial gradient — dithered, no grain ────────────────────────────
// Expected: Lighter centre, smooth falloff to dark edges.

render("02-radial-no-grain", 640, 360, {
  preset: "still",
  baseColor: "#0a0a0c",
  layers: [
    {
      type: "radial",
      centerX: 320,
      centerY: 180,
      radiusX: 400,
      radiusY: 250,
      colors: { start: "#3a3a42", end: "#0a0a0c" },
      colorSpace: "oklab",
      falloff: 1.5,
    },
  ],
});

// ── 3. Box shadow inset — CSS-like rounded inner shadow ─────────────────
// Expected: Rounded shadow that fills the corners more than the edges,
//           just like CSS `box-shadow: inset 0 0 120px 15px`.
//           Bright center, dark edges with smooth S-curve transition.

render("03-box-shadow-inset", 640, 360, {
  preset: "still",
  baseColor: "#3a3a42",
  dither: { mode: "blue-noise", amplitude: 1.0 },
  layers: [
    {
      type: "box",
      x: 0,
      y: 0,
      width: 640,
      height: 360,
      radius: 40,
      spread: 15,
      blur: 120,
      inset: true,
      colors: { start: "#3a3a42", end: "#10101a" },
      colorSpace: "oklab",
      shadow: {
        startIntensity: 0.6,
        endIntensity: 0.0,
        curve: 1.0,
      },
    },
  ],
});

// ── 4. Box shadow inset — zero spread vs high spread comparison ─────────
// Shows how spread contracts the inner hole, making shadow thicker.

render("04-box-shadow-spread-comparison", 640, 360, {
  preset: "still",
  baseColor: "#3a3a42",
  layers: [
    // Left half: narrow shadow (spread=0)
    {
      type: "box",
      x: 0,
      y: 0,
      width: 300,
      height: 360,
      radius: 30,
      spread: 0,
      blur: 80,
      inset: true,
      colors: { start: "#3a3a42", end: "#0a0a10" },
      shadow: { startIntensity: 0.7, endIntensity: 0.0, curve: 1.0 },
    },
    // Right half: wide shadow (spread=30)
    {
      type: "box",
      x: 340,
      y: 0,
      width: 300,
      height: 360,
      radius: 30,
      spread: 30,
      blur: 80,
      inset: true,
      colors: { start: "#3a3a42", end: "#0a0a10" },
      shadow: { startIntensity: 0.7, endIntensity: 0.0, curve: 1.0 },
    },
  ],
});

// ── 5. Combined: radial + grain + dither (the banding-prone scenario) ───
// Expected: Smooth radial with uniform film grain, NO banding.

render("05-combined-radial-grain", 640, 360, {
  preset: "still",
  baseColor: "#0d0d0e",
  grain: {
    amount: 0.006,
    scale: 1.85,
    seed: 42,
    monochrome: true,
  },
  layers: [
    {
      type: "radial",
      centerX: 300,
      centerY: 160,
      radiusX: 500,
      radiusY: 320,
      innerRadius: 0.3,
      outerRadius: 1.1,
      falloff: 1.4,
      colors: { start: "#2a2a32", end: "#0a0a0c" },
      colorSpace: "oklab",
      shadow: {
        startIntensity: 0,
        endIntensity: 0.3,
        curve: 1.6,
      },
    },
  ],
});

// ── 6. Vignette preset (video) — brighter base so effect is visible ─────

render(
  "06-vignette-preset-video",
  640,
  360,
  createVignetteNoiseBackgroundArgs({
    width: 640,
    height: 360,
    preset: "video",
    baseColor: "#2a2a30",
  }),
);

// ── 7. Vignette preset (still) ─────────────────────────────────────────

render(
  "07-vignette-preset-still",
  640,
  360,
  createVignetteNoiseBackgroundArgs({
    width: 640,
    height: 360,
    preset: "still",
    baseColor: "#2a2a30",
  }),
);

// ── 8. Signature background ────────────────────────────────────────────

render(
  "08-signature-preset",
  640,
  360,
  createSignatureBackgroundArgs({ width: 640, height: 360 }),
);

// ── 9. Grain uniformity — dark solid with visible grain ─────────────────
// Shows that grain is perceptually even across a dark background.

render("09-grain-uniformity-dark", 640, 360, {
  preset: "still",
  baseColor: "#1a1a1e",
  grain: {
    amount: 0.012,
    scale: 1.5,
    seed: 99,
    monochrome: true,
  },
});

// ── 10. Box shadow outer ────────────────────────────────────────────────
// Shadow expanding outward from a smaller rect.

render("10-box-shadow-outer", 640, 360, {
  preset: "still",
  baseColor: "#2a2a30",
  layers: [
    {
      type: "box",
      x: 170,
      y: 80,
      width: 300,
      height: 200,
      radius: 24,
      spread: 10,
      blur: 60,
      inset: false,
      colors: { start: "#000000", end: "#0a0a0c" },
      colorSpace: "oklab",
    },
  ],
});

// ── 11. Multi-layer composite ───────────────────────────────────────────

render("11-multi-layer-composite", 640, 360, {
  preset: "still",
  baseColor: "#252530",
  grain: {
    amount: 0.006,
    scale: 1.85,
    seed: 7,
    monochrome: true,
  },
  layers: [
    {
      type: "radial",
      centerX: 320,
      centerY: 180,
      radiusX: 380,
      radiusY: 220,
      innerRadius: 0.25,
      outerRadius: 1.15,
      falloff: 1.4,
      power: 5,
      blendMode: "multiply",
      opacity: 0.7,
      colors: { start: "#0e1018", end: "#252530" },
      colorSpace: "oklab",
      shadow: {
        startIntensity: 0.02,
        endIntensity: 0.45,
        curve: 1.2,
      },
    },
    {
      type: "radial",
      centerX: 280,
      centerY: 150,
      radiusX: 350,
      radiusY: 220,
      innerRadius: 0.4,
      outerRadius: 1.0,
      falloff: 1.8,
      blendMode: "screen",
      opacity: 0.12,
      colors: { start: "#3a3a48", end: "#000000" },
      colorSpace: "oklab",
    },
  ],
});

// ── 12. Linear gradient L→R + squircle vignette + grain ─────────────────
// Expected: Visible left-to-right gradient from warm-dark to cool-dark,
//           with smooth squircle (Lp, p=4) vignette darkening all edges/corners,
//           no diagonal seam artifacts, and subtle film grain throughout.

render("12-linear-plus-vignette-grain", 640, 360, {
  preset: "still",
  baseColor: "#1e1e24",
  grain: {
    amount: 0.005,
    scale: 1.85,
    seed: 42,
    monochrome: true,
  },
  dither: { mode: "blue-noise", amplitude: 1.0 },
  layers: [
    // Left-to-right linear gradient (base layer)
    {
      type: "linear",
      angle: 90,
      colors: { start: "#3a2e30", end: "#1a2230" },
      colorSpace: "oklab",
    },
    // Squircle vignette (Lp norm, p=4 — smooth rectangular shape, no seam artifacts)
    {
      type: "radial",
      blendMode: "multiply",
      opacity: 0.55,
      centerX: 320,
      centerY: 180,
      radiusX: 380,
      radiusY: 220,
      innerRadius: 0.3,
      outerRadius: 1.15,
      falloff: 1.5,
      power: 4,
      stops: [
        { position: 0, color: "#fefefe" },
        { position: 0.6, color: "#b0b0b8" },
        { position: 1, color: "#606068" },
      ],
      colorSpace: "oklab",
      shadow: {
        startIntensity: 0,
        endIntensity: 0.15,
        curve: 1.3,
      },
    },
  ],
});

console.log("\nDone. Check test-output/ for results.\n");

console.log("Expected observations:");
console.log("  01: Smooth dark gradient, no banding.");
console.log("  02: Smooth radial with lighter centre.");
console.log("  03: Rounded inner shadow — corners filled more than edges (CSS-like).");
console.log("  04: Spread comparison — left (spread=0) narrow rim, right (spread=30) thick shadow.");
console.log("  05: Radial + grain — uniform film grain, no banding in dark areas.");
console.log("  06: Video vignette — warm centre, cool edges (brighter base).");
console.log("  07: Still vignette — blue-noise variant.");
console.log("  08: Signature — mid-tone with gentle shadow vignette.");
console.log("  09: Grain uniformity — even grain across dark surface.");
console.log("  10: Outer box shadow — shadow expanding outward from rect.");
console.log("  11: Multi-layer composite — box + radial + grain.");
console.log("  12: Linear L→R gradient + inset vignette + grain.");
