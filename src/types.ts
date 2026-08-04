import * as THREE from "three";

// ── Module Blueprint ─────────────────────────────────────────────────────────

export interface BlueprintData {
  menuGroup: string;
  name: string;
  desc: string;
  cost: number;
  color: string;
  group: string;
  walls: { left: boolean; right: boolean };
  geometry: THREE.BoxGeometry;
}

// ── Placed Module (scene instance) ──────────────────────────────────────────

export interface PlacedModule {
  id: string;
  typeKey: string;
  mesh: THREE.Mesh;
  elecKey?: string;
  roofKey?: string;
}

// ── Undo History ─────────────────────────────────────────────────────────────

export interface SceneSnapshot {
  blocks: {
    id: string;
    typeKey: string;
    elecKey?: string;
    roofKey?: string;
    pos: THREE.Vector3;
    rot: THREE.Euler;
  }[];
}

// ── App Mode Enumerations ─────────────────────────────────────────────────────

export type QCMode = "none" | "elec" | "links" | "roof" | "orient";
export type ToolState = "translate" | "rotate" | "osnap";
export type SnapType = "end" | "mid" | "near" | "center" | "int" | "perp" | "none";
