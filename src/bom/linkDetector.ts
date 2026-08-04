import * as THREE from "three";
import type { PlacedModule } from "../types";
import { blueprints } from "../data/blueprints";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface LinkVisualization {
  center:     THREE.Vector3;
  size:       THREE.Vector3;
  isVertical: boolean;
}

export interface LinkResult {
  standardLinks:  number;
  panelLinks:     number;
  simpleLinks:    number;
  verticalLinks:  number;
  /** All detected links that should be rendered in QC Links mode. */
  visualizations: LinkVisualization[];
}

// ── Detector ──────────────────────────────────────────────────────────────────

/**
 * Detects and categorises adjacency links between all placed blocks.
 *
 * Previously this O(n²) loop was duplicated verbatim in both
 * `refreshQCColors()` and `updateCostUI()`. This single implementation
 * is now shared by both callers.
 */
export function detectLinks(allBlocks: PlacedModule[]): LinkResult {
  let standardLinks = 0, panelLinks = 0, simpleLinks = 0, verticalLinks = 0;
  const visualizations: LinkVisualization[] = [];

  for (let i = 0; i < allBlocks.length; i++) {
    for (let j = i + 1; j < allBlocks.length; j++) {
      const b1 = allBlocks[i];
      const b2 = allBlocks[j];

      const box1 = new THREE.Box3().setFromObject(b1.mesh);
      const box2 = new THREE.Box3().setFromObject(b2.mesh);
      box1.expandByScalar(0.05);

      if (!box1.intersectsBox(box2)) continue;

      const overlap = box1.clone().intersect(box2);
      const size    = new THREE.Vector3();
      overlap.getSize(size);
      const dy = Math.abs(b1.mesh.position.y - b2.mesh.position.y);

      // ── Vertical stacking link ────────────────────────────────────────────
      if (dy > 1.5 && size.x > 0.2 && size.z > 0.2) {
        verticalLinks++;
        const center = new THREE.Vector3();
        overlap.getCenter(center);
        visualizations.push({ center, size: size.clone(), isVertical: true });
        continue;
      }

      // ── Horizontal classroom link ─────────────────────────────────────────
      if (
        dy < 1.5 &&
        blueprints[b1.typeKey].group === "classroom" &&
        blueprints[b2.typeKey].group === "classroom"
      ) {
        const dir = b2.mesh
          .getWorldPosition(new THREE.Vector3())
          .sub(b1.mesh.getWorldPosition(new THREE.Vector3()));

        const localDir1 = dir
          .clone()
          .applyEuler(
            new THREE.Euler().setFromQuaternion(
              b1.mesh.getWorldQuaternion(new THREE.Quaternion()).invert(),
            ),
          );

        if (Math.abs(localDir1.z) > 1.5 && Math.abs(localDir1.x) < 5.0) {
          // Determine wall presence on each touching side
          const b1Side    = localDir1.z > 0 ? "right" : "left";
          const b1HasWall = blueprints[b1.typeKey].walls[b1Side];

          const localDir2 = dir
            .clone()
            .negate()
            .applyEuler(
              new THREE.Euler().setFromQuaternion(
                b2.mesh.getWorldQuaternion(new THREE.Quaternion()).invert(),
              ),
            );
          const b2Side    = localDir2.z > 0 ? "right" : "left";
          const b2HasWall = blueprints[b2.typeKey].walls[b2Side];

          const wallCount = (b1HasWall ? 1 : 0) + (b2HasWall ? 1 : 0);
          if (wallCount === 0)      standardLinks++;
          else if (wallCount === 1) panelLinks++;
          else                      simpleLinks++;

          // All horizontal links are visualised (colour is uniform red in QC)
          const center = new THREE.Vector3();
          overlap.getCenter(center);
          visualizations.push({ center, size: size.clone(), isVertical: false });
        }
      }
    }
  }

  return { standardLinks, panelLinks, simpleLinks, verticalLinks, visualizations };
}
