import * as THREE from "three";
import { store } from "../store";
import type { PlacedModule } from "../types";
import { applyModuleStyle, disposeModuleMesh } from "./moduleStyle";

let _scene: THREE.Scene;

/** Must be called once with the main scene. */
export function initPlacement(scene: THREE.Scene): void {
  _scene = scene;
}

export interface ModuleSpec {
  id?: string;
  typeKey: string;
  elecKey?: string;
  roofKey?: string;
  position: THREE.Vector3;
  rotation: THREE.Euler | THREE.Quaternion;
}

/** Creates a module mesh, adds it to the scene and registers it in the store. */
export function createModule(spec: ModuleSpec): PlacedModule {
  const mesh = new THREE.Mesh();
  applyModuleStyle(mesh, spec.typeKey);
  mesh.position.copy(spec.position);
  if (spec.rotation instanceof THREE.Quaternion)
    mesh.quaternion.copy(spec.rotation);
  else mesh.rotation.copy(spec.rotation);
  _scene.add(mesh);

  const placed: PlacedModule = {
    id: spec.id ?? crypto.randomUUID(),
    typeKey: spec.typeKey,
    elecKey: spec.elecKey,
    roofKey: spec.roofKey,
    mesh,
  };
  store.placedBlocks.push(placed);
  return placed;
}

/** Looks up the placed module that owns `mesh`. */
export function findModule(mesh: THREE.Object3D): PlacedModule | undefined {
  return store.placedBlocks.find((b) => b.mesh === mesh);
}

/**
 * Duplicates the given meshes in world space, optionally offset.
 * Returns the new meshes (caller decides what to select).
 */
export function duplicateModules(
  meshes: Iterable<THREE.Mesh>,
  offset?: THREE.Vector3,
): THREE.Mesh[] {
  const created: THREE.Mesh[] = [];
  for (const mesh of meshes) {
    const src = findModule(mesh);
    if (!src) continue;
    const position = mesh.getWorldPosition(new THREE.Vector3());
    if (offset) position.add(offset);
    const placed = createModule({
      typeKey: src.typeKey,
      elecKey: src.elecKey,
      roofKey: src.roofKey,
      position,
      rotation: mesh.getWorldQuaternion(new THREE.Quaternion()),
    });
    created.push(placed.mesh);
  }
  return created;
}

/**
 * Removes modules from the scene and store. The selection must be cleared
 * first so meshes are back under the scene (not the multi-select group).
 */
export function removeModules(meshes: Iterable<THREE.Mesh>): void {
  for (const mesh of meshes) {
    mesh.removeFromParent();
    disposeModuleMesh(mesh);
    const idx = store.placedBlocks.findIndex((b) => b.mesh === mesh);
    if (idx !== -1) store.placedBlocks.splice(idx, 1);
  }
}

/** Removes every placed module. */
export function clearModules(): void {
  removeModules(store.placedBlocks.map((b) => b.mesh));
}
