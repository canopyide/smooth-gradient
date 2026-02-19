<script lang="ts">
  import { parseBackgroundArgs, renderBackgroundToCanvas } from "../core/engine";
  import { renderBackgroundToCanvasWebGL } from "../core/webgl";
  import type { BackgroundArgs } from "../core/types";

  type DitheredBackgroundRenderer = "auto" | "canvas2d" | "webgl";

  interface Props {
    args: BackgroundArgs | string;
    width?: number;
    height?: number;
    renderScale?: number;
    renderer?: DitheredBackgroundRenderer;
    zIndex?: number;
    class?: string;
    style?: string;
    absolute?: boolean;
  }

  let {
    args,
    width = 1920,
    height = 1080,
    renderScale,
    renderer = "auto",
    zIndex = 0,
    class: className,
    style,
    absolute = true,
  }: Props = $props();

  let canvas: HTMLCanvasElement;

  const dpr = $derived(
    renderScale ?? (typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1)
  );
  const physicalWidth = $derived(Math.max(1, Math.round(width * dpr)));
  const physicalHeight = $derived(Math.max(1, Math.round(height * dpr)));

  const parsedArgs = $derived.by(() => {
    try {
      const key = typeof args === "string" ? args : JSON.stringify(args);
      return parseBackgroundArgs(key);
    } catch (error) {
      console.error("Failed to parse DitheredBackground args", error);
      return null;
    }
  });

  $effect(() => {
    if (!parsedArgs || !canvas) return;

    // Access reactive deps to trigger re-render
    void physicalWidth;
    void physicalHeight;

    const shouldTryWebGL = renderer === "auto" || renderer === "webgl";

    if (shouldTryWebGL) {
      const ok = renderBackgroundToCanvasWebGL(canvas, width, height, parsedArgs);
      if (ok) return;
    }

    renderBackgroundToCanvas(canvas, width, height, parsedArgs);
  });
</script>

<canvas
  bind:this={canvas}
  class={className}
  width={physicalWidth}
  height={physicalHeight}
  style:position={absolute ? "absolute" : undefined}
  style:top={absolute ? "0" : undefined}
  style:left={absolute ? "0" : undefined}
  style:width="{width}px"
  style:height="{height}px"
  style:pointer-events="none"
  style:z-index={zIndex}
  {style}
/>
