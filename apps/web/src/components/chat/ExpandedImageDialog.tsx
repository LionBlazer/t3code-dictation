import { memo, useEffect, useRef, useState, type ReactNode, type KeyboardEvent } from "react";
import { ChevronLeftIcon, ChevronRightIcon, XIcon } from "lucide-react";
import { Button } from "../ui/button";
import { Dialog, DialogPopup, DialogTitle } from "../ui/dialog";
import type { ExpandedImageItem, ExpandedImagePreview } from "./ExpandedImagePreview";
import { resolveExternalWebLinkHost } from "./externalLinkContextMenu";
import { useAssetUrlRefresh, useAssetUrlState } from "../../assets/assetUrls";
import { OpenMediaLink } from "../media/OpenMediaLink";
import { MediaActions, type MediaActionSource } from "../media/MediaActions";
import { MediaVideoPlayer } from "../media/MediaVideoPlayer";
import { isContextMenuOpen } from "../../contextMenuFallback";
import { ZoomableImage } from "./ZoomableImage";
import { useStableCallback } from "../../hooks/useStableCallback";
import { composerFloatingLayerProps } from "./composerEventScope";
import { useAtomValue } from "@effect/atom-react";
import { Atom } from "effect/reactivity";
import { appAtomRegistry } from "~/rpc/atomRegistry";
import { expandedImageKey } from "./ExpandedImagePreview";
import { cn } from "../../lib/utils";

interface ExpandedImageDialogProps {
  preview: ExpandedImagePreview;
  onClose: () => void;
}

const EXPANDED_MEDIA_STATE_CLASS_NAME =
  "flex aspect-auto h-48 min-h-0 w-[min(var(--media-width),32rem)] flex-col items-center justify-center gap-3 rounded-lg border border-border/70 bg-black p-6 text-center text-sm text-white shadow-2xl";

function ExpandedMediaFailure({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className={EXPANDED_MEDIA_STATE_CLASS_NAME}>
      {children}
    </div>
  );
}

function ExpandedVideo({ item }: { readonly item: ExpandedImageItem }) {
  const asset = item.actionsSource?.asset;
  const assetUrl = useAssetUrlState(asset?.environmentId ?? null, asset?.resource ?? null);
  const refreshAssetUrl = useAssetUrlRefresh(asset?.environmentId ?? null, asset?.resource ?? null);
  const src = asset
    ? assetUrl._tag === "Success"
      ? assetUrl.url + (item.srcFragment ?? "")
      : null
    : item.src;
  return (
    <MediaVideoPlayer
      src={src}
      label={item.name}
      sourceFailed={assetUrl._tag === "Failure"}
      originalUrl={item.originalUrl}
      preload="metadata"
      autoPlay={item.autoPlay ?? true}
      className="block max-h-[var(--media-height)] max-w-[var(--media-width)] text-center"
      videoClassName="aspect-auto max-h-[var(--media-height)] w-auto max-w-[var(--media-width)] rounded-lg border border-border/70 shadow-2xl"
      stateClassName={EXPANDED_MEDIA_STATE_CLASS_NAME}
      onRetry={asset ? refreshAssetUrl : undefined}
    />
  );
}

export const ExpandedImageDialog = memo(function ExpandedImageDialog({
  preview,
  onClose,
}: ExpandedImageDialogProps) {
  const [imageOffset, setImageOffset] = useState(0);
  const [failedImageSrc, setFailedImageSrc] = useState<string | null>(null);
  const [returnFocusTarget] = useState(() =>
    document.activeElement instanceof HTMLElement ? document.activeElement : null,
  );
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const popupRef = useRef<HTMLDivElement>(null);
  const imageCount = preview.images.length;
  const index = Math.max(0, Math.min(imageCount - 1, preview.index + imageOffset));
  const item = preview.images[index];
  const source: MediaActionSource = item?.actionsSource ?? {
    kind: item?.type === "video" ? "video" : "image",
    name: item?.name ?? "Media",
    src: item?.src ?? null,
  };
  const openFile = source.onOpenFile;
  const actionsSource: MediaActionSource = openFile
    ? {
        ...source,
        onOpenFile: () => {
          openFile();
          onClose();
        },
      }
    : source;

  const navigateImage = useStableCallback((direction: -1 | 1) => {
    setImageOffset((current) => {
      const nextIndex = Math.max(0, Math.min(imageCount - 1, preview.index + current + direction));
      return nextIndex - preview.index;
    });
  });

  // The host unmounts the open dialog, so restore the opener even without a close transition.
  useEffect(
    () => () => {
      if (returnFocusTarget?.isConnected) returnFocusTarget.focus({ preventScroll: true });
    },
    [returnFocusTarget],
  );

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.defaultPrevented || isContextMenuOpen() || event.target instanceof HTMLVideoElement)
      return;
    if (preview.images.length <= 1) return;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      event.stopPropagation();
      navigateImage(-1);
      return;
    }
    if (event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
    navigateImage(1);
  };

  useEffect(() => {
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || isContextMenuOpen()) return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", onEscape, { capture: true });
    return () => window.removeEventListener("keydown", onEscape, { capture: true });
  }, [onClose]);

  if (!item) return null;
  const mediaLabel = item.type === "video" ? "video" : "image";
  const openOriginalLink =
    item.originalUrl && resolveExternalWebLinkHost(item.originalUrl) !== null ? (
      <OpenMediaLink originalUrl={item.originalUrl} />
    ) : null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogPopup
        ref={popupRef}
        {...composerFloatingLayerProps}
        variant={item.type === "video" ? "media" : "media-fullscreen"}
        showCloseButton={false}
        bottomStickOnMobile={false}
        className={cn(
          "row-start-1 items-center justify-center",
          item.type === "video"
            ? "h-full max-h-[92vh] w-[92vw] max-w-[92vw] overflow-visible [--media-width:92vw] [--media-height:min(calc((100vh-var(--native-titlebar-height,0px))*0.86),calc(100vh-var(--native-titlebar-height,0px)-160px))] sm:[--media-width:calc(92vw-96px)]"
            : "[--media-width:100vw] [--media-height:100dvh]",
        )}
        onKeyDown={onKeyDown}
        initialFocus={item.type === "video" ? closeButtonRef : popupRef}
        finalFocus={() => returnFocusTarget}
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <DialogTitle className="sr-only">Expanded {mediaLabel} preview</DialogTitle>
        {item.type === "video" && (
          <Button
            type="button"
            ref={closeButtonRef}
            size="icon-sm"
            variant="media-close"
            className="absolute right-3 top-3 z-20"
            onClick={onClose}
            aria-label={`Close ${mediaLabel} preview`}
          >
            <XIcon />
          </Button>
        )}
        {item.type === "video" && preview.images.length > 1 && (
          <Button
            type="button"
            size="icon"
            variant="media-navigation"
            className="left-0 top-auto bottom-0 translate-y-0 sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2"
            aria-label="Previous media"
            onClick={() => navigateImage(-1)}
          >
            <ChevronLeftIcon className="size-5" />
          </Button>
        )}
        <MediaActions source={actionsSource} showTooltip={item.type === "video"}>
          <div
            onClick={() => {
              if (item.type !== "video" && (item.src === null || failedImageSrc === item.src))
                onClose();
            }}
            className={cn(
              "relative isolate z-10 flex max-h-full max-w-[var(--media-width)] flex-col items-center",
              item.type !== "video" && "h-full min-h-0 w-full justify-center",
            )}
          >
            {item.type === "video" ? (
              <ExpandedVideo key={index} item={item} />
            ) : item.src === null || failedImageSrc === item.src ? (
              <ExpandedMediaFailure>
                <p>
                  {openOriginalLink
                    ? "This image could not be loaded."
                    : "Image unavailable. The file may have been moved or deleted."}
                </p>
                {openOriginalLink}
              </ExpandedMediaFailure>
            ) : (
              <ZoomableImage
                key={`${index}:${item.src}`}
                src={item.src}
                name={item.name}
                mimeType={item.mimeType}
                onError={() => setFailedImageSrc(item.src)}
                onClose={onClose}
                onNavigate={navigateImage}
              />
            )}
            {item.type === "video" && (
              <div className="mt-2 flex max-w-[var(--media-width)] items-center justify-center gap-1.5 text-xs text-white/80 max-sm:px-10">
                <span className="truncate" aria-live="polite" aria-atomic="true">
                  {item.name}
                  {preview.images.length > 1 ? ` (${index + 1}/${preview.images.length})` : ""}
                </span>
              </div>
            )}
          </div>
        </MediaActions>
        {item.type === "video" && preview.images.length > 1 && (
          <Button
            type="button"
            size="icon"
            variant="media-navigation"
            className="right-0 top-auto bottom-0 translate-y-0 sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2"
            aria-label="Next media"
            onClick={() => navigateImage(1)}
          >
            <ChevronRightIcon className="size-5" />
          </Button>
        )}
      </DialogPopup>
    </Dialog>
  );
});

/**
 * The chat view's open media preview. It lives outside ChatView so opening or
 * closing it renders only the dialog host, not the whole chat chrome.
 */
const expandedImagePreviewAtom = Atom.make<{
  readonly threadKey: string;
  readonly preview: ExpandedImagePreview;
} | null>(null).pipe(Atom.keepAlive, Atom.withLabel("chat:expanded-image-preview"));

export function openExpandedImagePreview(threadKey: string, preview: ExpandedImagePreview): void {
  appAtomRegistry.set(expandedImagePreviewAtom, { threadKey, preview });
}

function closeExpandedImagePreview(): void {
  appAtomRegistry.set(expandedImagePreviewAtom, null);
}

function closeExpandedImagePreviewFor(threadKey: string): void {
  if (appAtomRegistry.get(expandedImagePreviewAtom)?.threadKey === threadKey) {
    closeExpandedImagePreview();
  }
}

export function ExpandedImageDialogHost({ threadKey }: { readonly threadKey: string }) {
  const state = useAtomValue(expandedImagePreviewAtom);
  const preview = state?.threadKey === threadKey ? state.preview : null;
  const item = preview?.images[preview.index];
  const ownedSrc = item?.ownsSrc === true ? item.src : null;
  useEffect(() => {
    if (ownedSrc === null) return;
    return () => URL.revokeObjectURL(ownedSrc);
  }, [ownedSrc]);
  // Leaving the thread (or the chat view) drops its preview.
  useEffect(() => () => closeExpandedImagePreviewFor(threadKey), [threadKey]);
  if (preview === null) return null;
  return (
    <ExpandedImageDialog
      key={expandedImageKey(preview)}
      preview={preview}
      onClose={closeExpandedImagePreview}
    />
  );
}
