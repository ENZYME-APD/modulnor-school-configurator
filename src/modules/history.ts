import * as THREE from "three";
import { store } from "../store";
import type { SceneSnapshot } from "../types";
import { clearModules, createModule } from "./placement";

const MAX_HISTORY = 50;

/** Callbacks required by undo() to avoid circular imports. */
export interface UndoCallbacks {
  /** Clears the selection (returns grouped meshes to the scene). */
  onSelectionCleared: () => void;
  /** Called after all blocks are restored — refresh QC colours and cost UI. */
  onRestored: () => void;
}

function snapshot(): SceneSnapshot {
  return {
    blocks: store.placedBlocks.map((b) => {
      const wQuat = b.mesh.getWorldQuaternion(new THREE.Quaternion());
      return {
        id:      b.id,
        typeKey: b.typeKey,
        elecKey: b.elecKey,
        roofKey: b.roofKey,
        pos:     b.mesh.getWorldPosition(new THREE.Vector3()),
        rot:     new THREE.Euler().setFromQuaternion(wQuat),
      };
    }),
  };
}

/** Saves the current scene layout to the undo stack. */
export function saveState(): void {
  if (store.history.length >= MAX_HISTORY) store.history.shift();
  store.history.push(snapshot());
}

/** Restores the previous scene layout from the undo stack. */
export function undo(callbacks: UndoCallbacks): void {
  if (store.history.length === 0) return;
  const lastState = store.history.pop()!;

  // Clear the selection FIRST: multi-selected meshes live inside the transform
  // group, and removing them before they're returned to the scene left ghosts.
  callbacks.onSelectionCleared();
  clearModules();

  lastState.blocks.forEach((b) =>
    createModule({
      id: b.id, typeKey: b.typeKey, elecKey: b.elecKey, roofKey: b.roofKey,
      position: b.pos, rotation: b.rot,
    }),
  );

  callbacks.onRestored();
}
