import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { store } from "../store";
import { blueprints } from "../data/blueprints";
import { electricalKits } from "../data/electricalKits";
import { roofKits } from "../data/roofKits";
import { getCategory } from "../data/categoryMap";
import { clearModules, createModule } from "../modules/placement";
import { parseLayout, toSavedModules, type SavedModule } from "../core/layout";
import { ARCHICAD_NOTES, toArchicadPlacements } from "../core/archicad";
import { saveState } from "../modules/history";
import type { BoqData } from "./bomCalculator";

// ── Shared file-save helper ───────────────────────────────────────────────────

async function saveFile(
  content: string | Blob,
  suggestedName: string,
  mimeType: string,
  extension: string,
): Promise<string | null> {
  const blob =
    content instanceof Blob ? content : new Blob([content], { type: mimeType });

  try {
    if ("showSaveFilePicker" in window) {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName,
        types: [
          {
            description: `${extension.toUpperCase()} File`,
            accept: { [mimeType]: [`.${extension}`] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return handle.name as string;
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = suggestedName;
    a.click();
    URL.revokeObjectURL(url);
    return suggestedName;
  } catch (err: any) {
    if (err.name !== "AbortError") {
      console.error("Export failed:", err);
      alert("An error occurred while saving the file.");
    }
    return null;
  }
}

// ── Project Save / Load ───────────────────────────────────────────────────────

export interface LoadCallbacks {
  onRestored: () => void;
}

export type { SavedModule };

/** Serialises the current layout to a JSON file (world-space transforms). */
/** Saves the layout as a .json file. Resolves to the file name, or null if cancelled. */
export async function saveProject(
  suggestedName?: string,
): Promise<string | null> {
  if (store.placedBlocks.length === 0) {
    alert("Nothing to save!");
    return null;
  }

  const data: SavedModule[] = toSavedModules(store.placedBlocks);
  const name = suggestedName
    ? `${suggestedName.replace(/\.json$/i, "").replace(/[\\/:*?"<>|]/g, "-")}.json`
    : "modular_school.json";

  return saveFile(
    JSON.stringify(data, null, 2),
    name,
    "application/json",
    "json",
  );
}

/** Validates parsed project JSON (see core/layout). */
export const parseProject = parseLayout;

/** Reads a saved JSON layout file and rebuilds the scene (undoable). */
export function loadProject(file: File, cb: LoadCallbacks): void {
  // cb.onRestored runs only when the file loaded (the scene was replaced)
  const reader = new FileReader();
  reader.onload = (e) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(e.target?.result as string);
    } catch {
      alert("Failed to load file: it is not valid JSON.");
      return;
    }

    const { modules, problems } = parseProject(parsed);
    if (modules.length === 0) {
      alert(
        `Nothing loaded — the current scene was kept.\n\n${problems.slice(0, 10).join("\n")}`,
      );
      return;
    }
    if (
      problems.length > 0 &&
      !window.confirm(
        `${problems.length} issue(s) found:\n\n${problems.slice(0, 10).join("\n")}${problems.length > 10 ? "\n…" : ""}\n\nLoad the ${modules.length} valid module(s) anyway?`,
      )
    ) {
      return;
    }

    saveState(); // loading can be undone
    clearModules();
    modules.forEach((m) =>
      createModule({
        id: m.id,
        typeKey: m.typeKey,
        elecKey: m.elecKey,
        roofKey: m.roofKey,
        position: new THREE.Vector3(m.pos.x, m.pos.y, m.pos.z),
        rotation: new THREE.Euler(m.rot.x, m.rot.y, m.rot.z),
      }),
    );
    cb.onRestored();
  };
  reader.readAsText(file);
}

// ── CSV Export ────────────────────────────────────────────────────────────────

/** Exports the current BOM data as a CSV file. */
export async function exportCSV(): Promise<void> {
  const data = (window as any).__boqData as BoqData | undefined;
  if (!data) {
    alert("Nothing to export!");
    return;
  }

  let csv = "Category,Item ID,Item Name,Quantity\n";
  csv += `Modules,,Classrooms,${data.classrooms}\n`;
  csv += `Modules,,Corridors,${data.corridors}\n`;

  for (const [id, item] of Object.entries(data.bom)) {
    const cleanName = (item as any).name.replace(/"/g, '""');
    csv += `BOM - ${getCategory(id)},${id},"${cleanName}",${(item as any).qty}\n`;
  }
  for (const [key, count] of Object.entries(data.elec))
    csv += `Electrical Kits,${key},${electricalKits[key]?.name ?? key},${count}\n`;
  for (const [key, count] of Object.entries(data.roofs))
    csv += `Roofs,${key},${roofKits[key]?.name ?? key},${count}\n`;

  csv += `Adosamientos,,Largo Standard,${data.standardLinks}\n`;
  csv += `Adosamientos,,Largo Panel,${data.panelLinks}\n`;
  csv += `Adosamientos,,Simples,${data.simpleLinks}\n`;
  csv += `Adosamientos,,Conexiones Verticales,${data.verticalLinks}\n`;
  csv += `Project Fee,,Total Fee (EUR),${data.totalFee}\n`;

  await saveFile(
    csv,
    "modular_school_boq.csv",
    "text/csv;charset=utf-8;",
    "csv",
  );
}

// ── GLTF Export ───────────────────────────────────────────────────────────────

/** Exports the current 3D layout as a GLTF file. */
export function exportGLTF(): void {
  if (store.placedBlocks.length === 0) {
    alert("Nothing to export yet!");
    return;
  }

  const exporter = new GLTFExporter();
  const exportScene = new THREE.Scene();

  store.placedBlocks.forEach((b) => {
    const mesh = new THREE.Mesh(
      b.mesh.geometry,
      new THREE.MeshStandardMaterial({
        color: blueprints[b.typeKey].color,
        roughness: 0.65,
      }),
    );
    mesh.name = `${b.typeKey}_${b.id}`;
    mesh.userData = {
      id: b.id,
      typeKey: b.typeKey,
      elecKey: b.elecKey,
      roofKey: b.roofKey,
    };
    b.mesh.getWorldPosition(mesh.position);
    b.mesh.getWorldQuaternion(mesh.quaternion);
    exportScene.add(mesh);
  });

  exporter.parse(
    exportScene,
    (gltf) =>
      saveFile(
        new Blob([JSON.stringify(gltf, null, 2)], { type: "text/plain" }),
        "modular_model.gltf",
        "text/plain",
        "gltf",
      ),
    (err) => console.error(err),
    { binary: false },
  );
}

// ── Archicad sync ────────────────────────────────────────────────────────────

/**
 * Saves the placement file read by the Archicad hotlink sync script (Tapir):
 * one entry per module with Archicad coordinates, storey, rotation and kits.
 * Module ids let the script update hotlinks it placed before instead of duplicating them.
 */
export async function exportArchicadPlacement(): Promise<void> {
  if (store.placedBlocks.length === 0) {
    alert("Nothing to sync yet — place some modules first.");
    return;
  }
  const placements = toArchicadPlacements(toSavedModules(store.placedBlocks));
  const data = {
    format: "modulnor-archicad-placement",
    version: 1,
    exported_at: new Date().toISOString(),
    units: "m",
    notes: ARCHICAD_NOTES,
    hotlinks: [...new Set(placements.map((p) => p.hotlink))].sort(),
    storeys: [...new Set(placements.map((p) => p.storey))].sort(
      (a, b) => a - b,
    ),
    placements,
  };
  await saveFile(
    JSON.stringify(data, null, 2),
    "modulnor_archicad_sync.json",
    "application/json",
    "json",
  );
}
