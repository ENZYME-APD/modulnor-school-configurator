import * as THREE from "three";
import type { PlacedModule } from "../types";
import { blueprints } from "../data/blueprints";
import { electricalKits } from "../data/electricalKits";
import { roofKits } from "../data/roofKits";

// The project layout format, shared by files, the cloud database, the browser
// app and the MCP server. Pure: no DOM and no scene.

/** One module as stored in a project (world-space centre and rotation, metres/radians, three.js Y-up). */
export interface SavedModule {
  id: string;
  typeKey: string;
  elecKey?: string;
  roofKey?: string;
  pos: { x: number; y: number; z: number };
  rot: { x: number; y: number; z: number };
}

/** Storey height of every module (m). Level n sits with its centre at n × height + height / 2. */
export const MODULE_HEIGHT = 3;

const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const isVec = (v: any): boolean =>
  !!v && isNum(v.x) && isNum(v.y) && isNum(v.z);

const newId = (): string => globalThis.crypto.randomUUID();

/**
 * Validates parsed layout JSON. Returns the usable modules plus a list of
 * problems; callers decide whether to accept a partial layout.
 */
export function parseLayout(data: unknown): {
  modules: SavedModule[];
  problems: string[];
} {
  if (!Array.isArray(data))
    return {
      modules: [],
      problems: ["Not a project layout (expected a list of modules)."],
    };

  const modules: SavedModule[] = [];
  const problems: string[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data.forEach((m: any, i) => {
    if (!m || !blueprints[m.typeKey]) {
      problems.push(`Module ${i + 1}: unknown type "${m?.typeKey}"`);
      return;
    }
    if (!isVec(m.pos) || !isVec(m.rot)) {
      problems.push(`Module ${i + 1}: missing or invalid position/rotation`);
      return;
    }
    const elecKey =
      m.elecKey && electricalKits[m.elecKey] ? m.elecKey : undefined;
    const roofKey = m.roofKey && roofKits[m.roofKey] ? m.roofKey : undefined;
    if (m.elecKey && !elecKey)
      problems.push(
        `Module ${i + 1}: unknown electrical kit "${m.elecKey}" dropped`,
      );
    if (m.roofKey && !roofKey)
      problems.push(`Module ${i + 1}: unknown roof kit "${m.roofKey}" dropped`);
    modules.push({
      id: typeof m.id === "string" && m.id ? m.id : newId(),
      typeKey: m.typeKey,
      elecKey,
      roofKey,
      pos: { x: m.pos.x, y: m.pos.y, z: m.pos.z },
      rot: { x: m.rot.x, y: m.rot.y, z: m.rot.z },
    });
  });
  return { modules, problems };
}

/** Serialises placed scene modules to the layout format (world-space transforms). */
export function toSavedModules(blocks: PlacedModule[]): SavedModule[] {
  return blocks.map((b) => {
    const p = b.mesh.getWorldPosition(new THREE.Vector3());
    const r = new THREE.Euler().setFromQuaternion(
      b.mesh.getWorldQuaternion(new THREE.Quaternion()),
    );
    const clean = (v: number) => Math.round(v * 1e6) / 1e6;
    return {
      id: b.id,
      typeKey: b.typeKey,
      ...(b.elecKey ? { elecKey: b.elecKey } : {}),
      ...(b.roofKey ? { roofKey: b.roofKey } : {}),
      pos: { x: clean(p.x), y: clean(p.y), z: clean(p.z) },
      rot: { x: clean(r.x), y: clean(r.y), z: clean(r.z) },
    };
  });
}

/**
 * Builds scene-free module instances (shared blueprint geometry, no material)
 * so the same BOM / link / QC code can run on the server.
 */
export function toHeadlessModules(layout: SavedModule[]): PlacedModule[] {
  return layout.map((m) => {
    const mesh = new THREE.Mesh(blueprints[m.typeKey].geometry);
    mesh.position.set(m.pos.x, m.pos.y, m.pos.z);
    mesh.rotation.set(m.rot.x, m.rot.y, m.rot.z);
    mesh.updateMatrixWorld(true);
    return {
      id: m.id,
      typeKey: m.typeKey,
      elecKey: m.elecKey,
      roofKey: m.roofKey,
      mesh,
    };
  });
}

/** Rotation about the vertical axis in degrees, 0–360, counter-clockwise seen from above. */
export function yawDegrees(rot: SavedModule["rot"]): number {
  const q = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(rot.x, rot.y, rot.z),
  );
  const v = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  const deg = THREE.MathUtils.radToDeg(Math.atan2(-v.z, v.x));
  const norm = ((deg % 360) + 360) % 360;
  return (Math.round(norm * 1000) / 1000) % 360;
}

/** Storey index (0 = ground) from a module centre height. */
export const levelOf = (y: number): number =>
  Math.round((y - MODULE_HEIGHT / 2) / MODULE_HEIGHT);

/** Centre height for a storey index. */
export const yForLevel = (level: number): number =>
  level * MODULE_HEIGHT + MODULE_HEIGHT / 2;

/** Plan footprint (x by z extent, m) of a module type at a yaw angle. */
export function footprint(
  typeKey: string,
  yawDeg: number,
): { x: number; z: number } {
  const g = blueprints[typeKey].geometry.parameters;
  const r = THREE.MathUtils.degToRad(yawDeg);
  const c = Math.abs(Math.cos(r));
  const s = Math.abs(Math.sin(r));
  const round = (v: number) => Math.round(v * 1000) / 1000;
  return {
    x: round(g.width * c + g.depth * s),
    z: round(g.width * s + g.depth * c),
  };
}
