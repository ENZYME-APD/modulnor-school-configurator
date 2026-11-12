import * as THREE from "three";
import type { PlacedModule } from "../types";
import { blueprints } from "../data/blueprints";
import { computeModuleBoxes } from "../bom/linkDetector";
import { MODULE_HEIGHT, levelOf, yawDegrees, yForLevel } from "./layout";

// Layout checks used by the MCP server (and available to the app). Pure.

export interface LayoutIssue {
  severity: "error" | "warning" | "info";
  code:
    | "overlap"
    | "floating"
    | "off_level"
    | "not_orthogonal"
    | "no_roof"
    | "no_electrical"
    | "roof_not_on_top";
  message: string;
  module_ids: string[];
}

const EPS = 0.05;

export function checkLayout(blocks: PlacedModule[]): LayoutIssue[] {
  const issues: LayoutIssue[] = [];
  const boxes = computeModuleBoxes(blocks);
  const size = new THREE.Vector3();

  // Overlaps: interpenetration beyond a small tolerance (touching faces are fine)
  for (let i = 0; i < blocks.length; i++) {
    for (let j = i + 1; j < blocks.length; j++) {
      const a = boxes.get(blocks[i])!;
      const b = boxes.get(blocks[j])!;
      if (!a.intersectsBox(b)) continue;
      a.clone().intersect(b).getSize(size);
      if (size.x > EPS && size.y > EPS && size.z > EPS) {
        issues.push({
          severity: "error",
          code: "overlap",
          message: `${blocks[i].typeKey} and ${blocks[j].typeKey} overlap by ${size.x.toFixed(2)} × ${size.z.toFixed(2)} m in plan.`,
          module_ids: [blocks[i].id, blocks[j].id],
        });
      }
    }
  }

  const supports = (upper: PlacedModule): boolean => {
    const u = boxes.get(upper)!;
    return blocks.some((other) => {
      if (other === upper) return false;
      const o = boxes.get(other)!;
      if (Math.abs(o.max.y - u.min.y) > 0.1) return false;
      const ox = Math.min(u.max.x, o.max.x) - Math.max(u.min.x, o.min.x);
      const oz = Math.min(u.max.z, o.max.z) - Math.max(u.min.z, o.min.z);
      return ox > 0.2 && oz > 0.2;
    });
  };
  const hasAbove = (lower: PlacedModule): boolean => {
    const l = boxes.get(lower)!;
    return blocks.some((other) => {
      if (other === lower) return false;
      const o = boxes.get(other)!;
      if (Math.abs(o.min.y - l.max.y) > 0.1) return false;
      const ox = Math.min(l.max.x, o.max.x) - Math.max(l.min.x, o.min.x);
      const oz = Math.min(l.max.z, o.max.z) - Math.max(l.min.z, o.min.z);
      return ox > 0.2 && oz > 0.2;
    });
  };

  for (const b of blocks) {
    const box = boxes.get(b)!;
    const y = b.mesh.position.y;
    const level = levelOf(y);
    if (Math.abs(y - yForLevel(level)) > 0.01) {
      issues.push({
        severity: "warning",
        code: "off_level",
        message: `${b.typeKey} sits at height ${box.min.y.toFixed(2)} m, not on a storey (multiples of ${MODULE_HEIGHT} m).`,
        module_ids: [b.id],
      });
    }
    if (box.min.y > EPS && !supports(b)) {
      issues.push({
        severity: "error",
        code: "floating",
        message: `${b.typeKey} on level ${level} has no module below it.`,
        module_ids: [b.id],
      });
    }
    const yaw = yawDegrees({
      x: b.mesh.rotation.x,
      y: b.mesh.rotation.y,
      z: b.mesh.rotation.z,
    });
    if (Math.abs(yaw / 90 - Math.round(yaw / 90)) > 0.001) {
      issues.push({
        severity: "warning",
        code: "not_orthogonal",
        message: `${b.typeKey} is rotated ${yaw}°, not a multiple of 90°; links and walls are only detected reliably at 90° steps.`,
        module_ids: [b.id],
      });
    }
    const top = !hasAbove(b);
    if (top && !b.roofKey) {
      issues.push({
        severity: "warning",
        code: "no_roof",
        message: `${b.typeKey} is on top but has no roof kit.`,
        module_ids: [b.id],
      });
    }
    if (!top && b.roofKey) {
      issues.push({
        severity: "warning",
        code: "roof_not_on_top",
        message: `${b.typeKey} has a roof kit but another module sits on it.`,
        module_ids: [b.id],
      });
    }
    if (blueprints[b.typeKey].group === "classroom" && !b.elecKey) {
      issues.push({
        severity: "info",
        code: "no_electrical",
        message: `${b.typeKey} has no electrical kit.`,
        module_ids: [b.id],
      });
    }
  }
  return issues;
}

/** Plan and height extents of the whole layout (m). */
export function layoutBounds(blocks: PlacedModule[]) {
  if (blocks.length === 0) return null;
  const box = new THREE.Box3();
  computeModuleBoxes(blocks).forEach((b) => box.union(b));
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return {
    min: { x: r(box.min.x), y: r(box.min.y), z: r(box.min.z) },
    max: { x: r(box.max.x), y: r(box.max.y), z: r(box.max.z) },
    size: {
      x: r(box.max.x - box.min.x),
      y: r(box.max.y - box.min.y),
      z: r(box.max.z - box.min.z),
    },
    levels: Math.round((box.max.y - Math.max(0, box.min.y)) / MODULE_HEIGHT),
  };
}
