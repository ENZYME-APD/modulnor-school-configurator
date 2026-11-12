import { blueprints } from "../data/blueprints";
import { MODULE_HEIGHT, levelOf, yawDegrees, type SavedModule } from "./layout";

// Archicad placement data for the Tapir hotlink script
// (CreateHotlinkNodes + CreateHotlinkInstances). Pure.
//
// three.js (app) is Y-up with +Z towards the viewer (south in plan).
// Archicad is Z-up with +Y north:  AC.x = x,  AC.y = −z,  AC.z = y.
// Rotation about the vertical axis is counter-clockwise from above in both,
// so the angle carries over unchanged.

export interface ArchicadPlacement {
  id: string;
  type_key: string;
  /** Hotlink file name convention: one .mod per module type, named after the type key. */
  hotlink: string;
  storey: number;
  /** Module centre at floor level, Archicad coordinates (m). */
  origin: { x: number; y: number; z: number };
  /** Counter-clockwise from above. */
  rotation_deg: number;
  rotation_rad: number;
  size: { length: number; width: number; height: number };
  electrical_kit?: string;
  roof_kit?: string;
}

export function toArchicadPlacements(
  layout: SavedModule[],
): ArchicadPlacement[] {
  const r = (v: number) => Math.round(v * 10000) / 10000;
  return layout.map((m) => {
    const g = blueprints[m.typeKey].geometry.parameters;
    const yaw = yawDegrees(m.rot);
    return {
      id: m.id,
      type_key: m.typeKey,
      hotlink: `${m.typeKey}.mod`,
      storey: levelOf(m.pos.y),
      origin: { x: r(m.pos.x), y: r(-m.pos.z), z: r(m.pos.y - g.height / 2) },
      rotation_deg: r(yaw),
      rotation_rad: r((yaw * Math.PI) / 180),
      size: { length: g.width, width: g.depth, height: g.height },
      ...(m.elecKey ? { electrical_kit: m.elecKey } : {}),
      ...(m.roofKey ? { roof_kit: m.roofKey } : {}),
    };
  });
}

export const ARCHICAD_NOTES = [
  "Coordinates are metres. Archicad axes: x east, y north, z up (converted from the app: AC.x = x, AC.y = −z, AC.z = y).",
  "origin is the module's centre at its floor level; hotlink files must use the same origin, or add the offset in the script.",
  `storey is the floor index (0 = ground); each storey is ${MODULE_HEIGHT} m.`,
  "rotation is about the vertical axis, counter-clockwise seen from above — pass rotation_rad to Tapir CreateHotlinkInstances.rotationAngle.",
  "hotlink assumes one file per module type named <type_key>.mod; map them to your real hotlink paths in the script.",
  "Store id on each placed hotlink (element ID or a property) so re-runs update instances instead of duplicating them.",
];
