import { store } from "../store";
import { blueprints } from "../data/blueprints";
import { roofKits } from "../data/roofKits";
import { computeBoq, groupBom, type Boq } from "../core/boq";

/** Shape of the data exposed for CSV export (stored on window for the exporter). */
export type BoqData = Boq;

// ── Main Update Function ──────────────────────────────────────────────────────

/** Recalculates all counts and updates every BOM / cost panel in the DOM. */
export function updateCostUI(): void {
  const boq = computeBoq(store.placedBlocks);
  const {
    classrooms: classroomCount,
    corridors: corridorCount,
    standardLinks,
    panelLinks,
    simpleLinks,
    verticalLinks,
    roofs: roofCounts,
    modules: feeCounts,
    totalFee: totalCost,
  } = boq;

  // ── DOM updates ────────────────────────────────────────────────────────────

  document.getElementById("qto-list")!.innerHTML = `
    <div style="display:flex;justify-content:space-between;color:#ccc"><span>Classrooms:</span><span>${classroomCount}</span></div>
    <div style="display:flex;justify-content:space-between;color:#ccc"><span>Corridors:</span><span>${corridorCount}</span></div>
  `;
  document.getElementById("link-standard")!.innerText =
    standardLinks.toString();
  document.getElementById("link-panel")!.innerText = panelLinks.toString();
  document.getElementById("link-simples")!.innerText = simpleLinks.toString();
  document.getElementById("link-verticales")!.innerText =
    verticalLinks.toString();

  // BOM grouped by category
  const groupedCart = groupBom(boq.bom);

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
    bomHTML ||
    `<div style="color:#666;font-style:italic">No items loaded</div>`;

  let roofHTML = "";
  for (const [key, count] of Object.entries(roofCounts))
    roofHTML += `<div style="display:flex;justify-content:space-between;color:#ccc"><span>${roofKits[key]?.name ?? key}:</span><span>${count}</span></div>`;
  document.getElementById("boq-roof-list")!.innerHTML =
    roofHTML ||
    `<div style="color:#666;font-style:italic">No roofs assigned</div>`;

  let feeHTML = "";
  for (const [key, count] of Object.entries(feeCounts)) {
    const bp = blueprints[key];
    feeHTML += `<div style="display:flex;justify-content:space-between"><span>${bp.name} (x${count})</span><span>€${count * bp.cost}</span></div>`;
  }
  document.getElementById("fee-list")!.innerHTML =
    feeHTML ||
    `<div style="color:#666;font-style:italic">No modules placed.</div>`;
  document.getElementById("total-cost")!.innerText = `€${totalCost}`;

  // Expose typed snapshot for CSV export
  (window as unknown as { __boqData: BoqData }).__boqData = boq;
}
