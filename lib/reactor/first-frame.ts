/**
 * Reference-image ("first frame") rules, enforced client-side by the SDK
 * before any upload: at most 2 MB, landscape, aspect ratio between 1.5 and
 * 2.0. `validateFirstFrame` returns a human-readable issue string or null.
 *
 * `prepareFirstFrame` auto-crops and compresses any image to meet these
 * constraints so the user never hits a rejection.
 */
export {
  firstFrameImageIssue as validateFirstFrame,
  MAX_FIRST_FRAME_IMAGE_BYTES,
  MIN_FIRST_FRAME_ASPECT_RATIO,
  MAX_FIRST_FRAME_ASPECT_RATIO,
} from "@reactor-models/happy-oyster";

import {
  MAX_FIRST_FRAME_IMAGE_BYTES,
  MIN_FIRST_FRAME_ASPECT_RATIO,
  MAX_FIRST_FRAME_ASPECT_RATIO,
} from "@reactor-models/happy-oyster";

/** The ideal aspect ratio — 16:9, right in the middle of the 1.5–2.0 range. */
const TARGET_ASPECT_RATIO = 16 / 9;

/** Maximum canvas dimension to avoid browser memory limits. */
const MAX_DIMENSION = 3840;

/** Result from prepareFirstFrame — the compliant file plus metadata. */
export interface PreparedFrame {
  /** The transformed File ready for the SDK (may be the original if already valid). */
  file: File;
  /** Whether a crop was applied. */
  cropped: boolean;
  /** Whether compression/resize was applied. */
  compressed: boolean;
  /** Human-readable summary of what was done. */
  info: string;
  /** Preview URL for the (possibly cropped) image — caller must revoke. */
  previewUrl: string;
}

/**
 * Accept any image and transform it to meet Reactor's first-frame constraints:
 *  1. Center-crop to a valid landscape aspect ratio (1.5–2.0) if needed.
 *  2. Compress/resize to ≤ 2 MB via JPEG quality reduction + scaling.
 *
 * Returns the compliant File and metadata about what was changed, or throws
 * if the image can't be decoded.
 */
export async function prepareFirstFrame(
  input: File,
): Promise<PreparedFrame> {
  // Decode the image to get dimensions.
  const bitmap = await createImageBitmap(input);
  const { width, height } = bitmap;
  const ratio = width / height;

  const needsCrop =
    ratio < MIN_FIRST_FRAME_ASPECT_RATIO ||
    ratio > MAX_FIRST_FRAME_ASPECT_RATIO;

  // If the image is already valid in both ratio and size, pass through.
  if (!needsCrop && input.size <= MAX_FIRST_FRAME_IMAGE_BYTES) {
    bitmap.close();
    const url = URL.createObjectURL(input);
    return {
      file: input,
      cropped: false,
      compressed: false,
      info: `${width}×${height} · ${fmtSize(input.size)} · no changes needed`,
      previewUrl: url,
    };
  }

  // ── Step 1: Compute crop region ──────────────────────────────────────────
  let srcX = 0;
  let srcY = 0;
  let srcW = width;
  let srcH = height;

  if (needsCrop) {
    // Crop to TARGET_ASPECT_RATIO (16:9) from the center.
    if (ratio > MAX_FIRST_FRAME_ASPECT_RATIO) {
      // Too wide — narrow the width.
      srcW = Math.round(height * TARGET_ASPECT_RATIO);
      srcX = Math.round((width - srcW) / 2);
    } else {
      // Too tall or portrait — shorten the height.
      srcH = Math.round(width / TARGET_ASPECT_RATIO);
      srcY = Math.round((height - srcH) / 2);
    }
  }

  // ── Step 2: Draw onto canvas ─────────────────────────────────────────────
  // Clamp output dimensions to avoid huge canvases.
  let outW = srcW;
  let outH = srcH;
  if (outW > MAX_DIMENSION) {
    outW = MAX_DIMENSION;
    outH = Math.round(outW / TARGET_ASPECT_RATIO);
  }

  const canvas = new OffscreenCanvas(outW, outH);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, srcX, srcY, srcW, srcH, 0, 0, outW, outH);
  bitmap.close();

  // ── Step 3: Compress to fit ≤ 2 MB ──────────────────────────────────────
  let blob: Blob;
  let quality = 0.92;
  let compressed = false;
  const needsCompress = input.size > MAX_FIRST_FRAME_IMAGE_BYTES || needsCrop;

  // Try JPEG at decreasing quality levels.
  blob = await canvas.convertToBlob({ type: "image/jpeg", quality });

  while (blob.size > MAX_FIRST_FRAME_IMAGE_BYTES && quality > 0.3) {
    quality -= 0.1;
    compressed = true;
    blob = await canvas.convertToBlob({ type: "image/jpeg", quality });
  }

  // If quality reduction alone wasn't enough, scale down.
  if (blob.size > MAX_FIRST_FRAME_IMAGE_BYTES) {
    compressed = true;
    let scale = 0.8;
    while (blob.size > MAX_FIRST_FRAME_IMAGE_BYTES && scale > 0.2) {
      const scaledW = Math.round(outW * scale);
      const scaledH = Math.round(outH * scale);
      const smallCanvas = new OffscreenCanvas(scaledW, scaledH);
      const smallCtx = smallCanvas.getContext("2d")!;
      smallCtx.drawImage(canvas, 0, 0, scaledW, scaledH);
      blob = await smallCanvas.convertToBlob({
        type: "image/jpeg",
        quality: 0.85,
      });
      scale -= 0.1;
    }
  }

  // Also mark as compressed if original was over the limit (even if crop brought it down).
  if (!compressed && input.size > MAX_FIRST_FRAME_IMAGE_BYTES) {
    compressed = true;
  }

  // ── Step 4: Build result ─────────────────────────────────────────────────
  const name = input.name.replace(/\.[^.]+$/, "") + ".jpg";
  const file = new File([blob], name, { type: "image/jpeg" });
  const previewUrl = URL.createObjectURL(blob);

  const parts: string[] = [];
  if (needsCrop) parts.push("cropped to 16:9");
  if (compressed) parts.push(`compressed to ${fmtSize(file.size)}`);
  if (parts.length === 0) parts.push("re-encoded");
  const outRatio = (outW / outH).toFixed(2);
  const info = `${outW}×${outH} (${outRatio}) · ${fmtSize(file.size)} · ${parts.join(", ")}`;

  return { file, cropped: needsCrop, compressed, info, previewUrl };
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(0)} KB`;
  return `${(kb / 1024).toFixed(2)} MB`;
}
