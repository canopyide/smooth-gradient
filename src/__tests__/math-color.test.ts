import { describe, expect, it } from "vitest";
import {
  linearRgbaToHex,
  oklabToLinearRgb,
  parseColorToLinearRgba,
  linearRgbToOklab,
} from "../core/color";
import {
  sampleBoxProgress,
  sampleLinearProgress,
  sampleRadialProgress,
} from "../core/math";

describe("background color utilities", () => {
  it("parses alpha channel from hex", () => {
    const parsed = parseColorToLinearRgba("#ff000080");

    expect(parsed.r).toBeCloseTo(1, 6);
    expect(parsed.g).toBeCloseTo(0, 6);
    expect(parsed.b).toBeCloseTo(0, 6);
    expect(parsed.a).toBeCloseTo(128 / 255, 6);
  });

  it("round-trips approximately through Oklab", () => {
    const original = parseColorToLinearRgba("#6ea8ff");
    const lab = linearRgbToOklab(original);
    const reconstructed = oklabToLinearRgb(lab, original.a);

    expect(reconstructed.r).toBeCloseTo(original.r, 4);
    expect(reconstructed.g).toBeCloseTo(original.g, 4);
    expect(reconstructed.b).toBeCloseTo(original.b, 4);
  });

  it("formats linear color back to hex", () => {
    const hex = linearRgbaToHex(parseColorToLinearRgba("#2a3b4c"));
    expect(hex).toBe("#2a3b4c");
  });
});

describe("background gradient math", () => {
  it("samples linear gradients with CSS angle fallback", () => {
    const top = sampleLinearProgress({ type: "linear", angle: 180 }, 50, 0, 100, 100);
    const bottom = sampleLinearProgress(
      { type: "linear", angle: 180 },
      50,
      100,
      100,
      100,
    );

    expect(top.t).toBeLessThan(bottom.t);
  });

  it("samples radial gradient distance correctly", () => {
    const center = sampleRadialProgress(
      {
        type: "radial",
        centerX: 50,
        centerY: 50,
        radiusX: 50,
        radiusY: 50,
      },
      50,
      50,
      100,
      100,
    );

    const edge = sampleRadialProgress(
      {
        type: "radial",
        centerX: 50,
        centerY: 50,
        radiusX: 50,
        radiusY: 50,
      },
      100,
      50,
      100,
      100,
    );

    expect(center.t).toBeCloseTo(0, 6);
    expect(edge.t).toBeCloseTo(1, 6);
  });

  it("masks pixels outside inset box gradients", () => {
    const outside = sampleBoxProgress(
      {
        type: "box",
        x: 10,
        y: 10,
        width: 20,
        height: 20,
        inset: true,
        blur: 10,
      },
      5,
      20,
      40,
      40,
    );

    const inside = sampleBoxProgress(
      {
        type: "box",
        x: 10,
        y: 10,
        width: 20,
        height: 20,
        inset: true,
        blur: 10,
      },
      11,
      20,
      40,
      40,
    );

    expect(outside.mask).toBe(0);
    expect(inside.mask).toBe(1);
    expect(inside.t).toBeGreaterThanOrEqual(0);
  });
});
