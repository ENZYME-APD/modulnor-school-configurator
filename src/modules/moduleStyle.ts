import * as THREE from "three";
import { blueprints } from "../data/blueprints";

/** Disposes a mesh's geometry and material(s) without removing it from scene. */
function disposeMesh(mesh: THREE.Mesh): void {
  if (mesh.geometry) mesh.geometry.dispose();
  if (mesh.material) {
    if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose());
    else (mesh.material as THREE.Material).dispose();
  }
}

/**
 * Applies the correct geometry, material, and black edge outline to a mesh
 * based on a blueprint type key. Disposes any previous geometry/material first.
 */
export function applyModuleStyle(mesh: THREE.Mesh, typeKey: string): void {
  const bp = blueprints[typeKey];
  disposeMesh(mesh);

  mesh.geometry = bp.geometry;
  mesh.material = new THREE.MeshStandardMaterial({
    color:       bp.color,
    roughness:   0.7,
    metalness:   0.1,
    transparent: true,
    opacity:     0.9,
  });

  // Remove stale outline from a previous style
  mesh.children.slice().forEach((c) => {
    if (!c.userData.isBlackOutline) return;
    mesh.remove(c);
    (c as THREE.LineSegments).geometry.dispose();
    const mat = (c as THREE.LineSegments).material;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else (mat as THREE.Material).dispose();
  });

  // Add fresh black wireframe outline
  const edges = new THREE.EdgesGeometry(bp.geometry);
  const line  = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000 }));
  line.userData.isBlackOutline = true;
  mesh.add(line);
}
