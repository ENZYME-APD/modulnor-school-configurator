import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { store } from "../store";
import { blueprints } from "../data/blueprints";
import { electricalKits } from "../data/electricalKits";
import { roofKits } from "../data/roofKits";
import { getCategory } from "../data/categoryMap";
import { clearModules, createModule } from "../modules/placement";
import { saveState } from "../modules/history";
import type { BoqData } from "./bomCalculator";

// ── Shared file-save helper ───────────────────────────────────────────────────

async function saveFile(
  content: string | Blob,
  suggestedName: string,
  mimeType: string,
  extension: string,
): Promise<void> {
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
    } else {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = suggestedName;
      a.click();
      URL.revokeObjectURL(url);
    }
  } catch (err: any) {
    if (err.name !== "AbortError") {
      console.error("Export failed:", err);
      alert("An error occurred while saving the file.");
    }
  }
}

// ── Project Save / Load ───────────────────────────────────────────────────────

export interface LoadCallbacks {
  onRestored: () => void;
}

/** One module as stored in a project file (also the Archicad placement input). */
export interface SavedModule {
  id: string;
  typeKey: string;
  elecKey?: string;
  roofKey?: string;
  pos: { x: number; y: number; z: number };
  rot: { x: number; y: number; z: number };
}

/** Serialises the current layout to a JSON file (world-space transforms). */
export async function saveProject(): Promise<void> {
  if (store.placedBlocks.length === 0) {
    alert("Nothing to save!");
    return;
  }

  const data: SavedModule[] = store.placedBlocks.map((b) => {
    const p = b.mesh.getWorldPosition(new THREE.Vector3());
    const r = new THREE.Euler().setFromQuaternion(
      b.mesh.getWorldQuaternion(new THREE.Quaternion()),
    );
    return {
      id: b.id,
      typeKey: b.typeKey,
      elecKey: b.elecKey,
      roofKey: b.roofKey,
      pos: { x: p.x, y: p.y, z: p.z },
      rot: { x: r.x, y: r.y, z: r.z },
    };
  });

  await saveFile(
    JSON.stringify(data, null, 2),
    "modular_school.json",
    "application/json",
    "json",
  );
}

const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);
const isVec = (v: any): boolean => v && isNum(v.x) && isNum(v.y) && isNum(v.z);

/**
 * Validates parsed project JSON. Returns the usable modules plus a list of
 * problems; nothing in the scene is touched until validation has passed.
 */
export function parseProject(data: unknown): {
  modules: SavedModule[];
  problems: string[];
} {
  if (!Array.isArray(data))
    return {
      modules: [],
      problems: ["File is not a project layout (expected a list of modules)."],
    };

  const modules: SavedModule[] = [];
  const problems: string[] = [];
  data.forEach((m: any, i) => {
    if (!m || !blueprints[m.typeKey]) {
      problems.push(`Module ${i + 1}: unknown type "${m?.typeKey}"`);
      return;
    }
    if (!isVec(m.pos) || !isVec(m.rot)) {
      problems.push(`Module ${i + 1}: missing or invalid position/rotation`);
      return;
    }
    const elecKey =
      m.elecKey && electricalKits[m.elecKey] ? m.elecKey : undefined;
    const roofKey = m.roofKey && roofKits[m.roofKey] ? m.roofKey : undefined;
    if (m.elecKey && !elecKey)
      problems.push(
        `Module ${i + 1}: unknown electrical kit "${m.elecKey}" dropped`,
      );
    if (m.roofKey && !roofKey)
      problems.push(`Module ${i + 1}: unknown roof kit "${m.roofKey}" dropped`);
    modules.push({
      id: typeof m.id === "string" ? m.id : crypto.randomUUID(),
      typeKey: m.typeKey,
      elecKey,
      roofKey,
      pos: { x: m.pos.x, y: m.pos.y, z: m.pos.z },
      rot: { x: m.rot.x, y: m.rot.y, z: m.rot.z },
    });
  });
  return { modules, problems };
}

/** Reads a saved JSON layout file and rebuilds the scene (undoable). */
export function loadProject(file: File, cb: LoadCallbacks): void {
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
