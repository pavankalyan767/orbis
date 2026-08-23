"use client";

/**
 * World creation form: exactly one reference image (the world's starting
 * frame) plus the generation prompt. Images are automatically cropped to
 * landscape 16:9 and compressed to ≤ 2 MB to meet Reactor's gateway
 * constraints — no manual resizing needed.
 */
import { useEffect, useRef, useState } from "react";
import { prepareFirstFrame, type PreparedFrame } from "@/lib/reactor/first-frame";

const PROMPT_PLACEHOLDER =
  "A misty ancient forest with towering moss-covered trees and a narrow lantern-lit trail…";

export function WorldForm({
  onSubmit,
  submitting,
  disabled,
}: {
  onSubmit: (prompt: string, image: File | null) => void;
  submitting: boolean;
  disabled: boolean;
}) {
  const [prompt, setPrompt] = useState("");
  const [prepared, setPrepared] = useState<PreparedFrame | null>(null);
  const [processing, setProcessing] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Revoke preview URL on unmount or when a new image replaces the old one.
  useEffect(() => {
    return () => {
      if (prepared?.previewUrl) URL.revokeObjectURL(prepared.previewUrl);
    };
  }, [prepared]);

  async function pickFile(next: File | null) {
    setImageError(null);
    if (!next) {
      if (prepared?.previewUrl) URL.revokeObjectURL(prepared.previewUrl);
      setPrepared(null);
      return;
    }

    // Auto-crop and compress to meet Reactor constraints.
    setProcessing(true);
    try {
      // Revoke old preview before creating new one.
      if (prepared?.previewUrl) URL.revokeObjectURL(prepared.previewUrl);
      const result = await prepareFirstFrame(next);
      setPrepared(result);
    } catch (err) {
      setImageError(
        err instanceof Error
          ? err.message
          : "Could not process this image — try a different file.",
      );
      setPrepared(null);
    } finally {
      setProcessing(false);
    }
  }

  const canSubmit =
    !disabled && !submitting && !processing && !imageError && prompt.trim().length >= 3;

  return (
    <form
      className="world-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (canSubmit) onSubmit(prompt.trim(), prepared?.file ?? null);
      }}
    >
      <div>
        <label htmlFor="reference-image">
          Reference image
          <span className="field-hint">optional · auto-cropped to landscape 16:9</span>
        </label>
        <div
          className={`file-drop${dragOver ? " dragover" : ""}`}
          role="button"
          tabIndex={0}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") inputRef.current?.click();
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            void pickFile(event.dataTransfer.files?.[0] ?? null);
          }}
        >
          {prepared?.previewUrl ? (
            <img src={prepared.previewUrl} alt="Reference image preview (cropped)" />
          ) : (
            <div style={{ width: 96, textAlign: "center", fontSize: 26 }}>🖼️</div>
          )}
          <div className="file-meta">
            {processing ? (
              <>
                <span className="name">Processing image…</span>
                <span className="req">Cropping and compressing to fit Reactor limits</span>
              </>
            ) : prepared ? (
              <>
                <span className="name">{prepared.file.name}</span>
                <span className="req">{prepared.info}</span>
                {(prepared.cropped || prepared.compressed) && (
                  <span className="transform-badge">
                    {prepared.cropped && "✂ cropped"}
                    {prepared.cropped && prepared.compressed && " · "}
                    {prepared.compressed && "📦 compressed"}
                  </span>
                )}
              </>
            ) : (
              <>
                <span className="name">
                  {imageError ?? "Drop an image or click to browse"}
                </span>
                <span className="req">Any image — auto-cropped to landscape &amp; compressed to ≤ 2 MB</span>
                {imageError && <span className="invalid">{imageError}</span>}
              </>
            )}
          </div>
          {prepared && (
            <button
              type="button"
              className="link-button"
              style={{ marginLeft: "auto" }}
              onClick={(event) => {
                event.stopPropagation();
                inputRef.current && (inputRef.current.value = "");
                void pickFile(null);
              }}
            >
              Remove
            </button>
          )}
        </div>
        <input
          ref={inputRef}
          id="reference-image"
          type="file"
          accept="image/*"
          hidden
          onChange={(event) => void pickFile(event.target.files?.[0] ?? null)}
        />
      </div>

      <div>
        <label htmlFor="world-prompt">
          World prompt
          <span className="field-hint">up to 2,000 characters</span>
        </label>
        <textarea
          id="world-prompt"
          value={prompt}
          maxLength={2000}
          placeholder={PROMPT_PLACEHOLDER}
          onChange={(event) => setPrompt(event.target.value)}
        />
      </div>

      <button className="primary" type="submit" disabled={!canSubmit}>
        {submitting ? "Generating…" : processing ? "Processing image…" : disabled ? "Waiting for connection…" : "Generate world"}
      </button>
    </form>
  );
}
