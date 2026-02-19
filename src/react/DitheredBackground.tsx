import React from "react";
import { parseBackgroundArgs, renderBackgroundToCanvas } from "../core/engine";
import { renderBackgroundToCanvasWebGL } from "../core/webgl";
import type { BackgroundArgs } from "../core/types";

const DEFAULT_WIDTH = 1920;
const DEFAULT_HEIGHT = 1080;
export type DitheredBackgroundRenderer = "auto" | "canvas2d" | "webgl";

export interface DitheredBackgroundProps {
  args: BackgroundArgs | string;
  width?: number;
  height?: number;
  renderScale?: number;
  renderer?: DitheredBackgroundRenderer;
  zIndex?: number;
  className?: string;
  style?: React.CSSProperties;
  absolute?: boolean;
}

export const DitheredBackground: React.FC<DitheredBackgroundProps> = ({
  args,
  width = DEFAULT_WIDTH,
  height = DEFAULT_HEIGHT,
  renderScale,
  renderer = "auto",
  zIndex = 0,
  className,
  style,
  absolute = true,
}) => {
  const canvasRef = React.useRef<HTMLCanvasElement>(null);

  const argsKey = typeof args === "string" ? args : JSON.stringify(args);

  const parsedArgs = React.useMemo(() => {
    try {
      return parseBackgroundArgs(argsKey);
    } catch (error) {
      // Keep render path safe; invalid JSON should not crash the full composition.
      console.error("Failed to parse DitheredBackground args", error);
      return null;
    }
  }, [argsKey]);

  const dpr =
    renderScale ??
    (typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
  const physicalWidth = Math.max(1, Math.round(width * dpr));
  const physicalHeight = Math.max(1, Math.round(height * dpr));

  React.useEffect(() => {
    if (!parsedArgs) {
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const shouldTryWebGL = renderer === "auto" || renderer === "webgl";

    if (shouldTryWebGL) {
      const renderedViaWebGL = renderBackgroundToCanvasWebGL(
        canvas,
        width,
        height,
        parsedArgs,
      );
      if (renderedViaWebGL) {
        return;
      }
    }

    renderBackgroundToCanvas(canvas, width, height, parsedArgs);
  }, [parsedArgs, renderer, width, height, physicalWidth, physicalHeight]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      width={physicalWidth}
      height={physicalHeight}
      style={{
        ...(absolute ? { position: "absolute", top: 0, left: 0 } : null),
        width,
        height,
        pointerEvents: "none",
        zIndex,
        ...style,
      }}
    />
  );
};
