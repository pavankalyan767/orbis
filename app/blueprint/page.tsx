'use client'

import { useCallback, useRef, useState, useEffect, useMemo } from 'react'
import type { FloorPlan, Room, RoomTransition } from '@/navigation/types'
import { generateRoomImage, USE_PUTER_IMAGE_GEN } from '@/lib/blueprint/roomImageGen'
import dynamic from 'next/dynamic'
import { ReactorWorldProvider, useReactorWorld } from '@/lib/reactor/world-provider'
import { useRoomSwitcherState } from '@/components/room-switcher'
import { getReactorJwt } from '@/lib/reactor/token'
import { NavigationEngine } from '@/navigation/NavigationEngine'
import { useNavigationLoop } from '@/lib/navigation/useNavigationLoop'
import { useRoomNarration } from '@/lib/narration/useRoomNarration'
import { LiveWorld } from '@/components/live-world'

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

type ReviseStatus =
  | { state: 'idle' }
  | { state: 'working' }
  | { state: 'done'; geometryChanges: string[]; cosmeticNotes: string[] }
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

// ─── Room Image Card (with feedback loop) ─────────────────────────────────────

function RoomImageCard({
  roomName, status, feedback, revise, onFeedbackChange, onRegenerate,
}: {
  roomId: string
  roomName: string
  status: RoomImageStatus
  feedback: string
  revise: ReviseStatus
  onFeedbackChange: (v: string) => void
  onRegenerate: () => void
}) {
  return (
    <div className="room-card">
      <p className="room-card-title">{roomName}</p>
      {status.state === 'idle' && (
        <div className="room-card-placeholder">Queued…</div>
      )}
      {status.state === 'loading' && (
        <div className="room-card-placeholder shimmer">Loading…</div>
      )}
      {status.state === 'done' && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={status.dataUrl} alt={roomName} className="room-card-img" />
      )}
      {status.state === 'error' && (
        <div className="room-card-placeholder error">{status.message}</div>
      )}

      {/* ── Feedback / learning loop ─────────────────────────────────────── */}
      <textarea
        className="room-feedback-input"
        placeholder={'Feedback — e.g. "move the west wall 3 feet out", "paint the walls sage green", "move the table to the window"'}
        value={feedback}
        rows={3}
        onChange={(e) => onFeedbackChange(e.target.value)}
        disabled={revise.state === 'working'}
      />
      <button
        className="bp-btn-sm room-feedback-btn"
        onClick={onRegenerate}
        disabled={revise.state === 'working' || feedback.trim().length === 0}
      >
        {revise.state === 'working' ? 'Regenerating…' : 'Generate'}
      </button>

      {revise.state === 'error' && (
        <div className="room-feedback-error">{revise.message}</div>
      )}
      {revise.state === 'done' && (
        <div className="room-feedback-ok">
          {revise.geometryChanges.length > 0 && (
            <div><strong>Geometry:</strong> {revise.geometryChanges.join('; ')}</div>
          )}
          {revise.cosmeticNotes.length > 0 && (
            <div><strong>Styling:</strong> {revise.cosmeticNotes.join('; ')}</div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function BlueprintPage() {
  return (
    <ReactorWorldProvider>
      <BlueprintApp />
    </ReactorWorldProvider>
  )
}

function BlueprintApp() {
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [result, setResult] = useState<ParseResult | null>(null)
  const [roomImages, setRoomImages] = useState<Record<string, RoomImageStatus>>({})
  const [activeTab, setActiveTab] = useState<'svg' | '3d' | 'json'>('svg')
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  // Feedback / learning loop state
  const [feedbackDrafts, setFeedbackDrafts] = useState<Record<string, string>>({})
  const [feedbackHistory, setFeedbackHistory] = useState<Record<string, string[]>>({})
  const [reviseStatus, setReviseStatus] = useState<Record<string, ReviseStatus>>({})
  // Per-room Reactor world prompt, overridden by the revision pipeline.
  const [worldPrompts, setWorldPrompts] = useState<Record<string, string>>({})

  const world = useReactorWorld()
  const roomSwitcher = useRoomSwitcherState()
  const [generatingWorlds, setGeneratingWorlds] = useState(false)
  const [worldGenLog, setWorldGenLog] = useState<string[]>([])
  const [navEngine, setNavEngine] = useState<NavigationEngine | null>(null)

  // Keep a live ref to the reactive worldState so async loops can poll it
  // without capturing a stale render's value.
  const worldStateRef = useRef(world.worldState)
  useEffect(() => { worldStateRef.current = world.worldState }, [world.worldState])

  // roomSwitcher / world are fresh object literals every render. Hold them in
  // refs so effects below don't churn (previously this rebuilt the
  // NavigationEngine on every single render and reset the player).
  const roomSwitcherRef = useRef(roomSwitcher)
  useEffect(() => { roomSwitcherRef.current = roomSwitcher })
  const worldRef = useRef(world)
  useEffect(() => { worldRef.current = world })

  // ── File upload handler ─────────────────────────────────────────────────────
  const handleFile = useCallback(async (file: File) => {
    setParseError(null)
    setResult(null)
    setRoomImages({})
    setFeedbackDrafts({})
    setFeedbackHistory({})
    setReviseStatus({})
    setWorldPrompts({})
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
      setWorldGenLog([])

      const newRooms = parsed.floorPlan.rooms.map((r) => ({
        id: r.id,
        name: r.name,
        worldId: null,
      }))
      roomSwitcherRef.current.initializeRooms(newRooms)

      // Mark every room as loading up front so the grid reflects real progress
      // (previously cards sat on "Queued…" for the whole run).
      setRoomImages(
        Object.fromEntries(parsed.roomPrompts.map((rp) => [rp.roomId, { state: 'loading' } as RoomImageStatus])),
      )

      const resolveImagesSequentially = async () => {
        for (const rp of parsed.roomPrompts) {
          const room = parsed.floorPlan.rooms.find((r) => r.id === rp.roomId)
          if (!room) continue

          try {
            const imgData = await generateRoomImage(room, parsed.floorPlan)
            setRoomImages((prev) => ({
              ...prev,
              [rp.roomId]: imgData.ok
                ? { state: 'done', dataUrl: imgData.dataUrl }
                : { state: 'error', message: imgData.error },
            }))
          } catch (err) {
            setRoomImages((prev) => ({
              ...prev,
              [rp.roomId]: { state: 'error', message: String(err) },
            }))
          }
        }
      }

      void resolveImagesSequentially()
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err))
    } finally {
      setParsing(false)
    }
  }, [])

  // ── NavigationEngine: build once per parsed floor plan ──────────────────────
  // Depends only on `result` — world/roomSwitcher are read through refs so this
  // does not rebuild (and reset the player) on every render.
  useEffect(() => {
    if (!result || result.floorPlan.rooms.length === 0) {
      setNavEngine(null)
      return
    }
    const startRoom = result.floorPlan.rooms[0]
    const nav = new NavigationEngine(
      result.floorPlan,
      startRoom.id,
      startRoom.spawnPoint.x,
      startRoom.spawnPoint.y,
    )
    setNavEngine(nav)
  }, [result])

  // ── Automatic room transition on doorway crossing ───────────────────────────
  const handleTransition = useCallback(async (transition: RoomTransition) => {
    const rs = roomSwitcherRef.current
    const target = rs.rooms.find((r) => r.id === transition.toRoomId)

    if (!target?.worldId) {
      // Don't fail silently — the player walked through a real door and
      // deserves to know why nothing happened.
      rs.setSwitchError(
        `You walked into ${target?.name ?? transition.toRoomId}, but no world has been generated for it yet. Generate worlds first.`,
      )
      return
    }

    const ok = await rs.switchRoom(transition.toRoomId, worldRef.current)
    if (ok) {
      // Contract from navigation/README.md: reset the player to the new room's
      // spawn point so dead reckoning restarts from a known-good position, and
      // so they aren't left standing in the doorway they just crossed.
      navEngine?.respawnIn(transition.toRoomId)
    }
  }, [navEngine])

  const navState = useNavigationLoop(navEngine, world.streaming, handleTransition)

  // ── Realtor narration on spawn ──────────────────────────────────────────────
  const activeRoom: Room | null = useMemo(() => {
    if (!result) return null
    return result.floorPlan.rooms.find((r) => r.id === roomSwitcher.activeRoomId) ?? null
  }, [result, roomSwitcher.activeRoomId])

  const narration = useRoomNarration({
    room: activeRoom,
    floorPlan: result?.floorPlan ?? null,
    feedback: activeRoom ? feedbackHistory[activeRoom.id] : undefined,
    active: world.streaming,
  })

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

  // Convert an image URL (local /rooms/*.jpeg or a data URL) to a File,
  // centre-cropping to 16:9. Same-origin sources do not taint the canvas.
  const imageUrlToFile = async (url: string, filename: string): Promise<File> => {
    return new Promise((resolve, reject) => {
      const img = new Image()
      img.onload = () => {
        const canvas = document.createElement('canvas')
        const targetRatio = 16 / 9
        const currentRatio = img.width / img.height

        let cropWidth = img.width
        let cropHeight = img.height

        if (currentRatio < targetRatio) {
          cropHeight = img.width / targetRatio
        } else if (currentRatio > targetRatio) {
          cropWidth = img.height * targetRatio
        }

        canvas.width = cropWidth
        canvas.height = cropHeight

        const ctx = canvas.getContext('2d')
        if (!ctx) return reject(new Error('Failed to get 2d context'))

        const sx = (img.width - cropWidth) / 2
        const sy = (img.height - cropHeight) / 2

        ctx.drawImage(img, sx, sy, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight)

        canvas.toBlob((blob) => {
          if (!blob) return reject(new Error('Failed to create blob'))
          resolve(new File([blob], filename, { type: 'image/jpeg' }))
        }, 'image/jpeg', 0.9)
      }
      img.onerror = () => reject(new Error('Failed to load image for cropping'))
      img.src = url
    })
  }

  /**
   * Creates one Reactor world and returns its id.
   *
   * The SDK's `createWorldAndWait` resolves on the first `phase === "ready"`
   * world-state snapshot WITHOUT checking the id (its sibling
   * `attachWorldAndWait` does guard). While a new first-frame image uploads,
   * the previously-attached world is still `ready` and re-broadcasts — so the
   * promise resolves with the PREVIOUS room's id. That is why every room after
   * the first came back pointing at the living room's world.
   *
   * We therefore treat an already-claimed id as a false resolve and poll the
   * live world-state for the genuinely new one.
   */
  const createWorldForRoom = async (
    prompt: string,
    file: File,
    claimedIds: Set<string>,
  ): Promise<string | null> => {
    const created = await world.createWorld({
      prompt,
      perspective: 'first_person',
      firstFrameImage: file,
    })

    const id = created?.encrypted_world_id
    if (id && !claimedIds.has(id)) return id

    // False resolve — wait for a ready snapshot carrying an unclaimed id.
    const deadline = Date.now() + 90_000
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 250))
      const snap = worldStateRef.current
      const snapId = snap?.encrypted_world_id
      if (snap?.phase === 'ready' && snapId && !claimedIds.has(snapId)) {
        return snapId
      }
    }
    return null
  }

  const handleGenerateWorlds = async () => {
    if (!result) return
    setGeneratingWorlds(true)
    setWorldGenLog([])

    const addLog = (msg: string) => setWorldGenLog((prev) => [...prev, msg])

    // Ids already assigned to a room this run — the false-resolve guard.
    const claimedIds = new Set<string>(
      roomSwitcher.rooms.map((r) => r.worldId).filter((v): v is string => Boolean(v)),
    )

    try {
      if (world.phase !== 'connected' && world.phase !== 'starting_stream' && world.phase !== 'streaming') {
        addLog('Connecting to Reactor…')
        await world.connect(getReactorJwt)
      }

      for (const room of result.floorPlan.rooms) {
        const status = roomImages[room.id]
        if (status?.state !== 'done') {
          addLog(`Skipping ${room.name} (no image available)`)
          continue
        }

        // One room failing must not abort the remaining rooms.
        try {
          addLog(`Building world for ${room.name}…`)
          const file = await imageUrlToFile(status.dataUrl, `${room.id}.jpg`)
          const prompt = worldPrompts[room.id] ?? `Interior view of a ${room.name}`

          const worldId = await createWorldForRoom(prompt, file, claimedIds)

          if (worldId) {
            claimedIds.add(worldId)
            addLog(`✅ ${room.name} → ${worldId.slice(0, 8)}…`)
            roomSwitcher.saveRoomWorld(room.id, worldId)
          } else {
            addLog(`❌ ${room.name}: timed out waiting for a distinct world id`)
          }
        } catch (err) {
          addLog(`❌ ${room.name}: ${err instanceof Error ? err.message : String(err)}`)
        }
      }
      addLog('Done — you can now explore the generated worlds.')
    } catch (err) {
      addLog(`❌ Error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setGeneratingWorlds(false)
    }
  }

  // ── Feedback → revised blueprint → regenerated world ────────────────────────
  const handleRegenerateRoom = async (roomId: string) => {
    if (!result) return
    const draft = (feedbackDrafts[roomId] ?? '').trim()
    if (!draft) return

    const history = [...(feedbackHistory[roomId] ?? []), draft]
    setReviseStatus((p) => ({ ...p, [roomId]: { state: 'working' } }))

    try {
      const res = await fetch('/api/blueprint/revise', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ floorPlan: result.floorPlan, roomId, feedback: history }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `Revision failed (${res.status})`)

      // Swap in the revised plan — SVG, 3D and JSON views all follow from it.
      setResult((prev) => (prev ? { ...prev, floorPlan: data.floorPlan, svg: data.svg } : prev))
      setFeedbackHistory((p) => ({ ...p, [roomId]: history }))
      setFeedbackDrafts((p) => ({ ...p, [roomId]: '' }))
      setWorldPrompts((p) => ({ ...p, [roomId]: data.worldPrompt }))
      setReviseStatus((p) => ({
        ...p,
        [roomId]: {
          state: 'done',
          geometryChanges: data.geometryChanges ?? [],
          cosmeticNotes: data.cosmeticNotes ?? [],
        },
      }))

      // Rebuild just this room's world from the revised prompt.
      const room = (data.floorPlan as FloorPlan).rooms.find((r) => r.id === roomId)
      const status = roomImages[roomId]
      if (room && status?.state === 'done') {
        setWorldGenLog((prev) => [...prev, `Rebuilding ${room.name} from feedback…`])
        const claimedIds = new Set<string>(
          roomSwitcher.rooms.map((r) => r.worldId).filter((v): v is string => Boolean(v)),
        )
        if (world.phase !== 'connected' && world.phase !== 'starting_stream' && world.phase !== 'streaming') {
          await world.connect(getReactorJwt)
        }
        const file = await imageUrlToFile(status.dataUrl, `${roomId}.jpg`)
        const worldId = await createWorldForRoom(data.worldPrompt, file, claimedIds)
        if (worldId) {
          roomSwitcher.saveRoomWorld(roomId, worldId)
          setWorldGenLog((prev) => [...prev, `✅ ${room.name} rebuilt → ${worldId.slice(0, 8)}…`])
        } else {
          setWorldGenLog((prev) => [...prev, `❌ ${room.name}: could not capture the new world id`])
        }
      }
    } catch (err) {
      setReviseStatus((p) => ({
        ...p,
        [roomId]: { state: 'error', message: err instanceof Error ? err.message : String(err) },
      }))
    }
  }

  const handleEnterWorld = async () => {
    const activeRoomInfo = roomSwitcher.rooms.find((r) => r.id === roomSwitcher.activeRoomId)
    if (!activeRoomInfo?.worldId) return

    try {
      if (world.phase !== 'connected' && world.phase !== 'starting_stream' && world.phase !== 'streaming') {
        await world.connect(getReactorJwt)
      }
      await world.attachWorld(activeRoomInfo.worldId)
      await world.startTravel()
      navEngine?.respawnIn(activeRoomInfo.id)
    } catch (err) {
      console.error('Failed to enter world:', err)
      alert('Failed to enter world: ' + String(err))
    }
  }

  const hasAnyWorld = roomSwitcher.rooms.some((r) => r.worldId)
  const anyImageReady = Object.values(roomImages).some((s) => s.state === 'done')

  // Name of the room the player is standing in a doorway to, for the HUD hint.
  const pendingRoomName = navState.pendingExit
    ? result?.floorPlan.rooms.find((r) => r.id === navState.pendingExit!.targetRoomId)?.name ?? null
    : null

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
            <span className="spinner" /> Analysing floor plan…
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
              <button className={activeTab === 'svg' ? 'active' : ''} onClick={() => setActiveTab('svg')}>
                🗺 Collision SVG
              </button>
              <button className={activeTab === '3d' ? 'active' : ''} onClick={() => setActiveTab('3d')}>
                🏗 3D View
              </button>
              <button className={activeTab === 'json' ? 'active' : ''} onClick={() => setActiveTab('json')}>
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
                <div className="bp-svg-wrap" dangerouslySetInnerHTML={{ __html: result.svg }} />
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
                  <button
                    className="bp-btn-sm"
                    onClick={() => navigator.clipboard.writeText(JSON.stringify(result.floorPlan, null, 2))}
                  >
                    Copy JSON
                  </button>
                  <button className="bp-btn-sm" onClick={downloadJson}>Download JSON</button>
                </div>
                <pre className="bp-json">{JSON.stringify(result.floorPlan, null, 2)}</pre>
              </div>
            )}

            {/* Room images + feedback */}
            <section className="bp-rooms-section">
              <h2>Per-Room Images</h2>
              <p className="bp-rooms-sub">
                {USE_PUTER_IMAGE_GEN
                  ? 'Generated via Puter — prompts grounded in the detected room geometry'
                  : 'Loaded from public/rooms/ — matched by room name. Add feedback below to revise the blueprint and rebuild a room.'}
              </p>
              <div className="bp-room-grid">
                {result.roomPrompts.map((rp) => (
                  <RoomImageCard
                    key={rp.roomId}
                    roomId={rp.roomId}
                    roomName={rp.roomName}
                    status={roomImages[rp.roomId] ?? { state: 'idle' }}
                    feedback={feedbackDrafts[rp.roomId] ?? ''}
                    revise={reviseStatus[rp.roomId] ?? { state: 'idle' }}
                    onFeedbackChange={(v) => setFeedbackDrafts((p) => ({ ...p, [rp.roomId]: v }))}
                    onRegenerate={() => handleRegenerateRoom(rp.roomId)}
                  />
                ))}
              </div>

              <div style={{ marginTop: '30px', borderTop: '1px solid #333', paddingTop: '20px' }}>
                <button
                  className="bp-btn"
                  onClick={handleGenerateWorlds}
                  disabled={generatingWorlds || !anyImageReady}
                >
                  {generatingWorlds ? 'Generating Worlds…' : 'Generate Worlds (Reactor)'}
                </button>

                {worldGenLog.length > 0 && (
                  <div style={{ marginTop: '15px', background: '#111', padding: '15px', borderRadius: '8px', fontSize: '0.9rem', fontFamily: 'monospace' }}>
                    {worldGenLog.map((log, i) => (
                      <div key={i} style={{ color: log.includes('❌') ? '#ff4444' : log.includes('✅') ? '#00cc66' : '#aaa', marginBottom: '4px' }}>
                        {log}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            {/* Live Reactor World */}
            {hasAnyWorld && (
              <section className="bp-live-section" style={{ marginTop: '40px', padding: '20px', background: '#0a0a0a', borderRadius: '12px', border: '1px solid #333' }}>
                <h2 style={{ marginBottom: '20px' }}>Immersive World View</h2>

                {/* Dead-reckoned position + manual override hint */}
                {world.streaming && (
                  <div className="bp-nav-hud">
                    <span>📍 {result.floorPlan.rooms.find((r) => r.id === navState.roomId)?.name ?? navState.roomId}</span>
                    <span className="bp-nav-coords">
                      {navState.x.toFixed(1)}m, {navState.y.toFixed(1)}m
                    </span>
                    {pendingRoomName && (
                      <span className="bp-nav-hint">🚪 Doorway to {pendingRoomName} — walk through, or use the chips below</span>
                    )}
                    {narration.status === 'playing' && <span className="bp-nav-narrating">🔊 Narrating…</span>}
                    {narration.status === 'error' && (
                      <button className="bp-btn-sm" onClick={narration.replay}>🔊 Play room intro</button>
                    )}
                  </div>
                )}

                {narration.script && (
                  <p className="bp-narration-script">“{narration.script}”</p>
                )}

                <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', background: '#000', borderRadius: '8px', overflow: 'hidden' }}>
                  <LiveWorld
                    world={world}
                    onEnterAgain={handleEnterWorld}
                    onNewWorld={() => {}}
                    rooms={roomSwitcher.rooms}
                    activeRoomId={roomSwitcher.activeRoomId}
                    switching={roomSwitcher.switching}
                    switchStage={roomSwitcher.switchStage}
                    switchError={roomSwitcher.switchError}
                    onDismissError={() => roomSwitcher.setSwitchError(null)}
                    onSwitchRoom={async (id) => {
                      const ok = await roomSwitcher.switchRoom(id, world)
                      if (ok) navEngine?.respawnIn(id)
                    }}
                  />
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  )
}
