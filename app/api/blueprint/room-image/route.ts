import { NextRequest, NextResponse } from 'next/server'
import { generateRoomImage } from '@/lib/blueprint/roomImageGen'
import type { FloorPlan } from '@/navigation/types'

export const runtime = 'nodejs'
export const maxDuration = 120   // HuggingFace cold starts can be slow

export async function POST(req: NextRequest) {
  let body: { roomId: string; floorPlan: FloorPlan }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const { roomId, floorPlan } = body
  if (!roomId || !floorPlan) {
    return NextResponse.json({ error: '"roomId" and "floorPlan" are required.' }, { status: 400 })
  }

  const room = floorPlan.rooms.find((r) => r.id === roomId)
  if (!room) {
    return NextResponse.json({ error: `Room "${roomId}" not found in FloorPlan.` }, { status: 404 })
  }

  const nvidiaApiKey = process.env.NVIDIA_API_KEY

  if (!nvidiaApiKey) {
    return NextResponse.json({ error: 'NVIDIA API key not configured' }, { status: 500 })
  }

  const result = await generateRoomImage(room, floorPlan, nvidiaApiKey)

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 502 })
  }

  return NextResponse.json({ roomId, dataUrl: result.dataUrl })
}
