import * as THREE from "three";

import { blueprints, electricalKits, roofKits } from "./data";
import { store } from "./store";
import { createViewer } from "./scene/viewer";
import { invalidate } from "./scene/invalidate";
import { applyModuleStyle } from "./modules/moduleStyle";
import { saveState, undo } from "./modules/history";
import {
  initPlacement,
  createModule,
  duplicateModules,
  removeModules,
  findModule,
} from "./modules/placement";
import { osnap, applySnapMarkerColor, performOsnap } from "./tools/osnapTool";
import {
  initSelectionManager,
  updateSelection,
  refreshSelection,
} from "./tools/selectionManager";
import { initQCManager, refreshQCColors } from "./qc/qcManager";
import { updateCostUI } from "./bom/bomCalculator";
import {
  saveProject,
  loadProject,
  exportCSV,
  exportGLTF,
} from "./bom/exporters";
import {
  updatePropertiesUI,
  initPropertiesPanel,
  elecSelect,
  roofSelect,
} from "./ui/propertiesPanel";

// ─────────────────────────────────────────────────────────────────────────────
// SETUP
// ─────────────────────────────────────────────────────────────────────────────

const container = document.getElementById("app-container");
if (!container) throw new Error("Missing #app-container");

const viewer = createViewer(container);
const {
  scene,
  overlay,
  renderer,
  cameraOrtho,
  orbitControls,
  transformControls,
  transformGroup,
} = viewer;
const canvas = renderer.domElement;

const snapMarker = new THREE.Mesh(
  new THREE.SphereGeometry(0.12),
  new THREE.MeshBasicMaterial({ color: 0xff0000, depthTest: false }),
);
snapMarker.visible = false;
overlay.add(snapMarker);

initPlacement(scene);
initQCManager(overlay);
initSelectionManager({
  scene,
  transformControls,
  transformGroup,
  onSelectionChange: updatePropertiesUI,
});
initPropertiesPanel({
  onSaveState: saveState,
  onCostUpdate: () => afterLayoutChange(),
  onQCRefresh: () => {}, // afterLayoutChange already refreshes QC
});

const allMeshes = () => store.placedBlocks.map((b) => b.mesh);

/** Recalculate BOM/cost, QC colours and shadow framing after a layout change. */
function afterLayoutChange(): void {
  updateCostUI();
  refreshQCColors();
  viewer.fitShadows(allMeshes());
  invalidate();
}

/** Throttled cost refresh for live feedback while dragging (full refresh on drop). */
let costTimer: number | null = null;
function scheduleCostUpdate(): void {
  if (costTimer !== null) return;
  costTimer = window.setTimeout(() => {
    costTimer = null;
    updateCostUI();
  }, 250);
}

/** True when keyboard focus is in a form field (so shortcuts must not fire). */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return (
    !!el &&
    (["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) ||
      el.isContentEditable)
  );
}

// Render on demand: any input may change what's on screen.
["keydown", "keyup", "click", "change", "input", "pointerup"].forEach((t) =>
  window.addEventListener(t, invalidate, { passive: true }),
);
canvas.addEventListener("pointermove", invalidate, { passive: true });
canvas.addEventListener("pointerdown", invalidate, { passive: true });

// ─────────────────────────────────────────────────────────────────────────────
// CONTEXT MENU + MODULE SELECT POPULATION
// ─────────────────────────────────────────────────────────────────────────────

const contextMenu = document.getElementById("context-menu") as HTMLDivElement;
const selectEl = document.getElementById(
  "block-type-select",
) as HTMLSelectElement;
const hideContextMenu = () => {
  contextMenu.style.display = "none";
};

function addOption(
  select: HTMLSelectElement | HTMLOptGroupElement,
  value: string,
  label: string,
): void {
  const opt = document.createElement("option");
  opt.value = value;
  opt.textContent = label;
  select.appendChild(opt);
}
Object.entries(electricalKits).forEach(([key, kit]) =>
  addOption(elecSelect, key, kit.name),
);
Object.entries(roofKits).forEach(([key, kit]) =>
  addOption(roofSelect, key, kit.name),
);

function addMenuButton(html: string): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.innerHTML = html;
  contextMenu.appendChild(btn);
  return btn;
}
const duplicateBtn = addMenuButton(
  `<span style="color:#2ecc71;font-weight:bold">⧉ Duplicate Module(s)</span>`,
);
const rot90Btn = addMenuButton(
  `<span style="color:#3498db;font-weight:bold">⤾ Rotate +90°</span>`,
);
const rot180Btn = addMenuButton(
  `<span style="color:#e67e22;font-weight:bold">↻ Rotate 180°</span>`,
);
contextMenu.appendChild(document.createElement("hr"));

const menuGroups: Record<
  string,
  { key: string; color: string; name: string }[]
> = {};
for (const [key, data] of Object.entries(blueprints)) {
  (menuGroups[data.menuGroup] ??= []).push({
    key,
    color: data.color,
    name: data.name,
  });
}
for (const [groupName, items] of Object.entries(menuGroups)) {
  const optGroup = document.createElement("optgroup");
  optGroup.label = groupName;
  const header = document.createElement("div");
  header.className = "menu-header";
  header.textContent = groupName;
  contextMenu.appendChild(header);
  items.forEach((item) => {
    addOption(optGroup, item.key, item.name);
    const btn = addMenuButton(
      `<span style="color:${item.color}">■</span> Swap to ${item.name}`,
    );
    btn.dataset.type = item.key;
  });
  selectEl.appendChild(optGroup);
}

/** Replace the selection with `meshes`. */
function selectOnly(meshes: THREE.Mesh[]): void {
  updateSelection(null, false);
  meshes.forEach((m) => updateSelection(m, true));
}

contextMenu.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  const btn = (e.target as HTMLElement).closest(
    "button",
  ) as HTMLButtonElement | null;
  if (!btn || store.selectedBlocks.size === 0) return;
  e.stopPropagation();
  saveState();

  if (btn.dataset.type) {
    const newType = btn.dataset.type;
    store.selectedBlocks.forEach((mesh) => {
      const placed = findModule(mesh);
      if (placed) placed.typeKey = newType;
      applyModuleStyle(mesh, newType);
    });
    refreshSelection();
  } else if (btn === duplicateBtn) {
    const offset = new THREE.Vector3(store.globalSnap, 0, store.globalSnap);
    selectOnly(duplicateModules(store.selectedBlocks, offset));
  } else if (btn === rot90Btn || btn === rot180Btn) {
    const angle = btn === rot90Btn ? Math.PI / 2 : Math.PI;
    store.selectedBlocks.forEach((mesh) => {
      mesh.rotation.y += angle;
    });
    updatePropertiesUI();
  }

  hideContextMenu();
  afterLayoutChange();
});

// ─────────────────────────────────────────────────────────────────────────────
// TOOLS
// ─────────────────────────────────────────────────────────────────────────────

const gizmoModeBtn = document.getElementById("gizmo-mode-btn")!;

function setTool(tool: typeof store.activeTool): void {
  store.activeTool = tool;
  if (tool === "osnap") {
    transformControls.detach();
    gizmoModeBtn.innerHTML = "<b>Tool: OSNAP (Magnet)</b>";
    gizmoModeBtn.style.background = "#e74c3c";
  } else {
    transformControls.setMode(tool);
    transformControls.enabled = true;
    if (store.selectedBlocks.size > 0) updateSelection(null, true); // re-attach gizmo
    gizmoModeBtn.textContent =
      tool === "rotate" ? "Gizmo: ROTATE" : "Gizmo: TRANSLATE";
    gizmoModeBtn.style.background = tool === "rotate" ? "#3b5945" : "#466b53";
  }
  invalidate();
}

gizmoModeBtn.addEventListener("click", () => {
  const next = {
    translate: "rotate",
    rotate: "osnap",
    osnap: "translate",
  } as const;
  setTool(next[store.activeTool]);
});

function cancelVertexDrag(): void {
  store.isVertexDragging = false;
  orbitControls.enabled = true;
  store.selectedBlocks.forEach((mesh) => {
    const orig = store.dragOffsets.get(mesh);
    if (orig) mesh.position.copy(orig);
  });
  snapMarker.visible = false;
  updatePropertiesUI();
}

function endVertexDrag(): void {
  store.isVertexDragging = false;
  orbitControls.enabled = true;
  afterLayoutChange();
}

// ─────────────────────────────────────────────────────────────────────────────
// KEYBOARD
// ─────────────────────────────────────────────────────────────────────────────

window.addEventListener("keydown", (e) => {
  if (e.key === "Alt") store.isAltDown = true;
  const mod = e.metaKey || e.ctrlKey;
  const typing = isTyping(e.target);

  // Ctrl/Cmd + D → OSNAP tool
  if (mod && e.key.toLowerCase() === "d" && !typing) {
    e.preventDefault();
    if (!store.isVertexDragging) setTool("osnap");
    return;
  }

  // Ctrl/Cmd + Z → undo (leave native undo alone inside form fields)
  if (mod && e.key.toLowerCase() === "z" && !typing) {
    e.preventDefault();
    if (store.isVertexDragging) cancelVertexDrag();
    undo({
      onSelectionCleared: () => updateSelection(null, false),
      onRestored: afterLayoutChange,
    });
    return;
  }

  if (e.key === "Escape") {
    hideContextMenu();
    if (store.isVertexDragging) {
      cancelVertexDrag();
    } else {
      store.isPlacementMode = false;
      updateModeUI();
      updateSelection(null, false);
    }
    return;
  }

  if (
    (e.key === "Delete" || e.key === "Backspace") &&
    !typing &&
    !store.isPlacementMode &&
    store.selectedBlocks.size > 0
  ) {
    e.preventDefault();
    saveState();
    const toDelete = Array.from(store.selectedBlocks);
    updateSelection(null, false); // returns grouped meshes to the scene first
    removeModules(toDelete);
    updatePropertiesUI();
    afterLayoutChange();
  }
});

window.addEventListener("keyup", (e) => {
  if (e.key === "Alt") store.isAltDown = false;
});
window.addEventListener("blur", () => {
  store.isAltDown = false;
});
window.addEventListener("pointerdown", (e) => {
  if (e.button === 0 && !(e.target as HTMLElement).closest("#context-menu"))
    hideContextMenu();
});

// OSNAP checkboxes
(
  [
    ["osnap-end", "end"],
    ["osnap-mid", "mid"],
    ["osnap-int", "int"],
    ["osnap-perp", "perp"],
    ["osnap-near", "near"],
    ["osnap-cen", "center"],
  ] as const
).forEach(([id, key]) => {
  document.getElementById(id)?.addEventListener("change", (e) => {
    osnap[key] = (e.target as HTMLInputElement).checked;
  });
});

const snapInput = document.getElementById(
  "global-snap-input",
) as HTMLInputElement;
snapInput.addEventListener("change", () => {
  const v = parseFloat(snapInput.value);
  store.globalSnap = v > 0 ? v : 0.1;
  transformControls.setTranslationSnap(store.globalSnap);
});

(
  document.getElementById("trackpad-toggle") as HTMLInputElement | null
)?.addEventListener("change", (e) =>
  viewer.setTrackpadMode((e.target as HTMLInputElement).checked),
);

// ─────────────────────────────────────────────────────────────────────────────
// POINTER MOVE — OSNAP PREVIEW / VERTEX DRAG
// ─────────────────────────────────────────────────────────────────────────────

canvas.addEventListener("pointermove", (event) => {
  if (store.activeTool !== "osnap" || store.selectedBlocks.size === 0) {
    snapMarker.visible = false;
    return;
  }

  const targets = store.isVertexDragging
    ? store.placedBlocks
        .filter((b) => !store.selectedBlocks.has(b.mesh))
        .map((b) => b.mesh)
    : Array.from(store.selectedBlocks);

  const snap = performOsnap(
    viewer.raycasterFromEvent(event),
    targets,
    viewer.camera,
    store.isPlanView,
    cameraOrtho,
    orbitControls.target,
  );
  if (!snap) {
    snapMarker.visible = false;
    return;
  }

  snapMarker.position.copy(snap.point);
  applySnapMarkerColor(snapMarker, snap.type);
  snapMarker.visible = true;

  if (store.isVertexDragging && store.snapStartVertex) {
    const delta = snap.point.clone().sub(store.snapStartVertex);
    store.selectedBlocks.forEach((mesh) => {
      const orig = store.dragOffsets.get(mesh);
      if (orig) mesh.position.copy(orig).add(delta);
    });
    updatePropertiesUI();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POINTER DOWN — SELECTION / PLACEMENT / OSNAP DRAG START
// ─────────────────────────────────────────────────────────────────────────────

const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const round3 = (v: number) => Math.round(v * 1000) / 1000;

canvas.addEventListener("pointerdown", (event) => {
  store.dragStartX = event.clientX;
  store.dragStartY = event.clientY;
  store.dragStartTime = Date.now();
  store.clickedAxis = transformControls.axis;

  if (event.button !== 0 || transformControls.axis) return;
  const raycaster = viewer.raycasterFromEvent(event);

  // ── OSNAP vertex drag start / end (click-move-click) ──────────────────────
  if (
    !store.isPlacementMode &&
    store.activeTool === "osnap" &&
    store.selectedBlocks.size > 0
  ) {
    if (store.isVertexDragging) {
      endVertexDrag();
      return;
    }

    const snap = performOsnap(
      raycaster,
      Array.from(store.selectedBlocks),
      viewer.camera,
      store.isPlanView,
      cameraOrtho,
      orbitControls.target,
    );
    if (snap) {
      saveState();
      if (store.isAltDown) selectOnly(duplicateModules(store.selectedBlocks)); // Alt = copy
      store.isVertexDragging = true;
      orbitControls.enabled = false;
      store.snapStartVertex = snap.point;
      store.dragOffsets.clear();
      store.selectedBlocks.forEach((b) =>
        store.dragOffsets.set(b, b.position.clone()),
      );
      return;
    }
  }

  // ── Selection ─────────────────────────────────────────────────────────────
  if (!store.isPlacementMode) {
    const hits = raycaster.intersectObjects(allMeshes(), false);
    updateSelection(
      hits.length > 0 ? (hits[0].object as THREE.Mesh) : null,
      event.shiftKey || event.metaKey,
    );
    return;
  }

  // ── Placement ─────────────────────────────────────────────────────────────
  const typeKey = selectEl.value;
  const blueprint = blueprints[typeKey];
  if (!blueprint) return;

  const geom = blueprint.geometry;
  if (!geom.boundingBox) geom.computeBoundingBox();
  const newSize = geom.boundingBox!.getSize(new THREE.Vector3());
  if (blueprint.group === "corridor")
    newSize.set(newSize.z, newSize.y, newSize.x);

  let spawnPos: THREE.Vector3 | null = null;
  const blockHits = raycaster.intersectObjects(allMeshes(), false);

  if (blockHits.length > 0 && blockHits[0].face) {
    // Snap next to the clicked face of an existing module
    const hit = blockHits[0];
    const target = hit.object as THREE.Mesh;
    const normal = hit
      .face!.normal.clone()
      .transformDirection(target.matrixWorld);
    const targetSize = new THREE.Box3()
      .setFromObject(target)
      .getSize(new THREE.Vector3());
    spawnPos = target
      .getWorldPosition(new THREE.Vector3())
      .add(
        new THREE.Vector3(
          (normal.x * (targetSize.x + newSize.x)) / 2,
          (normal.y * (targetSize.y + newSize.y)) / 2,
          (normal.z * (targetSize.z + newSize.z)) / 2,
        ),
      );
  } else if (blockHits.length === 0) {
    const p = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(floorPlane, p)) {
      const s = store.globalSnap;
      spawnPos = new THREE.Vector3(
        Math.round(p.x / s) * s,
        newSize.y / 2,
        Math.round(p.z / s) * s,
      );
    }
  }
  if (!spawnPos) return;

  saveState();
  createModule({
    typeKey,
    position: new THREE.Vector3(
      round3(spawnPos.x),
      round3(spawnPos.y),
      round3(spawnPos.z),
    ),
    rotation: new THREE.Euler(
      0,
      blueprint.group === "corridor" ? Math.PI / 2 : 0,
      0,
    ),
  });
  afterLayoutChange();
});

// ─────────────────────────────────────────────────────────────────────────────
// POINTER UP — CONTEXT MENU / OSNAP DRAG END / AXIS OFFSET PROMPT
// ─────────────────────────────────────────────────────────────────────────────

canvas.addEventListener("pointerup", (event) => {
  const deltaX = Math.abs(event.clientX - store.dragStartX);
  const deltaY = Math.abs(event.clientY - store.dragStartY);
  const elapsed = Date.now() - store.dragStartTime;

  // Right-click (no drag) → context menu
  if (event.button === 2) {
    if (deltaX < 10 && deltaY < 10 && elapsed < 250 && !store.isPlacementMode) {
      const hits = viewer
        .raycasterFromEvent(event)
        .intersectObjects(allMeshes(), false);
      if (hits.length > 0) {
        const clicked = hits[0].object as THREE.Mesh;
        if (!store.selectedBlocks.has(clicked)) updateSelection(clicked, false);
        contextMenu.style.display = "flex";
        contextMenu.style.left = `${event.clientX}px`;
        contextMenu.style.top = `${event.clientY}px`;
      } else {
        hideContextMenu();
      }
    }
    return;
  }
  if (event.button !== 0) return;

  // Press-drag-release vertex move
  if (store.isVertexDragging) {
    if (deltaX >= 5 || deltaY >= 5) endVertexDrag();
    return;
  }

  // Click on a gizmo axis → numeric offset
  const axis = store.clickedAxis;
  store.clickedAxis = null;
  if (
    deltaX < 5 &&
    deltaY < 5 &&
    (axis === "X" || axis === "Y" || axis === "Z") &&
    store.selectedBlocks.size > 0
  ) {
    setTimeout(() => {
      const isRotate = transformControls.mode === "rotate";
      const input = window.prompt(
        `Offset along ${axis} axis (${isRotate ? "degrees" : "meters"}):`,
        "0",
      );
      const val = input === null ? NaN : parseFloat(input);
      if (Number.isNaN(val)) return;
      saveState();
      const k = axis.toLowerCase() as "x" | "y" | "z";
      const target =
        store.selectedBlocks.size === 1
          ? Array.from(store.selectedBlocks)[0]
          : transformGroup;
      if (isRotate) target.rotation[k] += THREE.MathUtils.degToRad(val);
      else target.position[k] = round3(target.position[k] + val);
      updatePropertiesUI();
      afterLayoutChange();
    }, 10);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// TRANSFORM CONTROLS
// ─────────────────────────────────────────────────────────────────────────────

transformControls.addEventListener("dragging-changed", (event) => {
  const dragging = event.value as boolean;
  orbitControls.enabled = !dragging;

  if (dragging) {
    saveState(); // every gizmo drag is undoable
    // Alt-drag leaves a copy behind at the original position
    if (store.isAltDown && store.selectedBlocks.size > 0)
      duplicateModules(store.selectedBlocks);
  } else {
    afterLayoutChange(); // full recalculation once, on drop
  }
});

// During a drag only the cheap properties panel updates every frame
transformControls.addEventListener("objectChange", () => {
  updatePropertiesUI();
  scheduleCostUpdate();
});

// ─────────────────────────────────────────────────────────────────────────────
// TOOLBAR
// ─────────────────────────────────────────────────────────────────────────────

const modeSelectBtn = document.getElementById("mode-select-btn")!;
const modeBuildBtn = document.getElementById("mode-build-btn")!;

function updateModeUI(): void {
  modeBuildBtn.style.background = store.isPlacementMode ? "#629270" : "#3c5444";
  modeSelectBtn.style.background = store.isPlacementMode
    ? "#3c5444"
    : "#629270";
}
updateModeUI();
modeSelectBtn.addEventListener("click", () => {
  store.isPlacementMode = false;
  updateModeUI();
});
modeBuildBtn.addEventListener("click", () => {
  store.isPlacementMode = true;
  updateSelection(null, false);
  updateModeUI();
});

const viewModeBtn = document.getElementById("view-mode-btn")!;
viewModeBtn.addEventListener("click", () => {
  viewer.setPlanView(!store.isPlanView);
  viewModeBtn.textContent = store.isPlanView
    ? "3D Perspective"
    : "2D Plan View";
  viewModeBtn.style.background = store.isPlanView ? "#f39c12" : "#52795f";
});

document
  .getElementById("zoom-extents-btn")!
  .addEventListener("click", () => viewer.zoomExtents(allMeshes()));

(
  document.getElementById("ao-toggle") as HTMLInputElement | null
)?.addEventListener("change", (e) =>
  viewer.setAmbientOcclusion((e.target as HTMLInputElement).checked),
);

(["elec", "roof", "orient", "links"] as const).forEach((mode) => {
  document.getElementById(`qc-${mode}-btn`)?.addEventListener("click", () => {
    store.activeQC = store.activeQC === mode ? "none" : mode;
    refreshQCColors();
    refreshSelection(); // re-apply selection highlight on restored materials
  });
});

const feeBtn = document.getElementById("toggle-fee-btn")!;
const feePanel = document.getElementById("fee-panel")!;
feeBtn.addEventListener("click", () => {
  const visible = feePanel.style.display !== "none";
  feePanel.style.display = visible ? "none" : "block";
  feeBtn.textContent = visible ? "Show Project Fee" : "Hide Project Fee";
});

// ─────────────────────────────────────────────────────────────────────────────
// FILES
// ─────────────────────────────────────────────────────────────────────────────

document.getElementById("save-btn")!.addEventListener("click", async () => {
  updateSelection(null, false);
  await saveProject();
});

const loadInput = document.getElementById(
  "load-file-input",
) as HTMLInputElement;
document
  .getElementById("load-btn")!
  .addEventListener("click", () => loadInput.click());
loadInput.addEventListener("change", () => {
  const file = loadInput.files?.[0];
  if (!file) return;
  updateSelection(null, false);
  loadProject(file, {
    onRestored: () => {
      updatePropertiesUI();
      afterLayoutChange();
      viewer.zoomExtents(allMeshes());
    },
  });
  loadInput.value = "";
});

document.getElementById("export-csv-btn")!.addEventListener("click", exportCSV);
document
  .getElementById("export-gltf-btn")!
  .addEventListener("click", exportGLTF);
document.getElementById("export-ifc-btn")!.addEventListener("click", () => {
  alert(
    "IFC export is not available yet. It will use the detailed Archicad modules once detailed mode is in place.",
  );
});

// Initial state
afterLayoutChange();
