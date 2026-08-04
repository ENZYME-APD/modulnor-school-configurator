import bomData from "../bom.json";
import { store } from "../store";
import { blueprints } from "../data/blueprints";
import { roofKits } from "../data/roofKits";
import { getCategory } from "../data/categoryMap";
import { detectLinks } from "./linkDetector";
import { getDynamicWalls } from "../qc/qcManager";

// ── Types ─────────────────────────────────────────────────────────────────────

type ShoppingCart = Record<string, { name: string; qty: number }>;

/** Shape of the data exposed for CSV export (stored on window for the exporter). */
export interface BoqData {
  classrooms:    number;
  corridors:     number;
  bom:           ShoppingCart;
  elec:          Record<string, number>;
  roofs:         Record<string, number>;
  standardLinks: number;
  panelLinks:    number;
  simpleLinks:   number;
  verticalLinks: number;
  totalFee:      number;
}

// ── BOM Cart Helper ───────────────────────────────────────────────────────────

function addBomToCart(cart: ShoppingCart, key: string, multiplier = 1): void {
  const partBom = (bomData as Record<string, unknown>)[key];
  if (!partBom) return;
  for (const [id, details] of Object.entries(partBom as Record<string, unknown>)) {
    const d = details as { name?: string; qty?: number };
    if (!d?.name?.trim() || d.qty == null) continue;
    if (!cart[id]) cart[id] = { name: d.name.trim(), qty: 0 };
    cart[id].qty += d.qty * multiplier;
  }
}

// ── Main Update Function ──────────────────────────────────────────────────────

/** Recalculates all counts, rebuilds BOM HTML, and updates every DOM element. */
export function updateCostUI(): void {
  let classroomCount = 0, corridorCount = 0, totalCost = 0;
  let dynamicWallMeters = 0;
  const elecCounts:  Record<string, number> = {};
  const roofCounts:  Record<string, number> = {};
  const feeCounts:   Record<string, number> = {};
  const shoppingCart: ShoppingCart = {};

  store.placedBlocks.forEach((b) => {
    const bp = blueprints[b.typeKey];

    if (bp.group === "classroom") {
      classroomCount++;
      addBomToCart(shoppingCart, "ESTRUCTURA");
    }

    if (bp.group === "corridor") {
      corridorCount++;
      if (b.typeKey === "CorridorStructure") {
        const dw = getDynamicWalls(b, store.placedBlocks);
        if (dw.posX) dynamicWallMeters += 2.44;
        if (dw.negX) dynamicWallMeters += 2.44;
        if (dw.posZ) dynamicWallMeters += 6.00;
        if (dw.negZ) dynamicWallMeters += 6.00;
      }
    }

    feeCounts[b.typeKey] = (feeCounts[b.typeKey] ?? 0) + 1;
    totalCost += bp.cost;
    if (b.elecKey) elecCounts[b.elecKey] = (elecCounts[b.elecKey] ?? 0) + 1;
    if (b.roofKey) roofCounts[b.roofKey] = (roofCounts[b.roofKey] ?? 0) + 1;

    addBomToCart(shoppingCart, b.typeKey);
    if (b.elecKey) addBomToCart(shoppingCart, b.elecKey);
    if (b.roofKey) addBomToCart(shoppingCart, b.roofKey);
  });

  if (dynamicWallMeters > 0) {
    shoppingCart["REV-DYN-WALL"] = {
      name: "Corridor Dynamic Walls (Linear m)",
      qty:  parseFloat(dynamicWallMeters.toFixed(2)),
    };
  }

  // Shared link detector — previously duplicated here and in refreshQCColors
  const { standardLinks, panelLinks, simpleLinks, verticalLinks } =
    detectLinks(store.placedBlocks);

  if (standardLinks > 0) addBomToCart(shoppingCart, "LARGO_STANDARD", standardLinks);
  if (panelLinks    > 0) addBomToCart(shoppingCart, "LARGO",           panelLinks);

  // ── DOM updates ────────────────────────────────────────────────────────────

  document.getElementById("qto-list")!.innerHTML = `
    <div style="display:flex;justify-content:space-between;color:#ccc"><span>Classrooms:</span><span>${classroomCount}</span></div>
    <div style="display:flex;justify-content:space-between;color:#ccc"><span>Corridors:</span><span>${corridorCount}</span></div>
  `;
  document.getElementById("link-standard")!.innerText   = standardLinks.toString();
  document.getElementById("link-panel")!.innerText      = panelLinks.toString();
  document.getElementById("link-simples")!.innerText    = simpleLinks.toString();
  document.getElementById("link-verticales")!.innerText = verticalLinks.toString();

  // BOM grouped by category
  const groupedCart: Record<string, { id: string; name: string; qty: number }[]> = {};
  for (const [id, item] of Object.entries(shoppingCart)) {
    const cat = getCategory(id);
    if (!groupedCart[cat]) groupedCart[cat] = [];
    groupedCart[cat].push({ id, name: item.name, qty: item.qty });
  }

  let bomHTML = "";
  for (const [cat, items] of Object.entries(groupedCart)) {
    bomHTML += `<div style="background:#111;color:#74a382;padding:4px;margin-top:6px;font-weight:bold;font-size:.85em;border-radius:3px">${cat}</div>`;
    for (const item of items) {
      bomHTML += `<div style="display:flex;justify-content:space-between;color:#ccc;font-size:.85em;margin:2px 0 2px 8px">
        <span title="${item.id}" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:200px">${item.name}</span>
        <span style="color:white;font-weight:bold">${item.qty}</span>
      </div>`;
    }
  }
  document.getElementById("boq-bom-list")!.innerHTML =
    bomHTML || `<div style="color:#666;font-style:italic">No items loaded</div>`;

  let roofHTML = "";
  for (const [key, count] of Object.entries(roofCounts))
    roofHTML += `<div style="display:flex;justify-content:space-between;color:#ccc"><span>${roofKits[key].name}:</span><span>${count}</span></div>`;
  document.getElementById("boq-roof-list")!.innerHTML =
    roofHTML || `<div style="color:#666;font-style:italic">No roofs assigned</div>`;

  let feeHTML = "";
  for (const [key, count] of Object.entries(feeCounts)) {
    const bp = blueprints[key];
    feeHTML += `<div style="display:flex;justify-content:space-between"><span>${bp.name} (x${count})</span><span>€${count * bp.cost}</span></div>`;
  }
  document.getElementById("fee-list")!.innerHTML =
    feeHTML || `<div style="color:#666;font-style:italic">No modules placed.</div>`;
  document.getElementById("total-cost")!.innerText = `€${totalCost}`;

  // Expose typed snapshot for CSV export
  (window as any).__boqData = {
    classrooms: classroomCount, corridors: corridorCount,
    bom: shoppingCart, elec: elecCounts, roofs: roofCounts,
    standardLinks, panelLinks, simpleLinks, verticalLinks, totalFee: totalCost,
  } satisfies BoqData;
}
