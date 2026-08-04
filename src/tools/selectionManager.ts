import * as THREE from "three";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { store } from "../store";

// ── Visual state ──────────────────────────────────────────────────────────────

const selectionOutlines = new Map<THREE.Mesh, THREE.LineSegments>();
const outlineMaterial   = new THREE.LineBasicMaterial({
  color: 0x2ecc71, depthTest: false, transparent: true,
});

// ── Scene references (initialised via initSelectionManager) ──────────────────

let _scene:             THREE.Scene;
let _transformControls: TransformControls;
let _transformGroup:    THREE.Group;

/** Must be called once with the scene objects created in main.ts. */
export function initSelectionManager(deps: {
  scene:             THREE.Scene;
  transformControls: TransformControls;
  transformGroup:    THREE.Group;
}): void {
  _scene             = deps.scene;
  _transformControls = deps.transformControls;
  _transformGroup    = deps.transformGroup;
}

// ── Selection Logic ───────────────────────────────────────────────────────────

/**
 * Adds or removes `mesh` from the selection set, updates emissive highlights,
 * draws selection outlines, and re-attaches the transform gizmo.
 *
 * @param mesh  The mesh to toggle/set, or `null` to clear the selection.
 * @param multi `true` for shift/meta multi-select; `false` clears first.
 */
export function updateSelection(mesh: THREE.Mesh | null, multi: boolean): void {
  // Return any group-children back to the scene before clearing the set
  store.selectedBlocks.forEach((b) => _scene.attach(b));

  if (!multi) store.selectedBlocks.clear();
  if (mesh) {
    if (multi && store.selectedBlocks.has(mesh)) store.selectedBlocks.delete(mesh);
    else store.selectedBlocks.add(mesh);
  }

  // Remove old outlines
  selectionOutlines.forEach((line, m) => m.remove(line));
  selectionOutlines.clear();

  // Apply emissive + new outlines
  store.placedBlocks.forEach((b) => {
    const isSelected = store.selectedBlocks.has(b.mesh);

    if (store.activeQC === "none" && !Array.isArray(b.mesh.material)) {
      (b.mesh.material as THREE.MeshStandardMaterial).emissive.setHex(
        isSelected ? 0x222222 : 0x000000,
      );
    }

    if (isSelected) {
      const edges = new THREE.EdgesGeometry(b.mesh.geometry);
      const line  = new THREE.LineSegments(edges, outlineMaterial);
      b.mesh.add(line);
      selectionOutlines.set(b.mesh, line);
    }
  });

  // Re-attach transform gizmo
  if (store.activeTool !== "osnap") {
    if (store.selectedBlocks.size === 0) {
      _transformControls.detach();
    } else if (store.selectedBlocks.size === 1) {
      _transformControls.attach(Array.from(store.selectedBlocks)[0]);
    } else {
      // Multiple: move gizmo to centroid and group-attach all meshes
      const center = new THREE.Vector3();
      store.selectedBlocks.forEach((b) => center.add(b.position));
      center.divideScalar(store.selectedBlocks.size);
      _transformGroup.position.copy(center);
      _transformGroup.rotation.set(0, 0, 0);
      store.selectedBlocks.forEach((b) => _transformGroup.attach(b));
      _transformControls.attach(_transformGroup);
    }
  } else {
    _transformControls.detach();
  }
}
