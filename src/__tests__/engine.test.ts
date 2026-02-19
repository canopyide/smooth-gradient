import { describe, expect, it } from "vitest";
import {
  parseBackgroundArgs,
  renderBackgroundPixels,
  resolveBackgroundArgs,
} from "../core/engine";
import type { BackgroundArgs } from "../core/types";

const pixelAt = (
  pixels: Uint8ClampedArray,
  width: number,
  x: number,
  y: number,
): [number, number, number, number] => {
  const index = (y * width + x) * 4;
  return [
    pixels[index],
    pixels[index + 1],
    pixels[index + 2],
    pixels[index + 3],
  ];
};

describe("background engine", () => {
  it("expands start/mid/end colors into ordered stops", () => {
    const resolved = resolveBackgroundArgs({
      layers: [
        {
          type: "linear",
          colors: {
            start: "#000000",
            mid: "#ff0000",
            end: "#ffffff",
          },
          midpoint: 0.25,
        },
      ],
      dither: {
        mode: "none",
      },
    });

    const firstLayer = resolved.layers[0] as unknown as {
      stops: { position: number }[];
    };

    expect(firstLayer.stops.map((stop) => stop.position)).toEqual([0, 0.25, 1]);
  });

  it("renders linear gradients with correct endpoint and midpoint quantization", () => {
    const args: BackgroundArgs = {
      dither: {
        mode: "none",
      },
      layers: [
        {
          type: "linear",
          startX: 0,
          startY: 0,
          endX: 2,
          endY: 0,
          colors: {
            start: "#000000",
            end: "#ffffff",
          },
          colorSpace: "linear-srgb",
        },
      ],
    };

    const pixels = renderBackgroundPixels(args, 3, 1);

    const left = pixelAt(pixels, 3, 0, 0);
    const middle = pixelAt(pixels, 3, 1, 0);
    const right = pixelAt(pixels, 3, 2, 0);

    expect(left[0]).toBe(0);
    expect(right[0]).toBe(255);
    expect(middle[0]).toBeGreaterThanOrEqual(186);
    expect(middle[0]).toBeLessThanOrEqual(189);
    expect(middle[1]).toBe(middle[0]);
    expect(middle[2]).toBe(middle[0]);
  });

  it("honors midpoint colors exactly when sampling at midpoint", () => {
    const args: BackgroundArgs = {
      dither: {
        mode: "none",
      },
      layers: [
        {
          type: "linear",
          startX: 0,
          startY: 0,
          endX: 2,
          endY: 0,
          colors: {
            start: "#000000",
            mid: "#ff0000",
            end: "#ffffff",
          },
          midpoint: 0.5,
          colorSpace: "linear-srgb",
        },
      ],
    };

    const pixels = renderBackgroundPixels(args, 3, 1);
    const middle = pixelAt(pixels, 3, 1, 0);

    expect(middle[0]).toBe(255);
    expect(middle[1]).toBe(0);
    expect(middle[2]).toBe(0);
  });

  it("applies shadow intensity along gradient progress", () => {
    const args: BackgroundArgs = {
      dither: {
        mode: "none",
      },
      layers: [
        {
          type: "linear",
          startX: 0,
          startY: 0,
          endX: 2,
          endY: 0,
          colors: {
            start: "#ffffff",
            end: "#ffffff",
          },
          shadow: {
            startIntensity: 0,
            endIntensity: 0.8,
          },
          colorSpace: "linear-srgb",
        },
      ],
    };

    const pixels = renderBackgroundPixels(args, 3, 1);
    const start = pixelAt(pixels, 3, 0, 0);
    const end = pixelAt(pixels, 3, 2, 0);

    expect(start[0]).toBe(255);
    expect(end[0]).toBeLessThan(130);
    expect(start[0] - end[0]).toBeGreaterThan(120);
  });

  it("renders inset box gradients with spread and blur inside the box only", () => {
    const args: BackgroundArgs = {
      baseColor: "#000000",
      dither: {
        mode: "none",
      },
      layers: [
        {
          type: "box",
          x: 10,
          y: 10,
          width: 20,
          height: 20,
          radius: 0,
          spread: 0,
          blur: 10,
          inset: true,
          colors: {
            start: "#ffffff",
            end: "#000000",
          },
          colorSpace: "linear-srgb",
        },
      ],
    };

    const pixels = renderBackgroundPixels(args, 40, 40);
    const outside = pixelAt(pixels, 40, 5, 20);
    const edgeInside = pixelAt(pixels, 40, 11, 20);
    const centerInside = pixelAt(pixels, 40, 20, 20);

    expect(outside[0]).toBe(0);
    expect(edgeInside[0]).toBeGreaterThan(centerInside[0]);
    expect(edgeInside[0]).toBeGreaterThan(150);
  });

  it("keeps grain deterministic per seed and varies across seeds", () => {
    const baseArgs: BackgroundArgs = {
      baseColor: "#202020",
      dither: {
        mode: "none",
      },
      grain: {
        amount: 0.02,
        scale: 1.7,
        seed: 5,
      },
    };

    const a = renderBackgroundPixels(baseArgs, 8, 8);
    const b = renderBackgroundPixels(baseArgs, 8, 8);
    const c = renderBackgroundPixels(
      {
        ...baseArgs,
        grain: {
          ...baseArgs.grain,
          seed: 6,
        },
      },
      8,
      8,
    );

    expect(Array.from(a)).toEqual(Array.from(b));
    expect(Array.from(a)).not.toEqual(Array.from(c));
  });

  it("adds pre-quantization dither variation when enabled", () => {
    const noDither = renderBackgroundPixels(
      {
        baseColor: "#101010",
        dither: {
          mode: "none",
        },
      },
      64,
      1,
    );

    const withDither = renderBackgroundPixels(
      {
        baseColor: "#101010",
        dither: {
          mode: "ign",
          amplitude: 1.5,
        },
      },
      64,
      1,
    );

    const noDitherValues = new Set<number>();
    const ditherValues = new Set<number>();

    for (let x = 0; x < 64; x++) {
      noDitherValues.add(pixelAt(noDither, 64, x, 0)[0]);
      ditherValues.add(pixelAt(withDither, 64, x, 0)[0]);
    }

    expect(noDitherValues.size).toBe(1);
    expect(ditherValues.size).toBeGreaterThan(1);
  });

  it("parses JSON args", () => {
    const parsed = parseBackgroundArgs(
      '{"baseColor":"#000000","dither":{"mode":"none"},"layers":[]}',
    );

    expect(parsed.baseColor).toBe("#000000");
    expect(parsed.layers).toEqual([]);
  });

  it("uses video preset defaults when omitted", () => {
    const resolved = resolveBackgroundArgs({
      baseColor: "#000000",
      layers: [],
    });

    expect(resolved.preset).toBe("video");
    expect(resolved.ditherMode).toBe("ign");
    expect(resolved.ditherAmplitude).toBeCloseTo(1.35, 6);
  });

  it("uses still preset defaults when requested", () => {
    const resolved = resolveBackgroundArgs({
      preset: "still",
      baseColor: "#000000",
      layers: [],
    });

    expect(resolved.preset).toBe("still");
    expect(resolved.ditherMode).toBe("blue-noise");
    expect(resolved.ditherAmplitude).toBeCloseTo(1, 6);
  });
});
