import { describe, expect, it } from "vitest";
import {
  createGrainBackgroundArgs,
  createVignetteNoiseBackgroundArgs,
  withHexAlpha,
} from "../core/presets";

describe("background presets", () => {
  it("builds box-first vignette defaults for video", () => {
    const args = createVignetteNoiseBackgroundArgs({ baseColor: "#0d0d0e" });

    expect(args.preset).toBe("video");
    expect(args.grain?.monochrome).toBe(true);
    expect(args.layers?.[0]?.type).toBe("box");
    expect(args.layers?.length).toBeGreaterThanOrEqual(4);
    expect(args.layers?.some((layer) => layer.type === "radial")).toBe(true);

    const box = args.layers?.[0];
    if (!box || box.type !== "box") {
      throw new Error("expected first layer to be box");
    }

    expect(box.inset).toBe(true);
    expect((box.blur ?? 0) > 0).toBe(true);
    expect((box.shadow?.startIntensity ?? 0) > 0.3).toBe(true);
  });

  it("supports still preset and grain-only preset", () => {
    const still = createVignetteNoiseBackgroundArgs({ preset: "still" });
    const grainOnly = createGrainBackgroundArgs({ preset: "still" });

    expect(still.preset).toBe("still");
    expect(grainOnly.preset).toBe("still");
    expect(grainOnly.layers).toBeUndefined();
    expect((grainOnly.grain?.amount ?? 0) > 0).toBe(true);
  });

  it("applies alpha channel to hex colors", () => {
    expect(withHexAlpha("#abc", 0.5)).toBe("#aabbcc80");
    expect(withHexAlpha("#112233", 1)).toBe("#112233ff");
  });
});
