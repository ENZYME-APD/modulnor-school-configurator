import * as THREE from "three";
import type { PlacedModule } from "../types";
import { store } from "../store";
import { blueprints } from "../data/blueprints";
import { electricalKits } from "../data/electricalKits";
import { roofKits } from "../data/roofKits";
import { detectLinks } from "../bom/linkDetector";

// ── Materials shared across all QC orient renders ─────────────────────────────

const orientMats = {
  transparent: new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, depthWrite: false }),
  wall:        new THREE.MeshStandardMaterial({ color: 0x95a5a6, transparent: false, opacity: 1.0 }),
  facade:      new THREE.MeshStandardMaterial({ color: 0x0984e3, transparent: true,  opacity: 0.85 }),
  corridor:    new THREE.MeshStandardMaterial({ color: 0xe17055, transparent: true,  opacity: 0.85 }),
  floor:       new THREE.MeshStandardMaterial({ color: 0x2d3436, transparent: true,  opacity: 0.4, side: THREE.DoubleSide }),
};

// ── Module-level scene refs (set via initQCManager) ───────────────────────────

let qcLinksGroup: THREE.Group;

/** Must be called once after the scene is created. */
export function initQCManager(scene: THREE.Scene): void {
  qcLinksGroup = new THREE.Group();
  scene.add(qcLinksGroup);
}

// ── Dynamic Wall Detection ────────────────────────────────────────────────────

/**
 * Returns which faces of a corridor block are exposed (not touching another block).
 * Used both for QC orientation colouring and for corridor wall BOM counting.
 */
export function getDynamicWalls(
  b1:        PlacedModule,
  allBlocks: PlacedModule[],
): { posX: boolean; negX: boolean; posZ: boolean; negZ: boolean } {
  const dynWalls = { posX: true, negX: true, posZ: true, negZ: true };
  const box1 = new THREE.Box3().setFromObject(b1.mesh);
  box1.expandByScalar(0.1);

  allBlocks.forEach((b2) => {
    if (b1 === b2) return;
    const box2 = new THREE.Box3().setFromObject(b2.mesh);
    if (!box1.intersectsBox(box2)) return;

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
      if (localDir.x >  1.0) dynWalls.posX = false;
      if (localDir.x < -1.0) dynWalls.negX = false;
    } else {
      if (localDir.z >  1.0) dynWalls.posZ = false;
      if (localDir.z < -1.0) dynWalls.negZ = false;
    }
  });

  return dynWalls;
}

// ── QC Colour Refresh ─────────────────────────────────────────────────────────

/** Clears and redraws all block colours according to the current QC mode. */
export function refreshQCColors(): void {
  // Update button highlight states
  (["elec", "roof", "orient", "links"] as const).forEach((mode) => {
    const el = document.getElementById(`qc-${mode}-btn`);
    if (el) el.style.background = store.activeQC === mode ? "#f39c12" : "";
  });

  // Clear previous link visualizations
  while (qcLinksGroup.children.length > 0) {
    const child = qcLinksGroup.children[0] as THREE.Mesh;
    qcLinksGroup.remove(child);
    child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
      else (child.material as THREE.Material).dispose();
    }
  }

  store.placedBlocks.forEach((b) => {
    const bp = blueprints[b.typeKey];

    // ── Orient mode: per-face material ───────────────────────────────────────
    if (store.activeQC === "orient") {
      if (bp.group === "corridor" && b.typeKey === "CorridorStructure") {
        const dw = getDynamicWalls(b, store.placedBlocks);
        b.mesh.material = [
          dw.posX ? orientMats.wall : orientMats.transparent,
          dw.negX ? orientMats.wall : orientMats.transparent,
          orientMats.floor,
          orientMats.floor,
          dw.posZ ? orientMats.wall : orientMats.transparent,
          dw.negZ ? orientMats.wall : orientMats.transparent,
        ];
      } else if (bp.group === "corridor" && b.typeKey === "CorridorFloor") {
        b.mesh.material = [
          orientMats.transparent, orientMats.transparent,
          orientMats.transparent, orientMats.floor,
          orientMats.transparent, orientMats.transparent,
        ];
      } else {
        b.mesh.material = [
          orientMats.corridor, orientMats.facade,
          orientMats.floor,    orientMats.floor,
          bp.walls.right ? orientMats.wall : orientMats.transparent,
          bp.walls.left  ? orientMats.wall : orientMats.transparent,
        ];
      }
      return;
    }

    // ── Reset to single material if switching away from orient ────────────────
    if (Array.isArray(b.mesh.material)) {
      b.mesh.material = new THREE.MeshStandardMaterial({
        color: bp.color, roughness: 0.7, metalness: 0.1, transparent: true, opacity: 0.9,
      });
    }

    const mat = b.mesh.material as THREE.MeshStandardMaterial;

    // ── Elec mode ────────────────────────────────────────────────────────────
    if (store.activeQC === "elec") {
      if (b.elecKey && electricalKits[b.elecKey]) {
        mat.color.set(electricalKits[b.elecKey].color);
        mat.transparent = false; mat.opacity = 1.0; mat.depthWrite = true;
      } else {
        mat.color.setHex(0xffffff);
        mat.transparent = true; mat.opacity = 0.5; mat.depthWrite = false;
      }

    // ── Roof mode ─────────────────────────────────────────────────────────────
    } else if (store.activeQC === "roof") {
      if (b.roofKey && roofKits[b.roofKey]) {
        mat.color.set(roofKits[b.roofKey].color);
        mat.transparent = false; mat.opacity = 1.0; mat.depthWrite = true;
      } else {
        mat.color.setHex(0xffffff);
        mat.transparent = true; mat.opacity = 0.5; mat.depthWrite = false;
      }

    // ── Links mode (fade blocks) ──────────────────────────────────────────────
    } else if (store.activeQC === "links") {
      mat.color.set(bp.color);
      mat.transparent = true; mat.opacity = 0.25; mat.depthWrite = false;

    // ── Default / no QC ───────────────────────────────────────────────────────
    } else {
      mat.color.set(bp.color);
      mat.transparent = true; mat.opacity = 0.9; mat.depthWrite = true;
    }

    mat.needsUpdate = true;
  });

  // ── Draw link visualizations ──────────────────────────────────────────────
  if (store.activeQC === "links") {
    const { visualizations } = detectLinks(store.placedBlocks);
    visualizations.forEach(({ center, size, isVertical }) => {
      const color = isVertical ? 0x3498db : 0xff0000;
      const geom  = new THREE.BoxGeometry(
        Math.max(size.x, 0.05),
        Math.max(size.y, 0.05),
        Math.max(size.z, 0.05),
      );

      const fillMesh = new THREE.Mesh(
        geom,
        new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.6 }),
      );
      fillMesh.position.copy(center);
      qcLinksGroup.add(fillMesh);

      const edgeLines = new THREE.LineSegments(
        new THREE.EdgesGeometry(geom),
        new THREE.LineBasicMaterial({ color, depthTest: false }),
      );
      edgeLines.position.copy(center);
      qcLinksGroup.add(edgeLines);
    });
  }
}
