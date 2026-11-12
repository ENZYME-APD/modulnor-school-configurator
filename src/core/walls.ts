import * as THREE from "three";
import type { PlacedModule } from "../types";
import { computeModuleBoxes } from "../bom/linkDetector";

// Pure geometry (no DOM, no scene): shared by the browser app and the MCP server.

// ── Dynamic Wall Detection ────────────────────────────────────────────────────

/**
 * Returns which faces of a corridor block are exposed (not touching another block).
 * Used both for QC orientation colouring and for corridor wall BOM counting.
 */
export function getDynamicWalls(
  b1: PlacedModule,
  allBlocks: PlacedModule[],
  boxes: Map<PlacedModule, THREE.Box3> = computeModuleBoxes(allBlocks),
): { posX: boolean; negX: boolean; posZ: boolean; negZ: boolean } {
  const dynWalls = { posX: true, negX: true, posZ: true, negZ: true };
  const box1 = boxes.get(b1)!.clone().expandByScalar(0.1);

  allBlocks.forEach((b2) => {
    if (b1 === b2) return;
    if (!box1.intersectsBox(boxes.get(b2)!)) return;

    const dy = Math.abs(b1.mesh.position.y - b2.mesh.position.y);
    if (dy >= 1.5) return;

    const dir = b2.mesh
      .getWorldPosition(new THREE.Vector3())
      .sub(b1.mesh.getWorldPosition(new THREE.Vector3()));
    const localDir = dir
      .clone()
      .applyEuler(
        new THREE.Euler().setFromQuaternion(
          b1.mesh.getWorldQuaternion(new THREE.Quaternion()).invert(),
        ),
      );

    if (Math.abs(localDir.x) > Math.abs(localDir.z)) {
      if (localDir.x > 1.0) dynWalls.posX = false;
      if (localDir.x < -1.0) dynWalls.negX = false;
    } else {
      if (localDir.z > 1.0) dynWalls.posZ = false;
      if (localDir.z < -1.0) dynWalls.negZ = false;
    }
  });

  return dynWalls;
}
