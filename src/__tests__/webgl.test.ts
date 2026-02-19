import { describe, expect, it } from "vitest";
import {
  BACKGROUND_WEBGL_LIMITS,
  canRenderBackgroundWithWebGL,
} from "../core/webgl";
import { createSignatureBackgroundArgs } from "../core/presets";
import type { BackgroundArgs } from "../core/types";

describe("background webgl eligibility", () => {
  it("supports the signature preset", () => {
    const args = createSignatureBackgroundArgs({
      width: 1920,
      height: 1080,
      grainSeed: 777,
    });

    const support = canRenderBackgroundWithWebGL(args);
    expect(support.supported).toBe(true);
  });

  it("rejects args that exceed max layer count", () => {
    const args: BackgroundArgs = {
      baseColor: "#101010",
      layers: Array.from(
        { length: BACKGROUND_WEBGL_LIMITS.maxLayers + 1 },
        () => ({
          type: "linear" as const,
          startX: 0,
          startY: 0,
          endX: 100,
          endY: 0,
          colors: {
            start: "#101010",
            end: "#202020",
          },
        }),
      ),
    };

    const support = canRenderBackgroundWithWebGL(args);
    expect(support.supported).toBe(false);
    expect(support.reason).toContain("layers");
  });

  it("rejects args that exceed max stops per layer", () => {
    const args: BackgroundArgs = {
      baseColor: "#101010",
      layers: [
        {
          type: "linear",
          startX: 0,
          startY: 0,
          endX: 100,
          endY: 0,
          stops: Array.from(
            { length: BACKGROUND_WEBGL_LIMITS.maxStopsPerLayer + 1 },
            (_, i) => ({
              position: i / BACKGROUND_WEBGL_LIMITS.maxStopsPerLayer,
              color: i % 2 === 0 ? "#101010" : "#202020",
            }),
          ),
        },
      ],
    };

    const support = canRenderBackgroundWithWebGL(args);
    expect(support.supported).toBe(false);
    expect(support.reason).toContain("stops");
  });
});
