import { describe, expect, it } from "vitest";
import {
  hexToRgb,
  hexToLinearRgb,
  srgbToLinear,
  linearToSrgb8,
  ign,
  getDitherValue,
} from "../core/dither";

describe("dither core", () => {
  it("parses 3-char hex to RGB", () => {
    expect(hexToRgb("#fff")).toEqual([255, 255, 255]);
    expect(hexToRgb("#000")).toEqual([0, 0, 0]);
    expect(hexToRgb("#f00")).toEqual([255, 0, 0]);
  });

  it("parses 6-char hex to RGB", () => {
    expect(hexToRgb("#18181b")).toEqual([24, 24, 27]);
  });

  it("round-trips sRGB through linear and back", () => {
    for (const value of [0, 50, 128, 200, 255]) {
      const linear = srgbToLinear(value);
      const back = linearToSrgb8(linear);
      expect(Math.round(back)).toBe(value);
    }
  });

  it("produces IGN values in [0, 1)", () => {
    for (let x = 0; x < 64; x++) {
      for (let y = 0; y < 64; y++) {
        const v = ign(x, y);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });

  it("produces deterministic IGN values", () => {
    expect(ign(10, 20)).toBe(ign(10, 20));
    expect(ign(10, 20)).not.toBe(ign(10, 21));
  });

  it("produces TPDF dither values within amplitude range", () => {
    const amp = 1.5;
    for (let x = 0; x < 32; x++) {
      for (let y = 0; y < 32; y++) {
        const v = getDitherValue(x, y, "ign", amp);
        expect(v).toBeGreaterThanOrEqual(-amp);
        expect(v).toBeLessThanOrEqual(amp);
      }
    }
  });

  it("hexToLinearRgb returns values in [0, 1]", () => {
    const [r, g, b] = hexToLinearRgb("#18181b");
    expect(r).toBeGreaterThanOrEqual(0);
    expect(r).toBeLessThanOrEqual(1);
    expect(g).toBeGreaterThanOrEqual(0);
    expect(g).toBeLessThanOrEqual(1);
    expect(b).toBeGreaterThanOrEqual(0);
    expect(b).toBeLessThanOrEqual(1);
  });
});
