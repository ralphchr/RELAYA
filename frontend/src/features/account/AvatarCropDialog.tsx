import { useEffect, useRef, useState, type PointerEvent } from "react";
import { Check, X } from "lucide-react";

const OUTPUT_SIZE = 512;
const MAX_AVATAR_BYTES = 512 * 1024;

interface Offset { x: number; y: number }

function clampOffset(offset: Offset, width: number, height: number, scale: number, size: number): Offset {
  const limitX = Math.max(0, (width * scale - size) / 2);
  const limitY = Math.max(0, (height * scale - size) / 2);
  return {
    x: Math.max(-limitX, Math.min(limitX, offset.x)),
    y: Math.max(-limitY, Math.min(limitY, offset.y)),
  };
}

async function toAvatar(file: File, width: number, height: number, size: number, scale: number, offset: Offset): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const safeOffset = clampOffset(offset, width, height, scale, size);
    const renderedWidth = width * scale;
    const renderedHeight = height * scale;
    const sourceX = -((size - renderedWidth) / 2 + safeOffset.x) / scale;
    const sourceY = -((size - renderedHeight) / 2 + safeOffset.y) / scale;
    const sourceSize = size / scale;
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Your browser couldn't prepare that photo.");
    context.drawImage(bitmap, sourceX, sourceY, sourceSize, sourceSize, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

    for (const quality of [0.82, 0.72, 0.62, 0.52, 0.42]) {
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("Your browser couldn't prepare that photo.")), "image/webp", quality));
      if (blob.size <= MAX_AVATAR_BYTES) return blob;
    }
    throw new Error("That cropped photo is still too large. Try a different image.");
  } finally {
    bitmap.close();
  }
}

export function AvatarCropDialog({ file, busy, error, onCancel, onSave }: {
  file: File;
  busy: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (image: Blob) => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number; offset: Offset } | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [dimensions, setDimensions] = useState<{ width: number; height: number } | null>(null);
  const [stageSize, setStageSize] = useState(320);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const [preparing, setPreparing] = useState(false);
  const [cropError, setCropError] = useState<string | null>(null);

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
    return () => { if (element?.open) element.close(); };
  }, []);

  useEffect(() => {
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    if (!stage.current) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setStageSize(entry.contentRect.width);
    });
    observer.observe(stage.current);
    return () => observer.disconnect();
  }, []);

  const baseScale = dimensions ? stageSize / Math.min(dimensions.width, dimensions.height) : 1;
  const scale = baseScale * zoom;
  const safeOffset = dimensions ? clampOffset(offset, dimensions.width, dimensions.height, scale, stageSize) : offset;

  function startDrag(event: PointerEvent<HTMLDivElement>) {
    if (!dimensions || busy || preparing) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, offset: safeOffset };
  }

  function moveDrag(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current || !dimensions) return;
    setOffset(clampOffset({
      x: drag.current.offset.x + event.clientX - drag.current.x,
      y: drag.current.offset.y + event.clientY - drag.current.y,
    }, dimensions.width, dimensions.height, scale, stageSize));
  }

  async function saveCrop() {
    if (!dimensions || busy || preparing) return;
    setPreparing(true);
    setCropError(null);
    try {
      const image = await toAvatar(file, dimensions.width, dimensions.height, stageSize, scale, safeOffset);
      await onSave(image);
    } catch (saveError) {
      setCropError(saveError instanceof Error ? saveError.message : "Couldn't prepare that photo. Try again.");
    } finally {
      setPreparing(false);
    }
  }

  return (
    <dialog ref={dialog} className="avatar-crop-dialog" aria-labelledby="avatar-crop-title" onCancel={(event) => { event.preventDefault(); if (!busy && !preparing) onCancel(); }}>
      <div className="avatar-crop-head">
        <div><h2 id="avatar-crop-title">Crop your photo</h2><p>Drag to position it, then adjust the zoom.</p></div>
        <button type="button" className="avatar-crop-close" aria-label="Cancel photo crop" onClick={onCancel} disabled={busy || preparing}><X className="icon" /></button>
      </div>
      <div
        ref={stage}
        className="avatar-crop-stage"
        aria-label="Square photo crop area. Drag the image to reposition it."
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={(event) => { drag.current = null; if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
        onPointerCancel={() => { drag.current = null; }}
      >
        <img
          src={previewUrl ?? undefined}
          alt=""
          draggable={false}
          onLoad={(event) => setDimensions({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
          onError={() => setCropError("Couldn't load that photo. Try selecting it again.")}
          style={dimensions ? {
            width: dimensions.width * scale,
            height: dimensions.height * scale,
            left: (stageSize - dimensions.width * scale) / 2 + safeOffset.x,
            top: (stageSize - dimensions.height * scale) / 2 + safeOffset.y,
          } : undefined}
        />
        <span className="avatar-crop-mask" aria-hidden="true" />
      </div>
      <label className="avatar-crop-zoom">Zoom <input type="range" min="1" max="3" step="0.01" value={zoom} onChange={(event) => setZoom(Number(event.currentTarget.value))} disabled={!dimensions || busy || preparing} /><span>{zoom.toFixed(1)}×</span></label>
      {(error || cropError) && <p className="avatar-crop-error" role="alert">{error || cropError}</p>}
      <div className="avatar-crop-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy || preparing}>Cancel</button>
        <button type="button" className="btn btn-coral" onClick={() => void saveCrop()} disabled={!dimensions || busy || preparing}><Check className="icon" />{busy || preparing ? "Saving…" : "Use photo"}</button>
      </div>
    </dialog>
  );
}
