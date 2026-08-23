'use client'

import { useCallback, useRef, useState } from 'react'
import type { FloorPlan } from '@/navigation/types'
import dynamic from 'next/dynamic'

// Three.js must be dynamically imported (no SSR)
const ThreeView = dynamic(
  () => import('@/components/blueprint/ThreeView').then((m) => m.ThreeView),
  { ssr: false, loading: () => <div className="three-placeholder">Loading 3D view…</div> },
)

// ─── Types ────────────────────────────────────────────────────────────────────

type ParseResult = {
  floorPlan: FloorPlan
  svg: string
  roomPrompts: { roomId: string; roomName: string }[]
  meta: { roomCount: number; wallCount: number }
}

type RoomImageStatus =
  | { state: 'idle' }
  | { state: 'loading' }
  | { state: 'done'; dataUrl: string }
  | { state: 'error'; message: string }

// ─── Upload Zone ──────────────────────────────────────────────────────────────

function UploadZone({ onFile }: { onFile: (f: File) => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  const handleFile = (f: File | undefined) => {
    if (!f) return
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(f.type)) {
      alert('Please upload a JPEG, PNG, or WebP image.')
      return
    }
    onFile(f)
  }

  return (
    <div
      className={`upload-zone ${dragging ? 'dragging' : ''}`}
      onClick={() => inputRef.current?.click()}
      onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        handleFile(e.dataTransfer.files[0])
      }}
    >
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        style={{ display: 'none' }}
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <div className="upload-icon">🏛️</div>
      <p className="upload-title">Drop your floor plan here</p>
      <p className="upload-sub">PNG · JPG · WebP — max 5 MB</p>
    </div>
  )
}

// ─── Room Image Card ──────────────────────────────────────────────────────────

function RoomImageCard({ roomId, roomName, status }: {
  roomId: string
  roomName: string
  status: RoomImageStatus
}) {
  return (
    <div className="room-card">
      <p className="room-card-title">{roomName}</p>
      {status.state === 'idle' && (
        <div className="room-card-placeholder">Queued…</div>
      )}
      {status.state === 'loading' && (
        <div className="room-card-placeholder shimmer">Generating…</div>
      )}
      {status.state === 'done' && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={status.dataUrl} alt={roomName} className="room-card-img" />
      )}
      {status.state === 'error' && (
        <div className="room-card-placeholder error">{status.message}</div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BlueprintPage() {
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [result, setResult] = useState<ParseResult | null>(null)
  const [roomImages, setRoomImages] = useState<Record<string, RoomImageStatus>>({})
  const [activeTab, setActiveTab] = useState<'svg' | '3d' | 'json'>('svg')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  // ── File upload handler ─────────────────────────────────────────────────────
  const handleFile = useCallback(async (file: File) => {
    setParseError(null)
    setResult(null)
    setRoomImages({})
    setParsing(true)
    setPreviewUrl(URL.createObjectURL(file))

    const form = new FormData()
    form.append('file', file)

    try {
      const res = await fetch('/api/blueprint/parse', { method: 'POST', body: form })
      const data = await res.json()

      if (!res.ok) {
        setParseError(data.error ?? 'Unknown error from server.')
        return
      }

      const parsed = data as ParseResult
      setResult(parsed)

      // Kick off room image generation — fire in parallel
      const initialStatuses: Record<string, RoomImageStatus> = {}
      for (const rp of parsed.roomPrompts) {
        initialStatuses[rp.roomId] = { state: 'loading' }
      }
      setRoomImages(initialStatuses)

      for (const rp of parsed.roomPrompts) {
        fetch('/api/blueprint/room-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomId: rp.roomId, floorPlan: parsed.floorPlan }),
        })
          .then((r) => r.json())
          .then((imgData) => {
            if (imgData.dataUrl) {
              setRoomImages((prev) => ({
                ...prev,
                [rp.roomId]: { state: 'done', dataUrl: imgData.dataUrl },
              }))
            } else {
              setRoomImages((prev) => ({
                ...prev,
                [rp.roomId]: { state: 'error', message: imgData.error ?? 'Generation failed' },
              }))
            }
          })
          .catch((err) => {
            setRoomImages((prev) => ({
              ...prev,
              [rp.roomId]: { state: 'error', message: String(err) },
            }))
          })
      }
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err))
    } finally {
      setParsing(false)
    }
  }, [])

  const downloadJson = () => {
    if (!result) return
    const blob = new Blob([JSON.stringify(result.floorPlan, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'floorplan.json'
    a.click()
  }

  const downloadSvg = () => {
    if (!result) return
    const blob = new Blob([result.svg], { type: 'image/svg+xml' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'floorplan-collision.svg'
    a.click()
  }

  return (
    <div className="bp-page">
      <header className="bp-header">
        <h1>Blueprint<span className="accent"> Parser</span></h1>
        <p className="bp-sub">Upload a floor plan → get FloorPlan JSON, collision SVG, 3D view, and per-room images</p>
      </header>

      <main className="bp-main">
        {/* ── Upload section ─────────────────────────────────────────────── */}
        <section className="bp-upload-section">
          <UploadZone onFile={handleFile} />
          {previewUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={previewUrl} alt="Uploaded floor plan" className="bp-preview" />
          )}
        </section>

        {/* ── Parsing state ──────────────────────────────────────────────── */}
        {parsing && (
          <div className="bp-status">
            <span className="spinner" /> Sending to Claude Vision — analysing floor plan…
          </div>
        )}

        {parseError && (
          <div className="bp-error">
            <strong>Parse error:</strong> {parseError}
          </div>
        )}

        {/* ── Results ───────────────────────────────────────────────────── */}
        {result && (
          <>
            <div className="bp-meta">
              ✅ <strong>{result.meta.roomCount} rooms</strong> detected
              &nbsp;·&nbsp; <strong>{result.meta.wallCount} walls</strong>
            </div>

            {/* Tabs */}
            <div className="bp-tabs">
              <button
                className={activeTab === 'svg' ? 'active' : ''}
                onClick={() => setActiveTab('svg')}
              >
                🗺 Collision SVG
              </button>
              <button
                className={activeTab === '3d' ? 'active' : ''}
                onClick={() => setActiveTab('3d')}
              >
                🏗 3D View
              </button>
              <button
                className={activeTab === 'json' ? 'active' : ''}
                onClick={() => setActiveTab('json')}
              >
                {'{ }'} JSON
              </button>
            </div>

            {/* SVG tab */}
            {activeTab === 'svg' && (
              <div className="bp-tab-content">
                <div className="svg-toolbar">
                  <span className="svg-legend-note">
                    This is exactly what the CollisionEngine and ExitDetector see
                  </span>
                  <button className="bp-btn-sm" onClick={downloadSvg}>Download SVG</button>
                </div>
                <div
                  className="bp-svg-wrap"
                  dangerouslySetInnerHTML={{ __html: result.svg }}
                />
              </div>
            )}

            {/* 3D tab */}
            {activeTab === '3d' && (
              <div className="bp-tab-content">
                <ThreeView floorPlan={result.floorPlan} className="bp-three" />
              </div>
            )}

            {/* JSON tab */}
            {activeTab === 'json' && (
              <div className="bp-tab-content">
                <div className="json-toolbar">
                  <button className="bp-btn-sm" onClick={() => navigator.clipboard.writeText(JSON.stringify(result.floorPlan, null, 2))}>
                    Copy JSON
                  </button>
                  <button className="bp-btn-sm" onClick={downloadJson}>Download JSON</button>
                </div>
                <pre className="bp-json">{JSON.stringify(result.floorPlan, null, 2)}</pre>
              </div>
            )}

            {/* Room images */}
            <section className="bp-rooms-section">
              <h2>Per-Room Images</h2>
              <p className="bp-rooms-sub">
                Generated via HuggingFace SDXL — prompts grounded in the detected room geometry
              </p>
              <div className="bp-room-grid">
                {result.roomPrompts.map((rp) => (
                  <RoomImageCard
                    key={rp.roomId}
                    roomId={rp.roomId}
                    roomName={rp.roomName}
                    status={roomImages[rp.roomId] ?? { state: 'idle' }}
                  />
                ))}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  )
}
