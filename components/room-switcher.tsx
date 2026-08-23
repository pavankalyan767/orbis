"use client";

import { useCallback, useState, useEffect } from "react";
import type { ReactorWorld } from "@/lib/reactor/world-provider";
import { describeReactorError } from "@/lib/reactor/errors";

export interface RoomWorldInfo {
  id: string;
  name: string;
  worldId: string | null;
}

const DEFAULT_ROOMS: RoomWorldInfo[] = [
  { id: "living", name: "Living Room", worldId: null },
  { id: "kitchen", name: "Kitchen", worldId: null },
  { id: "bedroom", name: "Bedroom", worldId: null },
  { id: "hallway", name: "Hallway", worldId: null },
];

export function useRoomSwitcherState() {
  const [rooms, setRooms] = useState<RoomWorldInfo[]>(DEFAULT_ROOMS);

  useEffect(() => {
    const saved = localStorage.getItem("orbis-room-worlds");
    if (saved) {
      try {
        setRooms(JSON.parse(saved) as RoomWorldInfo[]);
      } catch {
        // use default
      }
    }
  }, []);

  const [activeRoomId, setActiveRoomId] = useState<string>("living");
  const [switching, setSwitching] = useState(false);
  const [switchError, setSwitchError] = useState<string | null>(null);

  const saveRoomWorld = useCallback((roomId: string, encryptedWorldId: string) => {
    setRooms((prev) => {
      const updated = prev.map((r) =>
        r.id === roomId ? { ...r, worldId: encryptedWorldId } : r
      );
      if (typeof window !== "undefined") {
        localStorage.setItem("orbis-room-worlds", JSON.stringify(updated));
      }
      return updated;
    });
  }, []);

  const switchRoom = useCallback(
    async (targetRoomId: string, world: ReactorWorld) => {
      const targetRoom = rooms.find((r) => r.id === targetRoomId);
      if (!targetRoom || !targetRoom.worldId) {
        setSwitchError(`No world generated for ${targetRoom?.name ?? targetRoomId} yet.`);
        return false;
      }

      setSwitching(true);
      setSwitchError(null);
      try {
        if (world.streaming) {
          await world.endTravelSession();
        }

        const p = world.phase;
        if (p === "ended" || p === "failed") {
          const { getReactorJwt } = await import("@/lib/reactor/token");
          await world.connect(getReactorJwt);
        }

        await world.attachWorld(targetRoom.worldId);
        await world.startTravel();
        setActiveRoomId(targetRoomId);
        return true;
      } catch (err) {
        setSwitchError(describeReactorError(err));
        return false;
      } finally {
        setSwitching(false);
      }
    },
    [rooms]
  );

  return {
    rooms,
    activeRoomId,
    setActiveRoomId,
    switching,
    switchError,
    setSwitchError,
    saveRoomWorld,
    switchRoom,
  };
}

export function RoomSwitcherHUD({
  rooms,
  activeRoomId,
  switching,
  onSwitch,
}: {
  rooms: RoomWorldInfo[];
  activeRoomId: string;
  switching: boolean;
  onSwitch: (roomId: string) => void;
}) {
  return (
    <div className="room-switcher-hud">
      <span className="label">Rooms:</span>
      {rooms.map((room) => {
        const isActive = room.id === activeRoomId;
        const hasWorld = Boolean(room.worldId);
        return (
          <button
            key={room.id}
            className={`room-chip ${isActive ? "active" : ""} ${!hasWorld ? "empty" : ""}`}
            disabled={switching || !hasWorld}
            onClick={() => onSwitch(room.id)}
            title={hasWorld ? `Switch to ${room.name}` : `No world generated for ${room.name}`}
          >
            {room.name}
            {isActive && <span className="active-dot" />}
          </button>
        );
      })}
    </div>
  );
}
