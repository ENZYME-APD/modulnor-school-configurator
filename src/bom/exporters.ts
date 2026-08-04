import * as THREE from "three";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";
import { store } from "../store";
import { blueprints } from "../data/blueprints";
import { electricalKits } from "../data/electricalKits";
import { roofKits } from "../data/roofKits";
import { getCategory } from "../data/categoryMap";
import { applyModuleStyle } from "../modules/moduleStyle";
import type { BoqData } from "./bomCalculator";

// ── Shared file-save helper ───────────────────────────────────────────────────

async function saveFile(
  content:       string | Blob,
  suggestedName: string,
  mimeType:      string,
  extension:     string,
): Promise<void> {
  const blob =
    content instanceof Blob ? content : new Blob([content], { type: mimeType });

  try {
    if ("showSaveFilePicker" in window) {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName,
        types: [{ description: `${extension.toUpperCase()} File`, accept: { [mimeType]: [`.${extension}`] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
    } else {
      const url = URL.createObjectURL(blob);
      const a   = document.createElement("a");
      a.href = url; a.download = suggestedName; a.click();
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
  scene:       THREE.Scene;
  onRestored:  () => void;
}

/** Serialises the current layout to a JSON file. */
export async function saveProject(): Promise<void> {
  if (store.placedBlocks.length === 0) { alert("Nothing to save!"); return; }

  const data = store.placedBlocks.map((b) => ({
    id: b.id, typeKey: b.typeKey, elecKey: b.elecKey, roofKey: b.roofKey,
    pos: { x: b.mesh.position.x, y: b.mesh.position.y, z: b.mesh.position.z },
    rot: { x: b.mesh.rotation.x, y: b.mesh.rotation.y, z: b.mesh.rotation.z },
  }));

  await saveFile(JSON.stringify(data, null, 2), "modular_school.json", "application/json", "json");
}

/** Reads a saved JSON layout file and rebuilds the scene. */
export function loadProject(file: File, cb: LoadCallbacks): void {
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target?.result as string);

      // Clear current scene
      store.placedBlocks.forEach((b) => {
        cb.scene.remove(b.mesh);
        if (b.mesh.geometry) b.mesh.geometry.dispose();
        if (b.mesh.material) {
          if (Array.isArray(b.mesh.material)) b.mesh.material.forEach((m) => m.dispose());
          else (b.mesh.material as THREE.Material).dispose();
        }
      });
      store.placedBlocks.length = 0;
      store.history.length = 0;

      // Rebuild from file
      data.forEach((bData: any) => {
        const bp = blueprints[bData.typeKey];
        if (!bp) return;
        const mesh = new THREE.Mesh();
        applyModuleStyle(mesh, bData.typeKey);
        mesh.position.set(bData.pos.x, bData.pos.y, bData.pos.z);
        mesh.rotation.set(bData.rot.x, bData.rot.y, bData.rot.z);
        mesh.castShadow = true; mesh.receiveShadow = true;
        cb.scene.add(mesh);
        store.placedBlocks.push({
          id: bData.id ?? crypto.randomUUID(),
          typeKey: bData.typeKey,
          elecKey: bData.elecKey,
          roofKey: bData.roofKey,
          mesh,
        });
      });

      cb.onRestored();
    } catch {
      alert("Failed to load file. Ensure it is a valid project JSON.");
    }
  };
  reader.readAsText(file);
}

// ── CSV Export ────────────────────────────────────────────────────────────────

/** Exports the current BOM data as a CSV file. */
export async function exportCSV(): Promise<void> {
  const data = (window as any).__boqData as BoqData | undefined;
  if (!data) { alert("Nothing to export!"); return; }

  let csv = "Category,Item ID,Item Name,Quantity\n";
  csv += `Modules,,Classrooms,${data.classrooms}\n`;
  csv += `Modules,,Corridors,${data.corridors}\n`;

  for (const [id, item] of Object.entries(data.bom)) {
    const cleanName = (item as any).name.replace(/"/g, '""');
    csv += `BOM - ${getCategory(id)},${id},"${cleanName}",${(item as any).qty}\n`;
  }
  for (const [key, count] of Object.entries(data.elec))
    csv += `Electrical Kits,${key},${electricalKits[key].name},${count}\n`;
  for (const [key, count] of Object.entries(data.roofs))
    csv += `Roofs,${key},${roofKits[key].name},${count}\n`;

  csv += `Adosamientos,,Largo Standard,${data.standardLinks}\n`;
  csv += `Adosamientos,,Largo Panel,${data.panelLinks}\n`;
  csv += `Adosamientos,,Simples,${data.simpleLinks}\n`;
  csv += `Adosamientos,,Conexiones Verticales,${data.verticalLinks}\n`;
  csv += `Project Fee,,Total Fee (EUR),${data.totalFee}\n`;

  await saveFile(csv, "modular_school_boq.csv", "text/csv;charset=utf-8;", "csv");
}

// ── GLTF Export ───────────────────────────────────────────────────────────────

/** Exports the current 3D layout as a GLTF file. */
export function exportGLTF(): void {
  if (store.placedBlocks.length === 0) { alert("Nothing to export yet!"); return; }

  const exporter    = new GLTFExporter();
  const exportScene = new THREE.Scene();

  store.placedBlocks.forEach((b) => {
    const clone = b.mesh.clone();
    b.mesh.getWorldPosition(clone.position);
    b.mesh.getWorldQuaternion(clone.quaternion);

    if (Array.isArray(clone.material)) clone.material = new THREE.MeshStandardMaterial();
    const mat = clone.material as THREE.MeshStandardMaterial;
    mat.color.set(blueprints[b.typeKey].color);
    mat.transparent = true; mat.opacity = 0.9; mat.depthWrite = true;
    exportScene.add(clone);
  });

  exporter.parse(
    exportScene,
    (gltf) => saveFile(
      new Blob([JSON.stringify(gltf, null, 2)], { type: "text/plain" }),
      "modular_model.gltf", "text/plain", "gltf",
    ),
    (err) => console.error(err),
    { binary: false },
  );
}
