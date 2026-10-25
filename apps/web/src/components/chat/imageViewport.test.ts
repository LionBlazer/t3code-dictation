import { describe, expect, it } from "vite-plus/test";

import { clampImageTransform, fittedImageSize, zoomImageAt } from "./imageViewport";

describe("image viewport", () => {
  const viewport = { width: 1000, height: 600 };
  const image = { width: 960, height: 564 };

  it("fits portrait and landscape images while keeping their aspect ratio", () => {
    expect(fittedImageSize({ width: 2000, height: 1000 }, viewport)).toEqual({
      width: 960,
      height: 480,
    });
    expect(fittedImageSize({ width: 500, height: 2000 }, viewport)).toEqual({
      width: 141,
      height: 564,
    });
    expect(fittedImageSize({ width: 100, height: 50 }, viewport)).toEqual({
      width: 100,
      height: 50,
    });
  });

  it("keeps the cursor's image point stationary through repeated zooms", () => {
    const anchor = { x: 100, y: -50 };
    const initial = { zoom: 1, x: 0, y: 0 };
    const zoomed = zoomImageAt(initial, 2, anchor, image, viewport);
    expect(zoomed).toEqual({ zoom: 2, x: -100, y: 50 });
    const further = zoomImageAt(zoomed, 3, anchor, image, viewport);
    expect((anchor.x - further.x) / further.zoom).toBe(anchor.x);
    expect((anchor.y - further.y) / further.zoom).toBe(anchor.y);
  });

  it("uses the clamped zoom when anchoring at the zoom limit", () => {
    expect(zoomImageAt({ zoom: 4, x: -100, y: 0 }, 80, { x: 100, y: 0 }, image, viewport)).toEqual({
      zoom: 8,
      x: -300,
      y: 0,
    });
  });

  it("clamps dragging to the image edges and centers axes that fit", () => {
    expect(clampImageTransform({ zoom: 2, x: 1000, y: -1000 }, image, viewport)).toEqual({
      zoom: 2,
      x: 460,
      y: -264,
    });
    expect(
      clampImageTransform({ zoom: 2, x: 100, y: 100 }, { width: 200, height: 100 }, viewport),
    ).toEqual({ zoom: 2, x: 0, y: 0 });
  });

  it("returns to a centered fit without retaining the previous drag", () => {
    expect(
      zoomImageAt({ zoom: 5, x: 300, y: -400 }, 0.1, { x: 400, y: 200 }, image, viewport),
    ).toEqual({ zoom: 1, x: 0, y: 0 });
  });

  it("reclamps the position after the available viewport grows", () => {
    expect(
      clampImageTransform({ zoom: 2, x: 460, y: -264 }, image, { width: 1600, height: 1000 }),
    ).toEqual({ zoom: 2, x: 160, y: -64 });
  });
});
