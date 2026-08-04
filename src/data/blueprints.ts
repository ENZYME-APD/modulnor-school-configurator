import * as THREE from "three";
import type { BlueprintData } from "../types";

/**
 * Master catalogue of all placeable module types.
 * Geometry instances are shared across all placed blocks of the same type.
 */
export const blueprints: Record<string, BlueprintData> = {
  // ── Type A (Left End) ────────────────────────────────────────────────────
  A1:    { menuGroup: "Type A (Left End)", name: "A1",    desc: "3 Walls + Ext Back Window",               cost: 10, color: "#e74c3c", group: "classroom", walls: { left: true,  right: false }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  A2PI:  { menuGroup: "Type A (Left End)", name: "A2PI",  desc: "3 Walls + Ext Back Window + Left Door",    cost: 10, color: "#e74c3c", group: "classroom", walls: { left: true,  right: false }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  A3:    { menuGroup: "Type A (Left End)", name: "A3",    desc: "3 Walls + Ext Back Win + Ext Front Win",   cost: 10, color: "#e74c3c", group: "classroom", walls: { left: true,  right: false }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  A4:    { menuGroup: "Type A (Left End)", name: "A4",    desc: "3 Walls + Ext Back Window",               cost: 10, color: "#e74c3c", group: "classroom", walls: { left: true,  right: false }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },

  // ── Type B (Middle Open) ─────────────────────────────────────────────────
  B1:    { menuGroup: "Type B (Middle Open)", name: "B1",    desc: "2 Walls + Ext Back Window",              cost: 10, color: "#3498db", group: "classroom", walls: { left: false, right: false }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  B2PI:  { menuGroup: "Type B (Middle Open)", name: "B2PI",  desc: "2 Walls + Ext Back Window + Left Door",   cost: 10, color: "#3498db", group: "classroom", walls: { left: false, right: false }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  B2PD:  { menuGroup: "Type B (Middle Open)", name: "B2PD",  desc: "2 Walls + Ext Back Window + Right Door",  cost: 10, color: "#3498db", group: "classroom", walls: { left: false, right: false }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  B3:    { menuGroup: "Type B (Middle Open)", name: "B3",    desc: "2 Walls + Ext Back Win + Ext Front Win",  cost: 10, color: "#3498db", group: "classroom", walls: { left: false, right: false }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  B4:    { menuGroup: "Type B (Middle Open)", name: "B4",    desc: "2 Walls + Ext Back Window",              cost: 10, color: "#3498db", group: "classroom", walls: { left: false, right: false }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },

  // ── Type C (Right End) ───────────────────────────────────────────────────
  C1:    { menuGroup: "Type C (Right End)", name: "C1",    desc: "3 Walls + Ext Back Window",               cost: 10, color: "#9b59b6", group: "classroom", walls: { left: false, right: true  }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  C2PD:  { menuGroup: "Type C (Right End)", name: "C2PD",  desc: "3 Walls + Ext Back Window + Right Door",   cost: 10, color: "#9b59b6", group: "classroom", walls: { left: false, right: true  }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  C3:    { menuGroup: "Type C (Right End)", name: "C3",    desc: "3 Walls + Ext Back Win + Ext Front Win",   cost: 10, color: "#9b59b6", group: "classroom", walls: { left: false, right: true  }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  C4:    { menuGroup: "Type C (Right End)", name: "C4",    desc: "3 Walls + Ext Back Window",               cost: 10, color: "#9b59b6", group: "classroom", walls: { left: false, right: true  }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },

  // ── Type D (Standalone) ──────────────────────────────────────────────────
  D2PD:  { menuGroup: "Type D (Standalone)", name: "D2PD", desc: "4 Walls + Ext Back Win + Right Door",     cost: 10, color: "#2ecc71", group: "classroom", walls: { left: true,  right: true  }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  D2PI:  { menuGroup: "Type D (Standalone)", name: "D2PI", desc: "4 Walls + Ext Back Win + Left Door",      cost: 10, color: "#2ecc71", group: "classroom", walls: { left: true,  right: true  }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },

  // ── Type E (1 Wall) ──────────────────────────────────────────────────────
  E4:    { menuGroup: "Type E (1 Wall)", name: "E4",    desc: "1 Wall + Ext Back Window",          cost: 10, color: "#e67e22", group: "classroom", walls: { left: false, right: false }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  E5PCE: { menuGroup: "Type E (1 Wall)", name: "E5PCE", desc: "1 Wall + Ext Opening Door",         cost: 10, color: "#e67e22", group: "classroom", walls: { left: false, right: false }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  E5PCI: { menuGroup: "Type E (1 Wall)", name: "E5PCI", desc: "1 Wall + Int Opening Door",         cost: 10, color: "#e67e22", group: "classroom", walls: { left: false, right: false }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },

  // ── Type F (0 Walls) ─────────────────────────────────────────────────────
  F1:    { menuGroup: "Type F (0 Walls)", name: "F1", desc: "0 Walls",                 cost: 10, color: "#95a5a6", group: "classroom", walls: { left: false, right: false }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  F2:    { menuGroup: "Type F (0 Walls)", name: "F2", desc: "0 Walls",                 cost: 10, color: "#95a5a6", group: "classroom", walls: { left: false, right: false }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  F3:    { menuGroup: "Type F (0 Walls)", name: "F3", desc: "0 Walls - Open Framing",  cost: 10, color: "#95a5a6", group: "classroom", walls: { left: false, right: false }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },

  // ── Type G & H ───────────────────────────────────────────────────────────
  G4:    { menuGroup: "Type G & H", name: "G4", desc: "2 Walls (Left, Back) + Ext Window",  cost: 10, color: "#d35400", group: "classroom", walls: { left: true,  right: false }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  H4:    { menuGroup: "Type G & H", name: "H4", desc: "2 Walls (Right, Back) + Ext Window", cost: 10, color: "#8e44ad", group: "classroom", walls: { left: false, right: true  }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },

  // ── Restrooms ────────────────────────────────────────────────────────────
  ASPD:  { menuGroup: "Restrooms", name: "ASPD",  desc: "4 Walls + Ext Win + Right Door",    cost: 15, color: "#1abc9c", group: "classroom", walls: { left: true, right: true }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  ASPI:  { menuGroup: "Restrooms", name: "ASPI",  desc: "4 Walls + Ext Win + Left Door",     cost: 15, color: "#1abc9c", group: "classroom", walls: { left: true, right: true }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  ADPD:  { menuGroup: "Restrooms", name: "ADPD",  desc: "4 Walls + Ext Win + Right Door",    cost: 15, color: "#1abc9c", group: "classroom", walls: { left: true, right: true }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  ADPI:  { menuGroup: "Restrooms", name: "ADPI",  desc: "4 Walls + Ext Win + Left Door",     cost: 15, color: "#1abc9c", group: "classroom", walls: { left: true, right: true }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  AI:    { menuGroup: "Restrooms", name: "AI",    desc: "4 Walls + Int Wins + L/R Doors",    cost: 15, color: "#1abc9c", group: "classroom", walls: { left: true, right: true }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  AIMPD: { menuGroup: "Restrooms", name: "AIMPD", desc: "4 Walls + Right Opening Door",      cost: 15, color: "#1abc9c", group: "classroom", walls: { left: true, right: true }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  AIMPI: { menuGroup: "Restrooms", name: "AIMPI", desc: "4 Walls + Left Opening Door",       cost: 15, color: "#1abc9c", group: "classroom", walls: { left: true, right: true }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },

  // ── Exterior / Corridor ───────────────────────────────────────────────────
  CorridorFloor:     { menuGroup: "Exterior", name: "Corridor Floor",     desc: "Floor plane only (1 Story)",     cost: 4, color: "#f1c40f", group: "corridor", walls: { left: false, right: false }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  CorridorStructure: { menuGroup: "Exterior", name: "Corridor Structure", desc: "Frame + Detached Walls",         cost: 6, color: "#e67e22", group: "corridor", walls: { left: false, right: false }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
};
