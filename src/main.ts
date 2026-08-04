import * as THREE from "three";
import * as OBC from "@thatopen/components";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";

// ── Data ──────────────────────────────────────────────────────────────────────
import { blueprints, electricalKits, roofKits } from "./data";

// ── State ─────────────────────────────────────────────────────────────────────
import { store } from "./store";

// ── Modules ───────────────────────────────────────────────────────────────────
import { applyModuleStyle } from "./modules/moduleStyle";
import { saveState, undo } from "./modules/history";

// ── Tools ─────────────────────────────────────────────────────────────────────
import {
  osnap,
  applySnapMarkerColor,
  performOsnap,
} from "./tools/osnapTool";
import { initSelectionManager, updateSelection } from "./tools/selectionManager";

// ── QC ────────────────────────────────────────────────────────────────────────
import { initQCManager, refreshQCColors } from "./qc/qcManager";

// ── BOM ───────────────────────────────────────────────────────────────────────
import { updateCostUI } from "./bom/bomCalculator";
import { saveProject, loadProject, exportCSV, exportGLTF } from "./bom/exporters";

// ── UI ────────────────────────────────────────────────────────────────────────
import { updatePropertiesUI, initPropertiesPanel, elecSelect, roofSelect } from "./ui/propertiesPanel";

// ─────────────────────────────────────────────────────────────────────────────
// SCENE SETUP
// ─────────────────────────────────────────────────────────────────────────────

const container = document.getElementById("app-container");
if (!container) throw new Error("Missing container");

const scene = new THREE.Scene();
scene.fog   = new THREE.FogExp2(0x111111, 0.004);

const initialWidth  = container.clientWidth  || 800;
const initialHeight = container.clientHeight || 600;
const aspect        = initialWidth / initialHeight;

// ── Cameras ───────────────────────────────────────────────────────────────────

const cameraPerspective = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
cameraPerspective.position.set(15, 15, 15);

const viewSize  = 30;
const cameraOrtho = new THREE.OrthographicCamera(
  -viewSize * aspect / 2, viewSize * aspect / 2,
   viewSize / 2,          -viewSize / 2,
  0.1, 1000,
);
cameraOrtho.position.set(0, 50, 0);
cameraOrtho.lookAt(0, 0, 0);

let activeCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera = cameraPerspective;

// ── Renderer ──────────────────────────────────────────────────────────────────

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(initialWidth, initialHeight);
renderer.setClearColor(0x000000, 0);
renderer.shadowMap.enabled  = true;
renderer.shadowMap.type     = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

const components = new OBC.Components();
components.init();

// ── Orbit Controls ────────────────────────────────────────────────────────────

const orbitControls = new OrbitControls(activeCamera, renderer.domElement);
orbitControls.enableDamping  = true;
orbitControls.dampingFactor  = 0.05;
orbitControls.enableZoom     = false;
orbitControls.mouseButtons   = { LEFT: null as any, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };

const updateOrbitMode = (event: MouseEvent | KeyboardEvent | PointerEvent) => {
  orbitControls.mouseButtons.MIDDLE =
    event.shiftKey || event.metaKey || event.ctrlKey ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
};

renderer.domElement.addEventListener("pointerdown", updateOrbitMode, { capture: true });
renderer.domElement.addEventListener("contextmenu", (e) => e.preventDefault());

// ── Trackpad toggle ───────────────────────────────────────────────────────────

let isTrackpadMode = false;
const trackpadToggle = document.getElementById("trackpad-toggle") as HTMLInputElement | null;
trackpadToggle?.addEventListener("change", (e) => {
  isTrackpadMode = (e.target as HTMLInputElement).checked;
});

// ── Wheel / Zoom ──────────────────────────────────────────────────────────────

renderer.domElement.addEventListener("wheel", (event) => {
  event.preventDefault();
  event.stopImmediatePropagation();

  if (isTrackpadMode && !event.ctrlKey && !event.metaKey && !store.isPlanView) {
    if (event.shiftKey) {
      const panX  = event.deltaX * 0.015;
      const panY  = event.deltaY * 0.015;
      const right = new THREE.Vector3().setFromMatrixColumn(activeCamera.matrix, 0);
      const up    = new THREE.Vector3().setFromMatrixColumn(activeCamera.matrix, 1);
      activeCamera.position.addScaledVector(right, panX);
      activeCamera.position.addScaledVector(up, -panY);
      orbitControls.target.addScaledVector(right, panX);
      orbitControls.target.addScaledVector(up, -panY);
    } else {
      const theta    = event.deltaX * 0.005;
      const phi      = event.deltaY * 0.005;
      const offset   = new THREE.Vector3().copy(activeCamera.position).sub(orbitControls.target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      spherical.theta += theta;
      spherical.phi    = Math.max(0.01, Math.min(Math.PI - 0.01, spherical.phi + phi));
      offset.setFromSpherical(spherical);
      activeCamera.position.copy(orbitControls.target).add(offset);
      activeCamera.lookAt(orbitControls.target);
    }
    orbitControls.update();
    return;
  }

  if (store.isPlanView) {
    const rect             = renderer.domElement.getBoundingClientRect();
    const mouse            = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    const mouseWorldBefore = new THREE.Vector3(mouse.x, mouse.y, 0).unproject(cameraOrtho);
    const zoomFactor       = event.deltaY * 0.001;
    cameraOrtho.zoom = Math.max(0.1, cameraOrtho.zoom - zoomFactor);
    cameraOrtho.updateProjectionMatrix();
    const delta = mouseWorldBefore.sub(new THREE.Vector3(mouse.x, mouse.y, 0).unproject(cameraOrtho));
    cameraOrtho.position.add(delta);
    orbitControls.target.add(delta);
    orbitControls.update();
    return;
  }

  if (!isTrackpadMode && event.shiftKey) {
    const panSpeed = 0.05;
    const right    = new THREE.Vector3().setFromMatrixColumn(activeCamera.matrix, 0);
    const up       = new THREE.Vector3().setFromMatrixColumn(activeCamera.matrix, 1);
    activeCamera.position.addScaledVector(right, event.deltaX * panSpeed);
    activeCamera.position.addScaledVector(up,   -event.deltaY * panSpeed);
    orbitControls.target.addScaledVector(right, event.deltaX * panSpeed);
    orbitControls.target.addScaledVector(up,   -event.deltaY * panSpeed);
    orbitControls.update();
    return;
  }

  const rect       = renderer.domElement.getBoundingClientRect();
  const mouse      = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  const raycaster  = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, activeCamera);
  const intersects = raycaster.intersectObjects(store.placedBlocks.map((b) => b.mesh), false);
  const zoomTarget = new THREE.Vector3();

  if (intersects.length > 0) {
    zoomTarget.copy(intersects[0].point);
  } else {
    const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    if (!raycaster.ray.intersectPlane(floorPlane, zoomTarget))
      raycaster.ray.at(activeCamera.position.distanceTo(orbitControls.target), zoomTarget);
  }

  const zoomFactor = Math.max(Math.min(-event.deltaY * 0.0015, 0.25), -0.25);
  const dist       = activeCamera.position.distanceTo(orbitControls.target);
  if (zoomFactor > 0 && dist < 1.0)   return;
  if (zoomFactor < 0 && dist > 200)   return;

  activeCamera.position.addScaledVector(new THREE.Vector3().subVectors(zoomTarget, activeCamera.position), zoomFactor);
  orbitControls.target.addScaledVector(new THREE.Vector3().subVectors(zoomTarget, orbitControls.target), zoomFactor);
  orbitControls.update();
}, { capture: true, passive: false });

// ── Lighting ──────────────────────────────────────────────────────────────────

scene.add(new THREE.AmbientLight(0xffffff, 0.6));

const hemiLight = new THREE.HemisphereLight(0xffffff, 0x888888, 0.8);
hemiLight.position.set(0, 50, 0);
scene.add(hemiLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(20, 40, 20);
dirLight.castShadow             = true;
dirLight.shadow.mapSize.width   = 2048;
dirLight.shadow.mapSize.height  = 2048;
dirLight.shadow.camera.near     = 0.5;
dirLight.shadow.camera.far      = 150;
dirLight.shadow.camera.left     = -40; dirLight.shadow.camera.right  = 40;
dirLight.shadow.camera.top      =  40; dirLight.shadow.camera.bottom = -40;
dirLight.shadow.bias            = -0.0005;
scene.add(dirLight);

scene.add(new THREE.GridHelper(80, 80, "#444444", "#222222"));

const shadowFloor = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.ShadowMaterial({ opacity: 0.6 }),
);
shadowFloor.rotation.x    = -Math.PI / 2;
shadowFloor.position.y    = -0.01;
shadowFloor.receiveShadow = true;
scene.add(shadowFloor);

// ── Transform Controls ────────────────────────────────────────────────────────

const transformGroup    = new THREE.Group();
scene.add(transformGroup);

const transformControls = new TransformControls(activeCamera, renderer.domElement);
transformControls.setTranslationSnap(store.globalSnap);
transformControls.setRotationSnap(THREE.MathUtils.degToRad(15));
scene.add(transformControls.getHelper());

// ── Snap Marker ───────────────────────────────────────────────────────────────

const snapMarker = new THREE.Mesh(
  new THREE.SphereGeometry(0.12),
  new THREE.MeshBasicMaterial({ color: 0xff0000, depthTest: false }),
);
scene.add(snapMarker);
snapMarker.visible = false;

// ── Module Inits ──────────────────────────────────────────────────────────────

initQCManager(scene);
initSelectionManager({ scene, transformControls, transformGroup });
initPropertiesPanel({
  onSaveState:  saveState,
  onCostUpdate: updateCostUI,
  onQCRefresh:  refreshQCColors,
});

// ─────────────────────────────────────────────────────────────────────────────
// CONTEXT MENU + MODULE SELECT POPULATION
// ─────────────────────────────────────────────────────────────────────────────

const contextMenu = document.getElementById("context-menu") as HTMLDivElement;
const selectEl    = document.getElementById("block-type-select") as HTMLSelectElement;

// Populate electrical / roof selects
Object.entries(electricalKits).forEach(([key, kit]) => {
  const opt = document.createElement("option");
  opt.value = key; opt.innerText = kit.name;
  elecSelect.appendChild(opt);
});
Object.entries(roofKits).forEach(([key, kit]) => {
  const opt = document.createElement("option");
  opt.value = key; opt.innerText = kit.name;
  roofSelect.appendChild(opt);
});

// Context menu action buttons
const duplicateBtn = document.createElement("button");
duplicateBtn.innerHTML = `<span style="color:#2ecc71;font-weight:bold">⧉ Duplicate Module(s)</span>`;
contextMenu.appendChild(duplicateBtn);

const rot90Btn = document.createElement("button");
rot90Btn.innerHTML = `<span style="color:#3498db;font-weight:bold">⤾ Rotate +90°</span>`;
contextMenu.appendChild(rot90Btn);

const rot180Btn = document.createElement("button");
rot180Btn.innerHTML = `<span style="color:#e67e22;font-weight:bold">↻ Rotate 180°</span>`;
contextMenu.appendChild(rot180Btn);

contextMenu.appendChild(document.createElement("hr"));

// Populate block type select + context menu swap buttons
const menuGroups: Record<string, { key: string; color: string; name: string }[]> = {};
for (const [key, data] of Object.entries(blueprints)) {
  if (!menuGroups[data.menuGroup]) menuGroups[data.menuGroup] = [];
  menuGroups[data.menuGroup].push({ key, color: data.color, name: data.name });
}
for (const [groupName, items] of Object.entries(menuGroups)) {
  const optGroup  = document.createElement("optgroup");
  optGroup.label  = groupName;
  const ctxHeader = document.createElement("div");
  ctxHeader.className = "menu-header";
  ctxHeader.innerText = groupName;
  contextMenu.appendChild(ctxHeader);
  items.forEach((item) => {
    const opt = document.createElement("option");
    opt.value = item.key; opt.innerText = item.name;
    optGroup.appendChild(opt);
    const btn = document.createElement("button");
    btn.setAttribute("data-type", item.key);
    btn.innerHTML = `<span style="color:${item.color}">■</span> Swap to ${item.name}`;
    contextMenu.appendChild(btn);
  });
  selectEl.appendChild(optGroup);
}

// Context menu pointer handler
contextMenu.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  const btn = (e.target as HTMLElement).closest("button") as HTMLButtonElement | null;
  if (!btn) return;
  e.stopPropagation();

  if (btn.hasAttribute("data-type")) {
    if (store.selectedBlocks.size === 0) return;
    saveState();
    const newType      = btn.getAttribute("data-type")!;
    const oldSelection = Array.from(store.selectedBlocks);
    updateSelection(null, false);
    oldSelection.forEach((mesh) => {
      const bData = store.placedBlocks.find((b) => b.mesh === mesh);
      if (bData) bData.typeKey = newType;
      applyModuleStyle(mesh, newType);
    });
    oldSelection.forEach((m) => updateSelection(m, true));
    contextMenu.style.display = "none";
    updateCostUI(); refreshQCColors();

  } else if (btn === duplicateBtn) {
    if (store.selectedBlocks.size === 0) return;
    saveState();
    const newSel: THREE.Mesh[] = [];
    store.selectedBlocks.forEach((mesh) => {
      const bData = store.placedBlocks.find((b) => b.mesh === mesh);
      if (!bData) return;
      const clone = new THREE.Mesh();
      applyModuleStyle(clone, bData.typeKey);
      mesh.getWorldPosition(clone.position);
      mesh.getWorldQuaternion(clone.quaternion);
      clone.position.x += store.globalSnap; clone.position.z += store.globalSnap;
      clone.castShadow = true; clone.receiveShadow = true;
      scene.add(clone);
      store.placedBlocks.push({ id: crypto.randomUUID(), typeKey: bData.typeKey, elecKey: bData.elecKey, roofKey: bData.roofKey, mesh: clone });
      newSel.push(clone);
    });
    updateSelection(null, false);
    newSel.forEach((m) => updateSelection(m, true));
    updateCostUI(); refreshQCColors();
    contextMenu.style.display = "none";

  } else if (btn === rot90Btn || btn === rot180Btn) {
    if (store.selectedBlocks.size === 0) return;
    saveState();
    const angle = btn === rot90Btn ? Math.PI / 2 : Math.PI;
    store.selectedBlocks.forEach((mesh) => { mesh.rotation.y += angle; mesh.updateMatrix(); });
    updatePropertiesUI(); updateCostUI(); refreshQCColors();
    contextMenu.style.display = "none";
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// KEYBOARD & POINTER EVENTS
// ─────────────────────────────────────────────────────────────────────────────

window.addEventListener("keydown", (e) => {
  if (e.key === "Alt") store.isAltDown = true;
  updateOrbitMode(e);

  // Ctrl/Cmd + D → switch to OSNAP tool
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "d") {
    e.preventDefault();
    if (store.isVertexDragging) return;
    store.activeTool = "osnap";
    transformControls.detach();
    const btn = document.getElementById("gizmo-mode-btn")!;
    btn.innerHTML = "<b>Tool: OSNAP (Magnet)</b>";
    btn.style.background = "#e74c3c";
    return;
  }

  // Ctrl/Cmd + Z → undo
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
    e.preventDefault();
    undo({
      scene,
      onSelectionCleared: () => updateSelection(null, false),
      onRestored:         () => { refreshQCColors(); updateCostUI(); },
    });
    return;
  }

  // Escape
  if (e.key === "Escape") {
    contextMenu.style.display = "none";
    if (store.isVertexDragging) {
      store.isVertexDragging = false;
      orbitControls.enabled  = true;
      store.selectedBlocks.forEach((mesh) => {
        const orig = store.dragOffsets.get(mesh);
        if (orig) { mesh.position.copy(orig); mesh.updateMatrix(); }
      });
      updatePropertiesUI();
      snapMarker.visible = false;
    } else {
      store.isPlacementMode = false;
      updateModeUI();
      updateSelection(null, false);
    }
    return;
  }

  // Delete / Backspace
  if ((e.key === "Delete" || e.key === "Backspace") && !store.isPlacementMode && store.selectedBlocks.size > 0) {
    if ((document.activeElement as HTMLElement)?.tagName === "INPUT") return;
    saveState();
    const toDelete = Array.from(store.selectedBlocks);
    updateSelection(null, false);
    toDelete.forEach((mesh) => {
      scene.remove(mesh);
      const idx = store.placedBlocks.findIndex((b) => b.mesh === mesh);
      if (idx !== -1) store.placedBlocks.splice(idx, 1);
      if (mesh.geometry) mesh.geometry.dispose();
      if (mesh.material) {
        if (Array.isArray(mesh.material)) mesh.material.forEach((m) => m.dispose());
        else (mesh.material as THREE.Material).dispose();
      }
    });
    updateCostUI(); updatePropertiesUI(); refreshQCColors();
  }
});

window.addEventListener("keyup",  (e) => { if (e.key === "Alt") store.isAltDown = false; updateOrbitMode(e); });
window.addEventListener("blur",   ()  => { store.isAltDown = false; orbitControls.mouseButtons.MIDDLE = THREE.MOUSE.PAN; });
window.addEventListener("pointerdown", (event) => {
  if (event.button === 0 && !(event.target as HTMLElement).closest("#context-menu"))
    contextMenu.style.display = "none";
});

// OSNAP checkbox wiring
document.getElementById("osnap-end")!.addEventListener("change",  (e) => osnap.end    = (e.target as HTMLInputElement).checked);
document.getElementById("osnap-mid")!.addEventListener("change",  (e) => osnap.mid    = (e.target as HTMLInputElement).checked);
document.getElementById("osnap-int")!.addEventListener("change",  (e) => osnap.int    = (e.target as HTMLInputElement).checked);
document.getElementById("osnap-perp")!.addEventListener("change", (e) => osnap.perp   = (e.target as HTMLInputElement).checked);
document.getElementById("osnap-near")!.addEventListener("change", (e) => osnap.near   = (e.target as HTMLInputElement).checked);
document.getElementById("osnap-cen")!.addEventListener("change",  (e) => osnap.center = (e.target as HTMLInputElement).checked);

// Snap input
const snapInput = document.getElementById("global-snap-input") as HTMLInputElement;
snapInput.addEventListener("change", (e) => {
  store.globalSnap = parseFloat((e.target as HTMLInputElement).value) || 0.1;
  transformControls.setTranslationSnap(store.globalSnap);
});

// ─────────────────────────────────────────────────────────────────────────────
// POINTER MOVE — OSNAP PREVIEW
// ─────────────────────────────────────────────────────────────────────────────

renderer.domElement.addEventListener("pointermove", (event) => {
  if (store.activeTool !== "osnap" || store.selectedBlocks.size === 0) {
    snapMarker.visible = false;
    return;
  }

  const rect      = renderer.domElement.getBoundingClientRect();
  const mouse     = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, activeCamera);

  const targets = store.isVertexDragging
    ? store.placedBlocks.filter((b) => !store.selectedBlocks.has(b.mesh)).map((b) => b.mesh)
    : Array.from(store.selectedBlocks);

  const snap = performOsnap(raycaster, targets, activeCamera, store.isPlanView, cameraOrtho, orbitControls.target);
  if (snap) {
    snapMarker.position.copy(snap.point);
    applySnapMarkerColor(snapMarker, snap.type);
    snapMarker.visible = true;

    if (store.isVertexDragging) {
      const delta = snapMarker.position.clone().sub(store.snapStartVertex!);
      store.selectedBlocks.forEach((mesh) => {
        const orig = store.dragOffsets.get(mesh);
        if (orig) { mesh.position.copy(orig).add(delta); mesh.updateMatrix(); }
      });
      updatePropertiesUI();
    }
  } else {
    snapMarker.visible = false;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POINTER DOWN — SELECTION + PLACEMENT + OSNAP DRAG START
// ─────────────────────────────────────────────────────────────────────────────

renderer.domElement.addEventListener("pointerdown", (event) => {
  store.dragStartX    = event.clientX;
  store.dragStartY    = event.clientY;
  store.dragStartTime = Date.now();
  store.clickedAxis   = transformControls.axis;

  if (event.button !== 0 || transformControls.axis) return;

  const rect      = renderer.domElement.getBoundingClientRect();
  const mouse     = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, activeCamera);

  // ── OSNAP vertex drag start ────────────────────────────────────────────────
  if (!store.isPlacementMode && store.activeTool === "osnap" && store.selectedBlocks.size > 0) {
    if (store.isVertexDragging) {
      store.isVertexDragging = false;
      orbitControls.enabled  = true;
      updateCostUI(); refreshQCColors();
      return;
    }
    const snap = performOsnap(raycaster, Array.from(store.selectedBlocks), activeCamera, store.isPlanView, cameraOrtho, orbitControls.target);
    if (snap) {
      saveState();
      if (store.isAltDown) {
        const newSel: THREE.Mesh[] = [];
        store.selectedBlocks.forEach((mesh) => {
          const bData = store.placedBlocks.find((b) => b.mesh === mesh);
          if (!bData) return;
          const clone = new THREE.Mesh();
          applyModuleStyle(clone, bData.typeKey);
          mesh.getWorldPosition(clone.position);
          mesh.getWorldQuaternion(clone.quaternion);
          clone.castShadow = true; clone.receiveShadow = true;
          scene.add(clone);
          store.placedBlocks.push({ id: crypto.randomUUID(), typeKey: bData.typeKey, elecKey: bData.elecKey, roofKey: bData.roofKey, mesh: clone });
          newSel.push(clone);
        });
        updateSelection(null, false);
        newSel.forEach((m) => updateSelection(m, true));
      }
      store.isVertexDragging = true;
      orbitControls.enabled  = false;
      store.snapStartVertex   = snap.point;
      store.dragOffsets.clear();
      store.selectedBlocks.forEach((b) => store.dragOffsets.set(b, b.position.clone()));
      return;
    }
  }

  // ── Normal selection (no placement) ───────────────────────────────────────
  if (!store.isPlacementMode) {
    const hits = raycaster.intersectObjects(store.placedBlocks.map((b) => b.mesh), false);
    updateSelection(hits.length > 0 ? hits[0].object as THREE.Mesh : null, event.shiftKey || event.metaKey);
    return;
  }

  // ── Placement mode ─────────────────────────────────────────────────────────
  saveState();
  const selectedType = selectEl.value;
  const blueprint    = blueprints[selectedType];

  blueprint.geometry.computeBoundingBox();
  const baseSize = new THREE.Vector3();
  blueprint.geometry.boundingBox!.getSize(baseSize);
  const worldNewSize = baseSize.clone();
  if (blueprint.group === "corridor") worldNewSize.set(baseSize.z, baseSize.y, baseSize.x);

  let spawnPos: THREE.Vector3 | null = null;
  const blockHits = raycaster.intersectObjects(store.placedBlocks.map((b) => b.mesh), false);

  if (blockHits.length > 0) {
    const hit        = blockHits[0];
    if (hit.face) {
      const targetMesh = hit.object as THREE.Mesh;
      const normal     = hit.face.normal.clone().transformDirection(targetMesh.matrixWorld).normalize();
      const targetBox  = new THREE.Box3().setFromObject(targetMesh);
      const targetSize = new THREE.Vector3();
      targetBox.getSize(targetSize);
      spawnPos = targetMesh.position.clone().add(new THREE.Vector3(
        normal.x * ((targetSize.x / 2) + (worldNewSize.x / 2)),
        normal.y * ((targetSize.y / 2) + (worldNewSize.y / 2)),
        normal.z * ((targetSize.z / 2) + (worldNewSize.z / 2)),
      ));
    }
  } else {
    const floorPlane     = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const intersectPoint = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(floorPlane, intersectPoint)) {
      spawnPos = new THREE.Vector3(
        Math.round(intersectPoint.x / store.globalSnap) * store.globalSnap,
        worldNewSize.y / 2,
        Math.round(intersectPoint.z / store.globalSnap) * store.globalSnap,
      );
    }
  }

  if (spawnPos) {
    const blockMesh = new THREE.Mesh();
    applyModuleStyle(blockMesh, selectedType);
    blockMesh.position.set(
      Math.round(spawnPos.x * 1000) / 1000,
      Math.round(spawnPos.y * 1000) / 1000,
      Math.round(spawnPos.z * 1000) / 1000,
    );
    if (blueprint.group === "corridor") { blockMesh.rotation.y = Math.PI / 2; blockMesh.updateMatrix(); }
    blockMesh.castShadow = true; blockMesh.receiveShadow = true;
    scene.add(blockMesh);
    store.placedBlocks.push({ id: crypto.randomUUID(), typeKey: selectedType, mesh: blockMesh });
    updateCostUI(); refreshQCColors();
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POINTER UP — RIGHT-CLICK CONTEXT MENU + AXIS CLICK PROMPT
// ─────────────────────────────────────────────────────────────────────────────

renderer.domElement.addEventListener("pointerup", (event) => {
  const deltaX      = Math.abs(event.clientX - store.dragStartX);
  const deltaY      = Math.abs(event.clientY - store.dragStartY);
  const timeElapsed = Date.now() - store.dragStartTime;

  // Right-click context menu
  if (event.button === 2) {
    if (deltaX < 10 && deltaY < 10 && timeElapsed < 250 && !store.isPlacementMode) {
      const rect      = renderer.domElement.getBoundingClientRect();
      const mouse     = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, activeCamera);
      const hits = raycaster.intersectObjects(store.placedBlocks.map((b) => b.mesh), false);
      if (hits.length > 0) {
        const clicked = hits[0].object as THREE.Mesh;
        if (!store.selectedBlocks.has(clicked)) updateSelection(clicked, false);
        contextMenu.style.display = "flex";
        contextMenu.style.left    = `${event.clientX}px`;
        contextMenu.style.top     = `${event.clientY}px`;
      } else {
        contextMenu.style.display = "none";
      }
    }
    return;
  }

  if (event.button !== 0) return;

  // End vertex drag
  if (store.isVertexDragging) {
    if (deltaX < 5 && deltaY < 5) return;
    store.isVertexDragging = false;
    orbitControls.enabled  = true;
    updateCostUI(); refreshQCColors();
    return;
  }

  // Axis click → numeric offset prompt
  const axisAtClick  = store.clickedAxis;
  store.clickedAxis  = null;
  if (deltaX < 5 && deltaY < 5 && axisAtClick && store.selectedBlocks.size > 0) {
    if (axisAtClick === "X" || axisAtClick === "Y" || axisAtClick === "Z") {
      setTimeout(() => {
        const isRotate = transformControls.mode === "rotate";
        const unit     = isRotate ? "degrees" : "meters";
        const input    = window.prompt(`Offset along ${axisAtClick} axis (${unit}):`, "0");
        if (input !== null) {
          const val = parseFloat(input);
          if (!isNaN(val)) {
            saveState();
            const axisLower = axisAtClick.toLowerCase() as "x" | "y" | "z";
            const target    = store.selectedBlocks.size === 1 ? Array.from(store.selectedBlocks)[0] : transformGroup;
            if (isRotate) target.rotation[axisLower] += THREE.MathUtils.degToRad(val);
            else target.position[axisLower] = Math.round((target.position[axisLower] + val) * 1000) / 1000;
            target.updateMatrix();
            updatePropertiesUI(); updateCostUI(); refreshQCColors();
          }
        }
      }, 10);
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// TRANSFORM CONTROLS EVENTS
// ─────────────────────────────────────────────────────────────────────────────

transformControls.addEventListener("dragging-changed", (event) => {
  orbitControls.enabled = !event.value;
  if (event.value && store.isAltDown && store.selectedBlocks.size > 0) {
    saveState();
    store.selectedBlocks.forEach((mesh) => {
      const bData = store.placedBlocks.find((b) => b.mesh === mesh);
      if (!bData) return;
      const clone = new THREE.Mesh();
      applyModuleStyle(clone, bData.typeKey);
      mesh.getWorldPosition(clone.position);
      mesh.getWorldQuaternion(clone.quaternion);
      clone.castShadow = true; clone.receiveShadow = true;
      scene.add(clone);
      store.placedBlocks.push({ id: crypto.randomUUID(), typeKey: bData.typeKey, elecKey: bData.elecKey, roofKey: bData.roofKey, mesh: clone });
    });
    updateCostUI(); refreshQCColors();
  }
});

transformControls.addEventListener("change", () => { updatePropertiesUI(); updateCostUI(); });

// ─────────────────────────────────────────────────────────────────────────────
// TOOLBAR BUTTONS
// ─────────────────────────────────────────────────────────────────────────────

// Mode buttons (Select / Build)
const modeSelectBtn = document.getElementById("mode-select-btn")!;
const modeBuildBtn  = document.getElementById("mode-build-btn")!;

function updateModeUI(): void {
  modeBuildBtn.style.background  = store.isPlacementMode ? "#629270" : "#3c5444";
  modeSelectBtn.style.background = store.isPlacementMode ? "#3c5444" : "#629270";
}
updateModeUI();
modeSelectBtn.addEventListener("click", () => { store.isPlacementMode = false; updateModeUI(); });
modeBuildBtn.addEventListener("click",  () => { store.isPlacementMode = true; updateSelection(null, false); updateModeUI(); });

// Gizmo mode cycle (Translate → Rotate → OSNAP → Translate…)
const gizmoModeBtn = document.getElementById("gizmo-mode-btn")!;
gizmoModeBtn.addEventListener("click", () => {
  if (store.activeTool === "translate") {
    store.activeTool = "rotate";
    transformControls.setMode("rotate"); transformControls.enabled = true;
    if (store.selectedBlocks.size > 0) updateSelection(null, true);
    gizmoModeBtn.innerText       = "Gizmo: ROTATE";
    gizmoModeBtn.style.background = "#3b5945";
  } else if (store.activeTool === "rotate") {
    store.activeTool = "osnap";
    transformControls.detach();
    gizmoModeBtn.innerHTML       = "<b>Tool: OSNAP (Magnet)</b>";
    gizmoModeBtn.style.background = "#e74c3c";
  } else {
    store.activeTool = "translate";
    transformControls.setMode("translate"); transformControls.enabled = true;
    if (store.selectedBlocks.size > 0) updateSelection(null, true);
    gizmoModeBtn.innerText       = "Gizmo: TRANSLATE";
    gizmoModeBtn.style.background = "#466b53";
  }
});

// View mode (3D ↔ 2D Plan)
const viewModeBtn = document.getElementById("view-mode-btn")!;
viewModeBtn.addEventListener("click", () => {
  store.isPlanView = !store.isPlanView;
  if (store.isPlanView) {
    activeCamera = cameraOrtho;
    cameraOrtho.position.set(orbitControls.target.x, 50, orbitControls.target.z);
    orbitControls.object     = cameraOrtho;
    orbitControls.enableRotate = false;
    viewModeBtn.innerText       = "3D Perspective";
    viewModeBtn.style.background = "#f39c12";
  } else {
    activeCamera = cameraPerspective;
    orbitControls.object     = cameraPerspective;
    orbitControls.enableRotate = true;
    viewModeBtn.innerText       = "2D Plan View";
    viewModeBtn.style.background = "#52795f";
  }
  transformControls.camera = activeCamera;
  orbitControls.update();
});

// Zoom extents
document.getElementById("zoom-extents-btn")!.addEventListener("click", () => {
  if (store.placedBlocks.length === 0) {
    orbitControls.target.set(0, 0, 0);
    if (store.isPlanView) { cameraOrtho.position.set(0, 50, 0); cameraOrtho.zoom = 1; cameraOrtho.updateProjectionMatrix(); }
    else cameraPerspective.position.set(15, 15, 15);
    orbitControls.update();
    return;
  }
  const box = new THREE.Box3();
  store.placedBlocks.forEach((b) => { const mb = new THREE.Box3().setFromObject(b.mesh); box.expandByPoint(mb.min); box.expandByPoint(mb.max); });
  const center = new THREE.Vector3(); box.getCenter(center);
  const size   = new THREE.Vector3(); box.getSize(size);
  const maxDim = Math.max(size.x, size.y, size.z);

  if (store.isPlanView) {
    orbitControls.target.set(center.x, 0, center.z);
    cameraOrtho.position.set(center.x, 50, center.z);
    cameraOrtho.zoom = viewSize / (maxDim * 1.2);
    cameraOrtho.updateProjectionMatrix();
  } else {
    orbitControls.target.copy(center);
    const fov      = cameraPerspective.fov * (Math.PI / 180);
    const dir      = cameraPerspective.position.clone().sub(center).normalize();
    const finalDir = dir.lengthSq() < 0.01 ? new THREE.Vector3(1, 1, 1).normalize() : dir;
    cameraPerspective.position.copy(center).add(finalDir.multiplyScalar(Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.5));
  }
  orbitControls.update();
});

// QC mode toggles
(["elec", "roof", "orient", "links"] as const).forEach((mode) => {
  document.getElementById(`qc-${mode}-btn`)?.addEventListener("click", () => {
    store.activeQC = store.activeQC === mode ? "none" : mode;
    refreshQCColors();
  });
});

// Fee panel toggle
const feeBtn   = document.getElementById("toggle-fee-btn")!;
const feePanel = document.getElementById("fee-panel")!;
feeBtn.addEventListener("click", () => {
  const visible = feePanel.style.display !== "none";
  feePanel.style.display = visible ? "none" : "block";
  feeBtn.innerText       = visible ? "Show Project Fee" : "Hide Project Fee";
});

// ─────────────────────────────────────────────────────────────────────────────
// FILE OPERATIONS
// ─────────────────────────────────────────────────────────────────────────────

document.getElementById("save-btn")!.addEventListener("click", async () => {
  updateSelection(null, false);
  await saveProject();
});

const loadInput = document.getElementById("load-file-input") as HTMLInputElement;
document.getElementById("load-btn")!.addEventListener("click", () => loadInput.click());
loadInput.addEventListener("change", (event) => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  updateSelection(null, false);
  loadProject(file, {
    scene,
    onRestored: () => { updateCostUI(); updatePropertiesUI(); refreshQCColors(); },
  });
  loadInput.value = "";
});

document.getElementById("export-csv-btn")!.addEventListener("click",  exportCSV);
document.getElementById("export-gltf-btn")!.addEventListener("click", exportGLTF);
document.getElementById("export-ifc-btn")!.addEventListener("click",  () => {
  alert("IFC EXPORT UNAVAILABLE: Currently using standard THREE meshes. Web-IFC implementation required for full BIM data export.");
});

// ─────────────────────────────────────────────────────────────────────────────
// ANIMATION LOOP + RESIZE
// ─────────────────────────────────────────────────────────────────────────────

function animate(): void {
  requestAnimationFrame(animate);
  orbitControls.update();
  renderer.render(scene, activeCamera);
}
animate();

function updateSizing(): void {
  if (!container) return;
  const w = container.clientWidth; const h = container.clientHeight;
  if (w === 0 || h === 0) return;
  const a = w / h;
  cameraPerspective.aspect = a; cameraPerspective.updateProjectionMatrix();
  cameraOrtho.left = -viewSize * a / 2; cameraOrtho.right  =  viewSize * a / 2;
  cameraOrtho.top  =  viewSize / 2;     cameraOrtho.bottom = -viewSize / 2;
  cameraOrtho.updateProjectionMatrix();
  renderer.setSize(w, h);
}
window.addEventListener("resize", updateSizing);
setTimeout(updateSizing, 100);