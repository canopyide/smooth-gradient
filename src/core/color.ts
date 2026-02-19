import { linearToSrgb8, srgbToLinear } from "./dither";
import type { BackgroundColorSpace, LinearRgba } from "./types";

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export const lerp = (start: number, end: number, t: number): number =>
  start + (end - start) * t;

function expandHexShorthand(hex: string): string {
  if (hex.length !== 3 && hex.length !== 4) {
    return hex;
  }

  return hex
    .split("")
    .map((c) => `${c}${c}`)
    .join("");
}

function parseHexToRgbaBytes(input: string): [number, number, number, number] {
  const trimmed = input.trim();
  const withoutHash = trimmed.startsWith("#") ? trimmed.slice(1) : trimmed;
  const expanded = expandHexShorthand(withoutHash);

  if (expanded.length !== 6 && expanded.length !== 8) {
    throw new Error(
      `Unsupported color format "${input}". Use #RGB, #RGBA, #RRGGBB, or #RRGGBBAA.`,
    );
  }

  if (!/^[0-9a-fA-F]+$/.test(expanded)) {
    throw new Error(`Color "${input}" contains non-hex characters.`);
  }

  const r = Number.parseInt(expanded.slice(0, 2), 16);
  const g = Number.parseInt(expanded.slice(2, 4), 16);
  const b = Number.parseInt(expanded.slice(4, 6), 16);
  const a = expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) : 255;

  return [r, g, b, a];
}

export function parseColorToLinearRgba(input: string): LinearRgba {
  const [r, g, b, a] = parseHexToRgbaBytes(input);

  return {
    r: srgbToLinear(r),
    g: srgbToLinear(g),
    b: srgbToLinear(b),
    a: a / 255,
  };
}

export function linearRgbaToHex(color: LinearRgba): string {
  const r = Math.round(clamp01(linearToSrgb8(color.r) / 255) * 255);
  const g = Math.round(clamp01(linearToSrgb8(color.g) / 255) * 255);
  const b = Math.round(clamp01(linearToSrgb8(color.b) / 255) * 255);
  const a = Math.round(clamp01(color.a) * 255);

  const toHex = (value: number): string => value.toString(16).padStart(2, "0");

  return `#${toHex(r)}${toHex(g)}${toHex(b)}${a < 255 ? toHex(a) : ""}`;
}

export function clampLinearRgba(color: LinearRgba): LinearRgba {
  return {
    r: clamp01(color.r),
    g: clamp01(color.g),
    b: clamp01(color.b),
    a: clamp01(color.a),
  };
}

export type Oklab = [number, number, number];

export function linearRgbToOklab(color: LinearRgba): Oklab {
  const l = 0.4122214708 * color.r + 0.5363325363 * color.g + 0.0514459929 * color.b;
  const m = 0.2119034982 * color.r + 0.6806995451 * color.g + 0.1073969566 * color.b;
  const s = 0.0883024619 * color.r + 0.2817188376 * color.g + 0.6299787005 * color.b;

  const lRoot = Math.cbrt(Math.max(0, l));
  const mRoot = Math.cbrt(Math.max(0, m));
  const sRoot = Math.cbrt(Math.max(0, s));

  return [
    0.2104542553 * lRoot + 0.793617785 * mRoot - 0.0040720468 * sRoot,
    1.9779984951 * lRoot - 2.428592205 * mRoot + 0.4505937099 * sRoot,
    0.0259040371 * lRoot + 0.7827717662 * mRoot - 0.808675766 * sRoot,
  ];
}

export function oklabToLinearRgb(lab: Oklab, alpha = 1): LinearRgba {
  const [l, a, b] = lab;

  const lPrime = l + 0.3963377774 * a + 0.2158037573 * b;
  const mPrime = l - 0.1055613458 * a - 0.0638541728 * b;
  const sPrime = l - 0.0894841775 * a - 1.291485548 * b;

  const l3 = lPrime * lPrime * lPrime;
  const m3 = mPrime * mPrime * mPrime;
  const s3 = sPrime * sPrime * sPrime;

  return clampLinearRgba({
    r: +4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3,
    g: -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3,
    b: -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3,
    a: alpha,
  });
}

export function interpolateLinearRgba(
  start: LinearRgba,
  end: LinearRgba,
  t: number,
  colorSpace: BackgroundColorSpace,
): LinearRgba {
  const tt = clamp01(t);

  if (colorSpace === "linear-srgb") {
    return {
      r: lerp(start.r, end.r, tt),
      g: lerp(start.g, end.g, tt),
      b: lerp(start.b, end.b, tt),
      a: lerp(start.a, end.a, tt),
    };
  }

  const startLab = linearRgbToOklab(start);
  const endLab = linearRgbToOklab(end);

  return oklabToLinearRgb(
    [
      lerp(startLab[0], endLab[0], tt),
      lerp(startLab[1], endLab[1], tt),
      lerp(startLab[2], endLab[2], tt),
    ],
    lerp(start.a, end.a, tt),
  );
}
