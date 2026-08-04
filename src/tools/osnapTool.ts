import * as THREE from "three";
import type { SnapType } from "../types";
import { store } from "../store";

// ── OSNAP Settings ────────────────────────────────────────────────────────────

/** Active OSNAP modes. Mutated by checkbox event listeners in main.ts. */
export const osnap = {
  end:    true,
  mid:    true,
  int:    true,
  perp:   true,
  near:   true,
  center: false,
};

// ── Edge Extraction ───────────────────────────────────────────────────────────

/**
 * Returns the world-space edges of a mesh by reading its black outline
 * LineSegments child geometry.
 */
export function getMeshEdges(mesh: THREE.Mesh): THREE.Line3[] {
  const edges: THREE.Line3[] = [];
  const ls = mesh.children.find((c) => c.userData.isBlackOutline) as THREE.LineSegments | undefined;
  if (!ls) return edges;

  const pos = ls.geometry.attributes.position;
  for (let i = 0; i < pos.count; i += 2) {
    const v1 = new THREE.Vector3().fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
    const v2 = new THREE.Vector3().fromBufferAttribute(pos, i + 1).applyMatrix4(mesh.matrixWorld);
    edges.push(new THREE.Line3(v1, v2));
  }
  return edges;
}

// ── Snap Point Resolver ────────────────────────────────────────────────────────

/** Finds the best snap point on `hoveredMesh` closest to `hitPoint`. */
export function getSnapPoint(
  hitPoint:    THREE.Vector3,
  hoveredMesh: THREE.Mesh,
): { point: THREE.Vector3; type: SnapType } {
  let bestDist  = Infinity;
  let bestPoint = hitPoint.clone();
  let bestType: SnapType = "none";

  const check = (pt: THREE.Vector3, type: SnapType) => {
    const d = hitPoint.distanceTo(pt);
    if (d < bestDist) { bestDist = d; bestPoint = pt.clone(); bestType = type; }
  };

  const edges = getMeshEdges(hoveredMesh);

  edges.forEach((edge) => {
    if (osnap.end)  { check(edge.start, "end"); check(edge.end, "end"); }
    if (osnap.mid)    check(edge.getCenter(new THREE.Vector3()), "mid");
    if (osnap.near) {
      const pt = new THREE.Vector3();
      edge.closestPointToPoint(hitPoint, true, pt);
      check(pt, "near");
    }
    if (osnap.perp && store.isVertexDragging && store.snapStartVertex) {
      const pt = new THREE.Vector3();
      edge.closestPointToPoint(store.snapStartVertex, true, pt);
      if (pt.distanceTo(edge.start) > 0.01 && pt.distanceTo(edge.end) > 0.01)
        check(pt, "perp");
    }
  });

  if (osnap.center) {
    const center = new THREE.Vector3();
    hoveredMesh.getWorldPosition(center);
    check(center, "center");
  }

  if (osnap.int) {
    store.placedBlocks
      .filter((b) => b.mesh !== hoveredMesh && !store.selectedBlocks.has(b.mesh))
      .forEach((target) => {
        const targetEdges = getMeshEdges(target.mesh);
        edges.forEach((e1) => {
          targetEdges.forEach((e2) => {
            const [p1, p2, p3, p4] = [e1.start, e1.end, e2.start, e2.end];
            const d = (p2.x - p1.x) * (p4.z - p3.z) - (p2.z - p1.z) * (p4.x - p3.x);
            if (Math.abs(d) > 0.0001) {
              const u = ((p3.x - p1.x) * (p4.z - p3.z) - (p3.z - p1.z) * (p4.x - p3.x)) / d;
              const v = ((p3.x - p1.x) * (p2.z - p1.z) - (p3.z - p1.z) * (p2.x - p1.x)) / d;
              if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
                const pt1 = p1.clone().lerp(p2, u);
                const pt2 = p3.clone().lerp(p4, v);
                if (Math.abs(pt1.y - pt2.y) < 0.1) check(pt1, "int");
              }
            }
          });
        });
      });
  }

  return bestDist > 1.5 ? { point: hitPoint, type: "none" } : { point: bestPoint, type: bestType };
}

// ── Snap Marker Colour ─────────────────────────────────────────────────────────

/** Colour palette for each snap type indicator dot. */
const SNAP_COLORS: Record<SnapType, number> = {
  end:    0xe74c3c,
  mid:    0xf1c40f,
  near:   0xffffff,
  center: 0x9b59b6,
  int:    0x00ffff,
  perp:   0xe67e22,
  none:   0x333333,
};

/**
 * Applies the correct colour to the snap marker mesh.
 * Previously duplicated verbatim twice in main.ts — now a single source of truth.
 */
export function applySnapMarkerColor(snapMarker: THREE.Mesh, type: SnapType): void {
  (snapMarker.material as THREE.MeshBasicMaterial).color.setHex(SNAP_COLORS[type]);
}

// ── Raycaster OSNAP ───────────────────────────────────────────────────────────

/**
 * Runs OSNAP against a set of valid meshes using the given raycaster.
 * Checks outlines first (for precise edge snapping) then mesh surfaces.
 */
export function performOsnap(
  raycaster:       THREE.Raycaster,
  validMeshes:     THREE.Mesh[],
  activeCamera:    THREE.Camera,
  isPlanView:      boolean,
  cameraOrtho:     THREE.OrthographicCamera,
  orbitTarget:     THREE.Vector3,
): { point: THREE.Vector3; type: SnapType } | null {
  const dist = activeCamera.position.distanceTo(orbitTarget);
  (raycaster.params as any).Line = {
    threshold: isPlanView ? (cameraOrtho.top - cameraOrtho.bottom) * 0.02 : dist * 0.03,
  };

  const outlines = validMeshes
    .map((m) => m.children.find((c) => c.userData.isBlackOutline))
    .filter(Boolean) as THREE.Object3D[];

  const lineHits = raycaster.intersectObjects(outlines, false);
  if (lineHits.length > 0) {
    const parentMesh = lineHits[0].object.parent as THREE.Mesh;
    return getSnapPoint(lineHits[0].point, parentMesh);
  }

  const meshHits = raycaster.intersectObjects(validMeshes, false);
  if (meshHits.length > 0)
    return getSnapPoint(meshHits[0].point, meshHits[0].object as THREE.Mesh);

  return null;
}
