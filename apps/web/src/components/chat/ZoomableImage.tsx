import { useEffect, useLayoutEffect, useRef, type PointerEvent } from "react";

import { useStableCallback } from "../../hooks/useStableCallback";
import { observeResize } from "../../lib/observeResize";
import { isContextMenuOpen } from "../../contextMenuFallback";
import { AttachmentImage } from "../media/AttachmentImage";
import {
  clampImageTransform,
  fittedImageSize,
  zoomImageAt,
  type ImageViewportTransform,
} from "./imageViewport";

export function ZoomableImage({
  src,
  name,
  mimeType,
  onError,
  onClose,
  onNavigate,
}: {
  src: string;
  name: string;
  mimeType?: string | undefined;
  onError: () => void;
  onClose: () => void;
  onNavigate: (direction: -1 | 1) => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const frameRef = useRef<number | null>(null);
  const viewRef = useRef<ImageViewportTransform>({ zoom: 1, x: 0, y: 0 });
  const sizesRef = useRef({
    natural: { width: 0, height: 0 },
    image: { width: 0, height: 0 },
    viewport: { width: 0, height: 0 },
  });
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const movedRef = useRef(false);
  const pressedRef = useRef(false);
  const pointerStartRef = useRef({ x: 0, y: 0 });

  const paint = useStableCallback(() => {
    const viewport = viewportRef.current;
    const image = imageRef.current;
    if (!viewport || !image) return;
    const view = viewRef.current;
    image.style.transform = `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.zoom})`;
    viewport.dataset.zoom = String(view.zoom);
    viewport.style.cursor = movedRef.current && pointersRef.current.size ? "move" : "default";
  });

  const changeView = useStableCallback((view: ImageViewportTransform) => {
    const { image, viewport } = sizesRef.current;
    viewRef.current = clampImageTransform(view, image, viewport);
    // Only input schedules a paint. Transforming the decoded image avoids layout and React work.
    if (frameRef.current !== null) return;
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      paint();
    });
  });

  const zoomTo = useStableCallback((zoom: number, point?: { x: number; y: number }) => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const bounds = viewport.getBoundingClientRect();
    const { image, viewport: size } = sizesRef.current;
    const anchor = point
      ? { x: point.x - bounds.left - size.width / 2, y: point.y - bounds.top - size.height / 2 }
      : { x: 0, y: 0 };
    changeView(zoomImageAt(viewRef.current, zoom, anchor, image, size));
  });

  const measure = useStableCallback(() => {
    const viewport = viewportRef.current;
    const image = imageRef.current;
    if (!viewport || !image) return;
    const size = { width: viewport.clientWidth, height: viewport.clientHeight };
    const fitted = fittedImageSize(sizesRef.current.natural, size);
    sizesRef.current.viewport = size;
    sizesRef.current.image = fitted;
    image.style.width = `${fitted.width}px`;
    image.style.height = `${fitted.height}px`;
    image.style.marginLeft = `${-fitted.width / 2}px`;
    image.style.marginTop = `${-fitted.height / 2}px`;
    viewRef.current = clampImageTransform(viewRef.current, fitted, size);
    paint();
  });

  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    // A gallery change replaces the canvas; keep keyboard navigation inside the dialog.
    viewport.focus({ preventScroll: true });
    measure();
    return observeResize(viewport, measure);
  }, [measure]);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const wheel = (event: WheelEvent) => {
      if (event.deltaY === 0) return;
      event.preventDefault();
      event.stopPropagation();
      if (isContextMenuOpen()) return;
      if (!event.ctrlKey) {
        onNavigate(event.deltaY > 0 ? 1 : -1);
        return;
      }
      // Chromium represents one wheel notch as 100 pixels (or three lines).
      const steps = -event.deltaY / (event.deltaMode === 1 ? 3 : event.deltaMode === 2 ? 1 : 100);
      zoomTo(viewRef.current.zoom * 1.22 ** steps, {
        x: event.clientX,
        y: event.clientY,
      });
    };
    viewport.addEventListener("wheel", wheel, { passive: false });
    return () => viewport.removeEventListener("wheel", wheel);
  }, [zoomTo, onNavigate]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  const releasePointer = (event: PointerEvent<HTMLDivElement>) => {
    if (event.type === "pointercancel") movedRef.current = true;
    pointersRef.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    changeView(viewRef.current);
  };

  return (
    <div
      ref={viewportRef}
      role="region"
      aria-label={`${name}, zoomable image`}
      aria-description="Ctrl + wheel or pinch to zoom at the pointer. Drag to pan. Wheel or Left and Right arrows switch images. Click or press Escape to close."
      tabIndex={0}
      className="relative min-h-0 w-full flex-1 touch-none overflow-hidden overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/50"
      onClick={() => {
        if (pressedRef.current && !movedRef.current && !isContextMenuOpen()) onClose();
        pressedRef.current = false;
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || isContextMenuOpen()) return;
        if (pointersRef.current.size === 0) {
          movedRef.current = false;
          pressedRef.current = true;
          pointerStartRef.current = { x: event.clientX, y: event.clientY };
        }
        pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        event.currentTarget.setPointerCapture(event.pointerId);
        changeView(viewRef.current);
      }}
      onPointerMove={(event) => {
        const pointers = pointersRef.current;
        const previous = pointers.get(event.pointerId);
        if (!previous || isContextMenuOpen()) return;
        if (
          Math.hypot(
            event.clientX - pointerStartRef.current.x,
            event.clientY - pointerStartRef.current.y,
          ) > 3
        )
          movedRef.current = true;
        const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)?.[1];
        pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
        if (other) {
          movedRef.current = true;
          const distance = Math.hypot(previous.x - other.x, previous.y - other.y);
          const nextDistance = Math.hypot(event.clientX - other.x, event.clientY - other.y);
          if (distance > 0) {
            zoomTo((viewRef.current.zoom * nextDistance) / distance, {
              x: (previous.x + other.x) / 2,
              y: (previous.y + other.y) / 2,
            });
            const view = viewRef.current;
            changeView({
              ...view,
              x: view.x + (event.clientX - previous.x) / 2,
              y: view.y + (event.clientY - previous.y) / 2,
            });
          }
        } else if (movedRef.current) {
          const view = viewRef.current;
          changeView({
            ...view,
            x: view.x + event.clientX - previous.x,
            y: view.y + event.clientY - previous.y,
          });
        }
      }}
      onPointerUp={releasePointer}
      onPointerCancel={releasePointer}
      onLostPointerCapture={(event) => {
        if (pointersRef.current.has(event.pointerId)) movedRef.current = true;
        pointersRef.current.delete(event.pointerId);
        changeView(viewRef.current);
      }}
    >
      <AttachmentImage
        ref={imageRef}
        name={name}
        mimeType={mimeType}
        src={src}
        alt={name}
        draggable={false}
        className="absolute top-1/2 left-1/2 block max-w-none origin-center select-none will-change-transform"
        onLoad={(event) => {
          sizesRef.current.natural = {
            width: event.currentTarget.naturalWidth,
            height: event.currentTarget.naturalHeight,
          };
          measure();
        }}
        onError={onError}
      />
    </div>
  );
}
