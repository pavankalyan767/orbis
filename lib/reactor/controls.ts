"use client";

/**
 * Adventure controls are held state, not per-frame input: call `hold` when an
 * input begins, `release`/`stop` when it ends. The SDK maintains the resend
 * cadence; we only send transitions.
 *
 * Mapping: WASD → translation, arrow keys → look, Space → Jump, Shift → Sprint.
 * Diagonal input composes into the SDK's own diagonal values (Front_Left, …).
 */
import { useEffect, useRef } from "react";
import type { AdventureCommand } from "@reactor-models/happy-oyster";

type Translation = NonNullable<AdventureCommand["translation"]>;
type Rotation = NonNullable<AdventureCommand["rotation"]>;

const KEY_TRANSLATION: Record<string, Translation> = {
  KeyW: "Front",
  KeyS: "Back",
  KeyA: "Left",
  KeyD: "Right",
};

const KEY_ROTATION: Record<string, Rotation> = {
  ArrowUp: "Mouse_Up",
  ArrowDown: "Mouse_Down",
  ArrowLeft: "Mouse_Left",
  ArrowRight: "Mouse_Right",
};

function isControlKey(code: string): boolean {
  return code in KEY_TRANSLATION || code in KEY_ROTATION || code === "Space" || code.startsWith("Shift");
}

/** Compose the held keys into one command; only active axes are included. */
function composeHeld(held: Set<string>): AdventureCommand {
  const front = held.has("KeyW");
  const back = held.has("KeyS");
  const left = held.has("KeyA");
  const right = held.has("KeyD");
  const translation: Translation =
    front && left
      ? "Front_Left"
      : front && right
        ? "Front_Right"
        : back && left
          ? "Back_Left"
          : back && right
            ? "Back_Right"
            : front
              ? "Front"
              : back
                ? "Back"
                : left
                  ? "Left"
                  : right
                    ? "Right"
                    : "None";

  const up = held.has("ArrowUp");
  const down = held.has("ArrowDown");
  const lookLeft = held.has("ArrowLeft");
  const lookRight = held.has("ArrowRight");
  const rotation: Rotation =
    up && lookLeft
      ? "Mouse_Up_Left"
      : up && lookRight
        ? "Mouse_Up_Right"
        : down && lookLeft
          ? "Mouse_Down_Left"
          : down && lookRight
            ? "Mouse_Down_Right"
            : up
              ? "Mouse_Up"
              : down
                ? "Mouse_Down"
                : lookLeft
                  ? "Mouse_Left"
                  : lookRight
                    ? "Mouse_Right"
                    : "None";

  const command: AdventureCommand = {};
  if (translation !== "None") command.translation = translation;
  if (rotation !== "None") command.rotation = rotation;
  return command;
}

export interface AdventureController {
  hold: (command: AdventureCommand) => Promise<void>;
  release: (axes: { translation?: true; rotation?: true; interaction?: true }) => Promise<void>;
  stop: () => Promise<void>;
  interact: (action: NonNullable<AdventureCommand["interaction"]>) => Promise<void>;
}

/**
 * Binds WASD / arrow-key / Space / Shift input to the world's held controls
 * while `enabled` (i.e. while the live stream accepts input). Releasing
 * window focus releases everything, so the avatar never runs away.
 */
export function useAdventureControls(controller: AdventureController, enabled: boolean) {
  const controllerRef = useRef(controller);
  controllerRef.current = controller;
  const heldRef = useRef(new Set<string>());

  useEffect(() => {
    if (!enabled) return;
    const held = heldRef.current;

    const sendHeld = () => {
      const { hold, stop } = controllerRef.current;
      if (held.size === 0) void stop();
      else void hold(composeHeld(held));
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || !isControlKey(event.code)) return;
      event.preventDefault();
      if (event.code === "Space") {
        void controllerRef.current.interact("Jump");
        return;
      }
      if (event.code.startsWith("Shift")) {
        void controllerRef.current.hold({ interaction: "Sprint" });
        return;
      }
      held.add(event.code);
      sendHeld();
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (!isControlKey(event.code)) return;
      if (event.code === "Space" || event.code.startsWith("Shift")) {
        void controllerRef.current.release({ interaction: true });
        return;
      }
      if (held.delete(event.code)) sendHeld();
    };

    const releaseAll = () => {
      held.clear();
      void controllerRef.current.stop();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", releaseAll);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", releaseAll);
      releaseAll();
    };
  }, [enabled]);
}
