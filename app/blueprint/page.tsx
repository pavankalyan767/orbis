'use client'

import { useCallback, useRef, useState, useEffect } from 'react'
import type { FloorPlan } from '@/navigation/types'
import { generateRoomImage } from '@/lib/blueprint/roomImageGen'
import dynamic from 'next/dynamic'
import { ReactorWorldProvider, useReactorWorld } from '@/lib/reactor/world-provider'
import { useRoomSwitcherState } from '@/components/room-switcher'
import { getReactorJwt } from '@/lib/reactor/token'
import { NavigationEngine } from '@/navigation/NavigationEngine'
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
  
  const world = useReactorWorld()
  const roomSwitcher = useRoomSwitcherState()
  const [generatingWorlds, setGeneratingWorlds] = useState(false)
  const [worldGenLog, setWorldGenLog] = useState<string[]>([])
  const navEngineRef = useRef<NavigationEngine | null>(null)

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
      setWorldGenLog([])
      
      const newRooms = parsed.floorPlan.rooms.map(r => ({
        id: r.id,
        name: r.name,
        worldId: null
      }))
      roomSwitcher.initializeRooms(newRooms)

      // Kick off room image generation — sequentially in background
      const generateImagesSequentially = async () => {
        for (const rp of parsed.roomPrompts) {
          const room = parsed.floorPlan.rooms.find(r => r.id === rp.roomId)
          if (!room) continue;

          try {
            const imgData = await generateRoomImage(room, parsed.floorPlan)
            if (imgData.ok && imgData.dataUrl) {
              setRoomImages((prev) => ({
                ...prev,
                [rp.roomId]: { state: 'done', dataUrl: imgData.dataUrl! },
              }))
            } else {
              setRoomImages((prev) => ({
                ...prev,
                [rp.roomId]: { state: 'error', message: imgData.error ?? 'Generation failed' },
              }))
            }
          } catch (err) {
            setRoomImages((prev) => ({
              ...prev,
              [rp.roomId]: { state: 'error', message: String(err) },
            }))
          }
        }
      }
      
      generateImagesSequentially()
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err))
    } finally {
      setParsing(false)
    }
  }, [roomSwitcher])

  // Initialize NavigationEngine when result is ready
  useEffect(() => {
    if (result && result.floorPlan.rooms.length > 0) {
      const startRoom = result.floorPlan.rooms[0]
      const nav = new NavigationEngine(
        result.floorPlan,
        startRoom.id,
        startRoom.spawnPoint.x,
        startRoom.spawnPoint.y
      )
      
      nav.onRoomTransition((transition) => {
        console.log(`Transitioning from ${transition.fromRoomId} to ${transition.toRoomId}`)
        roomSwitcher.switchRoom(transition.toRoomId, world)
      })
      
      navEngineRef.current = nav
    }
  }, [result, world, roomSwitcher])

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

  // Convert base64 dataUrl to File, automatically cropping to 16:9 landscape ratio
  const dataUrlToFile = async (dataUrl: string, filename: string): Promise<File> => {
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
        
        // Center crop
        const sx = (img.width - cropWidth) / 2
        const sy = (img.height - cropHeight) / 2
        
        ctx.drawImage(img, sx, sy, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight)
        
        canvas.toBlob((blob) => {
          if (!blob) return reject(new Error('Failed to create blob'))
          resolve(new File([blob], filename, { type: 'image/jpeg' }))
        }, 'image/jpeg', 0.9)
      }
      img.onerror = () => reject(new Error('Failed to load image for cropping'))
      img.src = dataUrl
    })
  }

  const handleGenerateWorlds = async () => {
    if (!result) return
    setGeneratingWorlds(true)
    setWorldGenLog([])
    
    const addLog = (msg: string) => setWorldGenLog(prev => [...prev, msg])
    
    try {
      if (world.phase !== "connected" && world.phase !== "starting_stream" && world.phase !== "streaming") {
        addLog("Connecting to Reactor...")
        await world.connect(getReactorJwt)
      }
      
      for (const room of result.floorPlan.rooms) {
        const status = roomImages[room.id]
        if (status?.state !== 'done') {
          addLog(`Skipping ${room.name} (no valid image generated)`)
          continue
        }
        
        addLog(`Building world for ${room.name}...`)
        const file = await dataUrlToFile(status.dataUrl, `${room.id}.jpg`)
        
        const created = await world.createWorld({
          prompt: `Interior view of a ${room.name}`,
          perspective: "first_person",
          firstFrameImage: file
        })
        
        if (created.encrypted_world_id) {
          addLog(`✅ World created for ${room.name} (${created.encrypted_world_id.slice(0, 8)}...)`)
          roomSwitcher.saveRoomWorld(room.id, created.encrypted_world_id)
        } else {
          addLog(`❌ Failed to create world for ${room.name}`)
        }
      }
      addLog("Done! You can now explore the generated worlds.")
    } catch (err: any) {
      addLog(`❌ Error: ${err.message}`)
    } finally {
      setGeneratingWorlds(false)
    }
  }

  const handleEnterWorld = async () => {
    const activeRoom = roomSwitcher.rooms.find(r => r.id === roomSwitcher.activeRoomId);
    if (!activeRoom?.worldId) return;
    
    try {
      if (world.phase !== "connected" && world.phase !== "starting_stream" && world.phase !== "streaming") {
        await world.connect(getReactorJwt);
      }
      await world.attachWorld(activeRoom.worldId);
      await world.startTravel();
    } catch (err) {
      console.error("Failed to enter world:", err);
      alert("Failed to enter world: " + String(err));
    }
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
              
              <div style={{ marginTop: '30px', borderTop: '1px solid #333', paddingTop: '20px' }}>
                <button 
                  className="bp-btn" 
                  onClick={handleGenerateWorlds}
                  disabled={generatingWorlds || Object.values(roomImages).every(s => s.state !== 'done')}
                >
                  {generatingWorlds ? 'Generating Worlds...' : 'Generate Worlds (Reactor)'}
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
            {(world.phase !== 'no_world' || roomSwitcher.rooms.some(r => r.worldId)) && (
              <section className="bp-live-section" style={{ marginTop: '40px', padding: '20px', background: '#0a0a0a', borderRadius: '12px', border: '1px solid #333' }}>
                <h2 style={{ marginBottom: '20px' }}>Immersive World View</h2>
                <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', background: '#000', borderRadius: '8px', overflow: 'hidden' }}>
                  <LiveWorld
                    world={world}
                    onEnterAgain={handleEnterWorld}
                    onNewWorld={() => {}}
                    rooms={roomSwitcher.rooms}
                    activeRoomId={roomSwitcher.activeRoomId}
                    switching={roomSwitcher.switching}
                    onSwitchRoom={(id) => roomSwitcher.switchRoom(id, world)}
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
