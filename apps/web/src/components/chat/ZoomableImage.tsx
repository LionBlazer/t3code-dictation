import {
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  type PointerEvent,
  type Ref,
} from "react";
import { MaximizeIcon, MinusIcon, PlusIcon } from "lucide-react";

import { useStableCallback } from "../../hooks/useStableCallback";
import { observeResize } from "../../lib/observeResize";
import { Button } from "../ui/button";
import { AttachmentImage } from "../media/AttachmentImage";
import {
  clampImageTransform,
  fittedImageSize,
  IMAGE_VIEWPORT_MAX_ZOOM,
  zoomImageAt,
  type ImageViewportTransform,
} from "./imageViewport";

export interface ZoomableImageHandle {
  pan: (key: string) => boolean;
}

export function ZoomableImage({
  src,
  name,
  mimeType,
  onError,
  onBackgroundClick,
  ref,
}: {
  src: string;
  name: string;
  mimeType?: string | undefined;
  onError: () => void;
  onBackgroundClick?: (() => void) | undefined;
  ref?: Ref<ZoomableImageHandle>;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const zoomLabelRef = useRef<HTMLSpanElement>(null);
  const minusRef = useRef<HTMLButtonElement>(null);
  const plusRef = useRef<HTMLButtonElement>(null);
  const frameRef = useRef<number | null>(null);
  const viewRef = useRef<ImageViewportTransform>({ zoom: 1, x: 0, y: 0 });
  const sizesRef = useRef({
    natural: { width: 0, height: 0 },
    image: { width: 0, height: 0 },
    viewport: { width: 0, height: 0 },
  });
  const pointersRef = useRef(new Map<number, { x: number; y: number }>());
  const movedRef = useRef(false);
  const backgroundPressRef = useRef(false);
  const pointerStartRef = useRef({ x: 0, y: 0 });

  const paint = useStableCallback(() => {
    const viewport = viewportRef.current;
    const image = imageRef.current;
    if (!viewport || !image) return;
    const view = viewRef.current;
    image.style.transform = `translate3d(${view.x}px, ${view.y}px, 0) scale(${view.zoom})`;
    viewport.dataset.zoom = String(view.zoom);
    viewport.style.cursor =
      view.zoom > 1 ? (pointersRef.current.size ? "grabbing" : "grab") : "default";
    const { natural, image: fitted } = sizesRef.current;
    if (zoomLabelRef.current) {
      const percent = natural.width ? (fitted.width / natural.width) * view.zoom * 100 : 100;
      zoomLabelRef.current.textContent = `${Math.round(percent)}%`;
    }
    if (minusRef.current) minusRef.current.disabled = view.zoom <= 1;
    if (plusRef.current) plusRef.current.disabled = view.zoom >= IMAGE_VIEWPORT_MAX_ZOOM;
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
      const delta =
        event.deltaY *
        (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1);
      zoomTo(viewRef.current.zoom * Math.exp(-delta * (event.ctrlKey ? 0.01 : 0.002)), {
        x: event.clientX,
        y: event.clientY,
      });
    };
    viewport.addEventListener("wheel", wheel, { passive: false });
    return () => viewport.removeEventListener("wheel", wheel);
  }, [zoomTo]);

  useEffect(
    () => () => {
      if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  useImperativeHandle(
    ref,
    () => ({
      pan(key) {
        const { image, viewport } = sizesRef.current;
        const view = viewRef.current;
        if (view.zoom <= 1) return false;
        if (
          (key === "ArrowLeft" || key === "ArrowRight") &&
          image.width * view.zoom <= viewport.width
        )
          return false;
        const direction =
          key === "ArrowLeft"
            ? { x: 40, y: 0 }
            : key === "ArrowRight"
              ? { x: -40, y: 0 }
              : key === "ArrowUp"
                ? { x: 0, y: 40 }
                : key === "ArrowDown"
                  ? { x: 0, y: -40 }
                  : null;
        if (!direction) return false;
        changeView({ ...view, x: view.x + direction.x, y: view.y + direction.y });
        return true;
      },
    }),
    [changeView],
  );

  const releasePointer = (event: PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    changeView(viewRef.current);
  };

  return (
    <div className="flex h-full min-h-0 w-full min-w-0 flex-1 flex-col">
      <div
        ref={viewportRef}
        role="region"
        aria-label={`${name}, zoomable image`}
        aria-description="Scroll or pinch to zoom at the pointer. Drag to pan. Double-click to toggle zoom. Plus and minus zoom; 0 fits the image. Escape closes the viewer."
        tabIndex={0}
        className="relative min-h-0 w-full flex-1 touch-none overflow-hidden overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-white/50"
        onClick={() => {
          if (!movedRef.current && backgroundPressRef.current) onBackgroundClick?.();
        }}
        onDoubleClick={(event) => {
          if (movedRef.current || backgroundPressRef.current) return;
          event.preventDefault();
          zoomTo(viewRef.current.zoom > 1 ? 1 : 2, { x: event.clientX, y: event.clientY });
        }}
        onKeyDown={(event) => {
          if (event.ctrlKey || event.metaKey || event.altKey) return;
          if (event.key === "+" || event.key === "=") zoomTo(viewRef.current.zoom * 1.22);
          else if (event.key === "-") zoomTo(viewRef.current.zoom / 1.22);
          else if (event.key === "0") zoomTo(1);
          else if (event.key === "Enter" || event.key === " ") {
            if (!event.repeat) zoomTo(viewRef.current.zoom > 1 ? 1 : 2);
          } else return;
          event.preventDefault();
          event.stopPropagation();
        }}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          if (pointersRef.current.size === 0) {
            movedRef.current = false;
            backgroundPressRef.current = event.target === event.currentTarget;
            pointerStartRef.current = { x: event.clientX, y: event.clientY };
          }
          pointersRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
          event.currentTarget.setPointerCapture(event.pointerId);
          changeView(viewRef.current);
        }}
        onPointerMove={(event) => {
          const pointers = pointersRef.current;
          const previous = pointers.get(event.pointerId);
          if (!previous) return;
          if (
            Math.hypot(
              event.clientX - pointerStartRef.current.x,
              event.clientY - pointerStartRef.current.y,
            ) > 4
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
          } else {
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
      <div
        className="flex h-11 shrink-0 items-center justify-center gap-2 text-white"
        role="toolbar"
        aria-label="Image zoom controls"
      >
        <Button
          ref={minusRef}
          size="icon-sm"
          variant="media-close"
          aria-label="Zoom out"
          onClick={() => zoomTo(viewRef.current.zoom / 1.22)}
        >
          <MinusIcon />
        </Button>
        <span
          ref={zoomLabelRef}
          className="min-w-14 text-center text-xs tabular-nums"
          aria-live="polite"
          aria-atomic="true"
        >
          100%
        </span>
        <Button
          ref={plusRef}
          size="icon-sm"
          variant="media-close"
          aria-label="Zoom in"
          onClick={() => zoomTo(viewRef.current.zoom * 1.22)}
        >
          <PlusIcon />
        </Button>
        <Button
          size="icon-sm"
          variant="media-close"
          aria-label="Fit image"
          title="Fit image (0)"
          onClick={() => zoomTo(1)}
        >
          <MaximizeIcon />
        </Button>
      </div>
    </div>
  );
}
