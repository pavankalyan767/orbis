import type { Metadata } from 'next'
import './blueprint.css'

export const metadata: Metadata = {
  title: 'Blueprint Parser — ArchWorld',
  description: 'Upload an architectural floor plan to generate FloorPlan JSON, collision SVG, 3D model, and per-room images.',
}

export default function BlueprintLayout({ children }: { children: React.ReactNode }) {
  return children
}
