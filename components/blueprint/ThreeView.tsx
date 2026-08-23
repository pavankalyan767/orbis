'use client'

import { useRef, Suspense, useMemo } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Text, Environment } from '@react-three/drei'
import * as THREE from 'three'
import type { FloorPlan, Room, Wall } from '@/navigation/types'

// ─── Config ───────────────────────────────────────────────────────────────────

const WALL_HEIGHT  = 2.8   // metres
const WALL_DEPTH   = 0.2   // metres (visual thickness)
const FLOOR_DEPTH  = 0.05
const LABEL_HEIGHT = 3.2   // metres above floor

// Colours
const ROOM_COLORS = [
  '#1a365d', '#1c4532', '#44337a', '#702459', '#234e52', '#2d3748',
]
const WALL_COLOR  = '#e2e8f0'
const FLOOR_COLOR = '#1a1f2e'
const EXIT_COLOR  = '#63b3ed'

// ─── Room mesh ────────────────────────────────────────────────────────────────

function RoomMesh({ room, colorIndex }: { room: Room; colorIndex: number }) {
  const shape = useMemo(() => {
    const s = new THREE.Shape()
    room.polygon.forEach((pt, i) => {
      if (i === 0) s.moveTo(pt.x, -pt.y)  // flip Y for Three.js (Y up)
      else s.lineTo(pt.x, -pt.y)
    })
    s.closePath()
    return s
  }, [room])

  const floorGeom = useMemo(() => new THREE.ShapeGeometry(shape), [shape])

  const color = ROOM_COLORS[colorIndex % ROOM_COLORS.length]

  // Centroid for label
  const cx = room.polygon.reduce((s, p) => s + p.x, 0) / room.polygon.length
  const cy = room.polygon.reduce((s, p) => s + p.y, 0) / room.polygon.length

  return (
    <group>
      {/* Floor */}
      <mesh geometry={floorGeom} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
        <meshStandardMaterial color={color} roughness={0.8} metalness={0.1} />
      </mesh>
      {/* Room label */}
      <Text
        position={[cx, LABEL_HEIGHT, -cy]}
        fontSize={0.4}
        color="#a0aec0"
        anchorX="center"
        anchorY="middle"
        font={undefined}
      >
        {room.name.toUpperCase()}
      </Text>
      {/* Spawn point indicator */}
      <mesh position={[room.spawnPoint.x, 0.05, -room.spawnPoint.y]}>
        <cylinderGeometry args={[0.15, 0.15, 0.1, 16]} />
        <meshStandardMaterial color="#68d391" emissive="#68d391" emissiveIntensity={0.5} />
      </mesh>
    </group>
  )
}

// ─── Wall mesh ────────────────────────────────────────────────────────────────

function WallMesh({ wall }: { wall: Wall }) {
  const { start, end } = wall

  const dx = end.x - start.x
  const dy = end.y - start.y
  const length = Math.sqrt(dx * dx + dy * dy)
  const angle  = Math.atan2(dy, dx)

  const midX = (start.x + end.x) / 2
  const midZ = -((start.y + end.y) / 2)

  return (
    <mesh position={[midX, WALL_HEIGHT / 2, midZ]} rotation={[0, -angle, 0]}>
      <boxGeometry args={[length, WALL_HEIGHT, WALL_DEPTH]} />
      <meshStandardMaterial color={WALL_COLOR} roughness={0.9} />
    </mesh>
  )
}

// ─── Exit indicator ───────────────────────────────────────────────────────────

function ExitIndicator({ room }: { room: Room }) {
  return (
    <>
      {room.exits.map((exit) => {
        const b = exit.bounds
        const cx = b.x + b.width / 2
        const cz = -(b.y + b.height / 2)
        return (
          <mesh key={exit.id} position={[cx, 0.02, cz]}>
            <boxGeometry args={[b.width, 0.04, b.height]} />
            <meshStandardMaterial
              color={EXIT_COLOR}
              transparent
              opacity={0.5}
              emissive={EXIT_COLOR}
              emissiveIntensity={0.3}
            />
          </mesh>
        )
      })}
    </>
  )
}

// ─── Ground plane ─────────────────────────────────────────────────────────────

function GroundPlane({ width, depth }: { width: number; depth: number }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[width / 2, -0.01, -depth / 2]}>
      <planeGeometry args={[width + 4, depth + 4]} />
      <meshStandardMaterial color={FLOOR_COLOR} roughness={1} />
    </mesh>
  )
}

// ─── Scene ────────────────────────────────────────────────────────────────────

function Scene({ floorPlan }: { floorPlan: FloorPlan }) {
  // Compute scene bounds for camera positioning
  const bounds = useMemo(() => {
    let maxX = 0, maxY = 0
    for (const room of floorPlan.rooms) {
      for (const pt of room.polygon) {
        if (pt.x > maxX) maxX = pt.x
        if (pt.y > maxY) maxY = pt.y
      }
    }
    return { width: maxX, depth: maxY }
  }, [floorPlan])

  const cx = bounds.width / 2
  const cz = -(bounds.depth / 2)

  return (
    <>
      <ambientLight intensity={0.6} />
      <directionalLight position={[cx + 10, 15, cz + 10]} intensity={1} castShadow />
      <pointLight position={[cx, 8, cz]} intensity={0.5} color="#6b9fff" />

      <GroundPlane width={bounds.width} depth={bounds.depth} />

      {floorPlan.rooms.map((room, i) => (
        <RoomMesh key={room.id} room={room} colorIndex={i} />
      ))}

      {floorPlan.walls.map((wall) => (
        <WallMesh key={wall.id} wall={wall} />
      ))}

      {floorPlan.rooms.map((room) => (
        <ExitIndicator key={room.id} room={room} />
      ))}

      <OrbitControls
        target={[cx, 0, cz]}
        enableDamping
        dampingFactor={0.05}
        maxPolarAngle={Math.PI / 2.1}
        minDistance={3}
        maxDistance={40}
      />
    </>
  )
}

// ─── Public component ─────────────────────────────────────────────────────────

interface ThreeViewProps {
  floorPlan: FloorPlan
  className?: string
}

export function ThreeView({ floorPlan, className }: ThreeViewProps) {
  return (
    <div className={className} style={{ background: '#0d1117', borderRadius: 8 }}>
      <Canvas
        camera={{
          position: [
            floorPlan.rooms.reduce((s, r) => s + r.polygon.reduce((a, p) => a + p.x, 0) / r.polygon.length, 0) /
              floorPlan.rooms.length,
            14,
            8,
          ],
          fov: 50,
        }}
        shadows
      >
        <Suspense fallback={null}>
          <Scene floorPlan={floorPlan} />
        </Suspense>
      </Canvas>
      <p style={{ textAlign: 'center', fontSize: 11, color: '#4a5568', padding: '4px 0', margin: 0 }}>
        🖱 Drag to orbit · Scroll to zoom · Right-drag to pan
      </p>
    </div>
  )
}
