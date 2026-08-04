import * as THREE from "three";
import type { PlacedModule, SceneSnapshot, QCMode, ToolState } from "./types";

/**
 * Single mutable state object for the entire application.
 * All modules import this object and read/write its properties.
 * Using an object (rather than individual exports) lets any module
 * mutate primitive fields like `activeQC` without needing re-export tricks.
 */
export const store = {
  // ── Scene Blocks ──────────────────────────────────────────────────────────
  placedBlocks:    [] as PlacedModule[],
  selectedBlocks:  new Set<THREE.Mesh>(),

  // ── Undo History ──────────────────────────────────────────────────────────
  history:         [] as SceneSnapshot[],

  // ── App Mode ──────────────────────────────────────────────────────────────
  activeQC:        "none" as QCMode,
  activeTool:      "translate" as ToolState,
  isPlacementMode: false,
  isPlanView:      false,

  // ── Input State ───────────────────────────────────────────────────────────
  isAltDown:       false,
  globalSnap:      0.5,

  // ── Drag / Pointer Tracking ───────────────────────────────────────────────
  dragStartX:      0,
  dragStartY:      0,
  dragStartTime:   0,
  clickedAxis:     null as string | null,

  // ── OSNAP Vertex Drag ─────────────────────────────────────────────────────
  isVertexDragging: false,
  snapStartVertex:  null as THREE.Vector3 | null,
  dragOffsets:      new Map<THREE.Mesh, THREE.Vector3>(),
};
