import type { BackgroundPreset } from "./types";

export const BACKGROUND_VIDEO_DEFAULTS = {
  ditherMode: "ign" as const,
  ditherAmplitude: 1.35,
  colorSpace: "oklab" as const,
  grainScale: 1.5,
  grainMonochrome: true,
};

export const BACKGROUND_STILL_DEFAULTS = {
  ditherMode: "blue-noise" as const,
  ditherAmplitude: 1.0,
  colorSpace: "oklab" as const,
  grainScale: 1.5,
  grainMonochrome: true,
};

export function getPresetDefaults(preset: BackgroundPreset) {
  return preset === "still" ? BACKGROUND_STILL_DEFAULTS : BACKGROUND_VIDEO_DEFAULTS;
}
