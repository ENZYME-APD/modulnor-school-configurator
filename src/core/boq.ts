import bomData from "../bom.json";
import type { PlacedModule } from "../types";
import { blueprints } from "../data/blueprints";
import { getCategory } from "../data/categoryMap";
import { computeModuleBoxes, detectLinks } from "../bom/linkDetector";
import { getDynamicWalls } from "./walls";

// Quantities, bill of materials and fee for a layout. Pure: shared by the
// browser panels, CSV export and the MCP server.

export type ShoppingCart = Record<string, { name: string; qty: number }>;

export interface Boq {
  classrooms: number;
  corridors: number;
  /** Count of each module type. */
  modules: Record<string, number>;
  bom: ShoppingCart;
  elec: Record<string, number>;
  roofs: Record<string, number>;
  standardLinks: number;
  panelLinks: number;
  simpleLinks: number;
  verticalLinks: number;
  dynamicWallMeters: number;
  /** Sum of the module type costs (placeholder fee values from the catalogue). */
  totalFee: number;
}

function addBomToCart(cart: ShoppingCart, key: string, multiplier = 1): void {
  const partBom = (bomData as Record<string, unknown>)[key];
  if (!partBom) return;
  for (const [id, details] of Object.entries(
    partBom as Record<string, unknown>,
  )) {
    const d = details as { name?: string; qty?: number };
    if (!d?.name?.trim() || d.qty == null) continue;
    if (!cart[id]) cart[id] = { name: d.name.trim(), qty: 0 };
    cart[id].qty += d.qty * multiplier;
  }
}

export function computeBoq(blocks: PlacedModule[]): Boq {
  let classrooms = 0;
  let corridors = 0;
  let totalFee = 0;
  let dynamicWallMeters = 0;
  const modules: Record<string, number> = {};
  const elec: Record<string, number> = {};
  const roofs: Record<string, number> = {};
  const bom: ShoppingCart = {};
  const boxes = computeModuleBoxes(blocks);

  for (const b of blocks) {
    const bp = blueprints[b.typeKey];
    if (bp.group === "classroom") {
      classrooms++;
      addBomToCart(bom, "ESTRUCTURA");
    }
    if (bp.group === "corridor") {
      corridors++;
      if (b.typeKey === "CorridorStructure") {
        const dw = getDynamicWalls(b, blocks, boxes);
        if (dw.posX) dynamicWallMeters += 2.44;
        if (dw.negX) dynamicWallMeters += 2.44;
        if (dw.posZ) dynamicWallMeters += 6.0;
        if (dw.negZ) dynamicWallMeters += 6.0;
      }
    }
    modules[b.typeKey] = (modules[b.typeKey] ?? 0) + 1;
    totalFee += bp.cost;
    if (b.elecKey) elec[b.elecKey] = (elec[b.elecKey] ?? 0) + 1;
    if (b.roofKey) roofs[b.roofKey] = (roofs[b.roofKey] ?? 0) + 1;
    addBomToCart(bom, b.typeKey);
    if (b.elecKey) addBomToCart(bom, b.elecKey);
    if (b.roofKey) addBomToCart(bom, b.roofKey);
  }

  dynamicWallMeters = parseFloat(dynamicWallMeters.toFixed(2));
  if (dynamicWallMeters > 0)
    bom["REV-DYN-WALL"] = {
      name: "Corridor Dynamic Walls (Linear m)",
      qty: dynamicWallMeters,
    };

  const { standardLinks, panelLinks, simpleLinks, verticalLinks } = detectLinks(
    blocks,
    boxes,
  );
  if (standardLinks > 0) addBomToCart(bom, "LARGO_STANDARD", standardLinks);
  if (panelLinks > 0) addBomToCart(bom, "LARGO", panelLinks);

  return {
    classrooms,
    corridors,
    modules,
    bom,
    elec,
    roofs,
    standardLinks,
    panelLinks,
    simpleLinks,
    verticalLinks,
    dynamicWallMeters,
    totalFee,
  };
}

/** BOM lines grouped by category, in first-seen order. */
export function groupBom(
  bom: ShoppingCart,
): Record<string, { id: string; name: string; qty: number }[]> {
  const grouped: Record<string, { id: string; name: string; qty: number }[]> =
    {};
  for (const [id, item] of Object.entries(bom)) {
    const cat = getCategory(id);
    (grouped[cat] ??= []).push({
      id,
      name: item.name,
      qty: Math.round(item.qty * 1000) / 1000,
    });
  }
  return grouped;
}
