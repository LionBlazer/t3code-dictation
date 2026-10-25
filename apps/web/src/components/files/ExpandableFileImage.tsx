import { useState } from "react";

import { ExpandedImageDialog } from "../chat/ExpandedImageDialog";
import { AttachmentImage } from "../media/AttachmentImage";
import { MediaActions, type MediaActionSource } from "../media/MediaActions";

export function ExpandableFileImage({
  src,
  name,
  mimeType,
  onError,
  actionsSource,
}: {
  src: string;
  name: string;
  mimeType?: string | undefined;
  onError: () => void;
  actionsSource?: MediaActionSource | undefined;
}) {
  const [expanded, setExpanded] = useState(false);
  const source: MediaActionSource = actionsSource ?? { kind: "image", name, src };
  return (
    <>
      <div className="flex min-h-0 flex-1 items-center justify-center p-4">
        <MediaActions source={source}>
          <button
            type="button"
            aria-label={`Preview ${name}`}
            onClick={() => setExpanded(true)}
            className="flex h-full min-h-0 max-w-full cursor-zoom-in items-center justify-center outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <AttachmentImage
              src={src}
              name={name}
              mimeType={mimeType}
              alt={name}
              className="max-h-full max-w-full object-contain"
              onError={onError}
            />
          </button>
        </MediaActions>
      </div>
      {expanded ? (
        <ExpandedImageDialog
          preview={{
            images: [
              { src, name, ...(mimeType === undefined ? {} : { mimeType }), actionsSource: source },
            ],
            index: 0,
          }}
          onClose={() => setExpanded(false)}
        />
      ) : null}
    </>
  );
}
