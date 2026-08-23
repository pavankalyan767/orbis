'use client';

import { useState } from 'react';

export default function TestImagePage() {
  const [roomName, setRoomName] = useState('Living Room');
  const [width, setWidth] = useState(5);
  const [height, setHeight] = useState(5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  const handleGenerate = async () => {
    setLoading(true);
    setError(null);
    setImageUrl(null);

    const mockFloorPlan = {
      rooms: [
        {
          id: 'test-room',
          name: roomName,
          polygon: [
            { x: 0, y: 0 },
            { x: width, y: 0 },
            { x: width, y: height },
            { x: 0, y: height },
          ],
          exits: [],
        },
      ],
      edges: [],
    };

    try {
      const res = await fetch('/api/blueprint/room-image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId: 'test-room',
          floorPlan: mockFloorPlan,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || 'Failed to generate image');
      }

      setImageUrl(data.dataUrl);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ maxWidth: '800px', margin: '40px auto', fontFamily: 'sans-serif' }}>
      <h1>Test Image Generation (Google Gemini Imagen 3)</h1>
      <p style={{ color: '#666' }}>
        This interface hits the exact same <code>/api/blueprint/room-image</code> route that the blueprint pipeline uses.
        It mocks a floor plan based on your inputs below.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '15px', marginBottom: '30px', background: '#f5f5f5', padding: '20px', borderRadius: '8px' }}>
        <div>
          <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '5px' }}>Room Name (e.g. Master Bedroom, Kitchen)</label>
          <input
            type="text"
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            style={{ padding: '8px', width: '100%', boxSizing: 'border-box' }}
          />
        </div>
        <div style={{ display: 'flex', gap: '20px' }}>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '5px' }}>Width (meters)</label>
            <input
              type="number"
              value={width}
              onChange={(e) => setWidth(Number(e.target.value))}
              style={{ padding: '8px', width: '100%', boxSizing: 'border-box' }}
            />
          </div>
          <div style={{ flex: 1 }}>
            <label style={{ display: 'block', fontWeight: 'bold', marginBottom: '5px' }}>Height/Depth (meters)</label>
            <input
              type="number"
              value={height}
              onChange={(e) => setHeight(Number(e.target.value))}
              style={{ padding: '8px', width: '100%', boxSizing: 'border-box' }}
            />
          </div>
        </div>
        <button
          onClick={handleGenerate}
          disabled={loading}
          style={{
            padding: '12px',
            background: loading ? '#ccc' : '#0070f3',
            color: '#fff',
            border: 'none',
            borderRadius: '4px',
            cursor: loading ? 'not-allowed' : 'pointer',
            fontWeight: 'bold',
            marginTop: '10px'
          }}
        >
          {loading ? 'Generating...' : 'Generate Image'}
        </button>
      </div>

      {error && (
        <div style={{ padding: '15px', background: '#fee', color: '#c00', borderRadius: '8px', marginBottom: '20px' }}>
          <strong>Error:</strong> {error}
        </div>
      )}

      {imageUrl && (
        <div style={{ border: '1px solid #ddd', padding: '10px', borderRadius: '8px', background: '#fff' }}>
          <h3 style={{ marginTop: 0 }}>Result</h3>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt="Generated room" style={{ width: '100%', height: 'auto', borderRadius: '4px' }} />
        </div>
      )}
    </div>
  );
}
