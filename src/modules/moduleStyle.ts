import * as THREE from "three";
import { blueprints } from "../data/blueprints";

// Blueprint geometries are SHARED by every placed module of the same type, so
// they must never be disposed per-mesh. Outline edges are cached per type for
// the same reason (EdgesGeometry is expensive to build).

const edgesCache = new Map<string, THREE.EdgesGeometry>();
const outlineMaterial = new THREE.LineBasicMaterial({
  color: 0x1a1a1a,
  transparent: true,
  opacity: 0.55,
});

/** Cached edge geometry for a blueprint type (shared — never dispose). */
export function getBlueprintEdges(typeKey: string): THREE.EdgesGeometry {
  let edges = edgesCache.get(typeKey);
  if (!edges) {
    edges = new THREE.EdgesGeometry(blueprints[typeKey].geometry);
    edgesCache.set(typeKey, edges);
  }
  return edges;
}

/** Creates the default PBR material for a blueprint type. */
export function createBaseMaterial(
  typeKey: string,
): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: blueprints[typeKey].color,
    roughness: 0.65,
    metalness: 0.0,
    envMapIntensity: 0.9,
  });
}

/**
 * The mesh's own (per-instance) material, kept in userData so QC modes can
 * temporarily swap in shared material arrays and restore it afterwards.
 */
export function getBaseMaterial(mesh: THREE.Mesh): THREE.MeshStandardMaterial {
  return mesh.userData.baseMaterial as THREE.MeshStandardMaterial;
}

/** Disposes only what this mesh owns (its base material), not shared resources. */
export function disposeModuleMesh(mesh: THREE.Mesh): void {
  const base = mesh.userData.baseMaterial as THREE.Material | undefined;
  base?.dispose();
  mesh.userData.baseMaterial = undefined;
}

/**
 * Applies geometry, material and outline for a blueprint type to `mesh`.
 * Safe to call repeatedly (e.g. when swapping module type).
 */
export function applyModuleStyle(mesh: THREE.Mesh, typeKey: string): void {
  const bp = blueprints[typeKey];
  disposeModuleMesh(mesh);

  const material = createBaseMaterial(typeKey);
  mesh.userData.baseMaterial = material;
  mesh.userData.typeKey = typeKey;
  mesh.geometry = bp.geometry;
  mesh.material = material;
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  // Replace any outline from a previous type (geometry/material are shared)
  mesh.children.slice().forEach((c) => {
    if (c.userData.isBlackOutline) mesh.remove(c);
  });
  const line = new THREE.LineSegments(
    getBlueprintEdges(typeKey),
    outlineMaterial,
  );
  line.userData.isBlackOutline = true;
  mesh.add(line);
}
