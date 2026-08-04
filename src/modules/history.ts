import * as THREE from "three";
import { store } from "../store";
import { applyModuleStyle } from "./moduleStyle";

/** Callbacks required by undo() to avoid circular imports. */
export interface UndoCallbacks {
  scene: THREE.Scene;
  /** Called after selection is cleared (before blocks are restored). */
  onSelectionCleared: () => void;
  /** Called after all blocks are restored — refresh QC colours and cost UI. */
  onRestored: () => void;
}

/** Saves the current scene layout to the undo stack (max 10 entries). */
export function saveState(): void {
  if (store.history.length >= 10) store.history.shift();
  store.history.push({
    blocks: store.placedBlocks.map((b) => {
      const wPos  = new THREE.Vector3();
      const wQuat = new THREE.Quaternion();
      b.mesh.getWorldPosition(wPos);
      b.mesh.getWorldQuaternion(wQuat);
      return {
        id:      b.id,
        typeKey: b.typeKey,
        elecKey: b.elecKey,
        roofKey: b.roofKey,
        pos:     wPos,
        rot:     new THREE.Euler().setFromQuaternion(wQuat),
      };
    }),
  });
}

/** Restores the previous scene layout from the undo stack. */
export function undo(callbacks: UndoCallbacks): void {
  if (store.history.length === 0) return;
  const lastState = store.history.pop()!;

  // Remove all current blocks from the scene
  store.placedBlocks.forEach((b) => {
    callbacks.scene.remove(b.mesh);
    if (b.mesh.geometry) b.mesh.geometry.dispose();
    if (b.mesh.material) {
      if (Array.isArray(b.mesh.material)) b.mesh.material.forEach((m) => m.dispose());
      else (b.mesh.material as THREE.Material).dispose();
    }
  });
  store.placedBlocks.length = 0;
  callbacks.onSelectionCleared();

  // Rebuild from snapshot
  lastState.blocks.forEach((bData) => {
    const mesh = new THREE.Mesh();
    applyModuleStyle(mesh, bData.typeKey);
    mesh.position.copy(bData.pos);
    mesh.rotation.copy(bData.rot);
    mesh.castShadow    = true;
    mesh.receiveShadow = true;
    callbacks.scene.add(mesh);
    store.placedBlocks.push({
      id:      bData.id,
      typeKey: bData.typeKey,
      elecKey: bData.elecKey,
      roofKey: bData.roofKey,
      mesh,
    });
  });

  callbacks.onRestored();
}
