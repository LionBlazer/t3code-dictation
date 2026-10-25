interface ImageViewportSize {
  readonly width: number;
  readonly height: number;
}

export interface ImageViewportTransform {
  readonly zoom: number;
  readonly x: number;
  readonly y: number;
}

export const IMAGE_VIEWPORT_MAX_ZOOM = 8;

export function fittedImageSize(
  image: ImageViewportSize,
  viewport: ImageViewportSize,
): ImageViewportSize {
  const fit = Math.min(
    1,
    (viewport.width * 0.96) / Math.max(1, image.width),
    (viewport.height * 0.94) / Math.max(1, image.height),
  );
  return { width: image.width * fit, height: image.height * fit };
}

export function clampImageTransform(
  transform: ImageViewportTransform,
  image: ImageViewportSize,
  viewport: ImageViewportSize,
): ImageViewportTransform {
  const zoom = Math.min(IMAGE_VIEWPORT_MAX_ZOOM, Math.max(1, transform.zoom));
  const maxX = Math.max(0, (image.width * zoom - viewport.width) / 2);
  const maxY = Math.max(0, (image.height * zoom - viewport.height) / 2);
  return {
    zoom,
    x: zoom === 1 ? 0 : Math.max(-maxX, Math.min(maxX, transform.x)),
    y: zoom === 1 ? 0 : Math.max(-maxY, Math.min(maxY, transform.y)),
  };
}

/** The anchor is measured from the viewport center, so zoom does not move the inspected pixel. */
export function zoomImageAt(
  transform: ImageViewportTransform,
  zoom: number,
  anchor: { readonly x: number; readonly y: number },
  image: ImageViewportSize,
  viewport: ImageViewportSize,
): ImageViewportTransform {
  const nextZoom = Math.min(IMAGE_VIEWPORT_MAX_ZOOM, Math.max(1, zoom));
  const ratio = nextZoom / transform.zoom;
  return clampImageTransform(
    {
      zoom: nextZoom,
      x: anchor.x - (anchor.x - transform.x) * ratio,
      y: anchor.y - (anchor.y - transform.y) * ratio,
    },
    image,
    viewport,
  );
}
