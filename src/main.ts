import * as THREE from "three";
import * as OBC from "@thatopen/components";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { GLTFExporter } from "three/examples/jsm/exporters/GLTFExporter.js";

import bomData from "./bom.json";

const container = document.getElementById("app-container");
if (!container) throw new Error("Missing container");

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x111111, 0.004);

const initialWidth = container.clientWidth || 800;
const initialHeight = container.clientHeight || 600;
const aspect = initialWidth / initialHeight;

const cameraPerspective = new THREE.PerspectiveCamera(60, aspect, 0.1, 1000);
cameraPerspective.position.set(15, 15, 15);

const viewSize = 30;
const cameraOrtho = new THREE.OrthographicCamera(-viewSize * aspect / 2, viewSize * aspect / 2, viewSize / 2, -viewSize / 2, 0.1, 1000);
cameraOrtho.position.set(0, 50, 0);
cameraOrtho.lookAt(0, 0, 0);

let activeCamera: THREE.PerspectiveCamera | THREE.OrthographicCamera = cameraPerspective;
let isPlanView = false;

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setSize(initialWidth, initialHeight);
renderer.setClearColor(0x000000, 0);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);
const components = new OBC.Components();
components.init();

const orbitControls = new OrbitControls(activeCamera, renderer.domElement);
orbitControls.enableDamping = true;
orbitControls.dampingFactor = 0.05;
orbitControls.enableZoom = false;

orbitControls.mouseButtons = { LEFT: null as any, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.ROTATE };

const updateOrbitMode = (event: MouseEvent | KeyboardEvent | PointerEvent) => {
  if (event.shiftKey || event.metaKey || event.ctrlKey) {
    orbitControls.mouseButtons.MIDDLE = THREE.MOUSE.ROTATE;
  } else {
    orbitControls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
  }
};

renderer.domElement.addEventListener("pointerdown", updateOrbitMode, { capture: true });
renderer.domElement.addEventListener("contextmenu", e => e.preventDefault());

let isTrackpadMode = false;
const trackpadToggle = document.getElementById('trackpad-toggle') as HTMLInputElement;
if (trackpadToggle) {
  trackpadToggle.addEventListener('change', (e) => {
    isTrackpadMode = (e.target as HTMLInputElement).checked;
  });
}

renderer.domElement.addEventListener('wheel', (event) => {
  event.preventDefault();
  event.stopImmediatePropagation();

  if (isTrackpadMode && !event.ctrlKey && !event.metaKey && !isPlanView) {
    if (event.shiftKey) {
      const panX = event.deltaX * 0.015;
      const panY = event.deltaY * 0.015;
      const right = new THREE.Vector3().setFromMatrixColumn(activeCamera.matrix, 0);
      const up = new THREE.Vector3().setFromMatrixColumn(activeCamera.matrix, 1);
      activeCamera.position.addScaledVector(right, panX);
      activeCamera.position.addScaledVector(up, -panY);
      orbitControls.target.addScaledVector(right, panX);
      orbitControls.target.addScaledVector(up, -panY);
    } else {
      const theta = event.deltaX * 0.005;
      const phi = event.deltaY * 0.005;
      const offset = new THREE.Vector3().copy(activeCamera.position).sub(orbitControls.target);
      const spherical = new THREE.Spherical().setFromVector3(offset);
      spherical.theta += theta;
      spherical.phi = Math.max(0.01, Math.min(Math.PI - 0.01, spherical.phi + phi));
      offset.setFromSpherical(spherical);
      activeCamera.position.copy(orbitControls.target).add(offset);
      activeCamera.lookAt(orbitControls.target);
    }
    orbitControls.update();
    return;
  }

  if (isPlanView) {
    const rect = renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    const mouseWorldBefore = new THREE.Vector3(mouse.x, mouse.y, 0).unproject(cameraOrtho);

    const zoomFactor = event.deltaY * 0.001;
    cameraOrtho.zoom = Math.max(0.1, cameraOrtho.zoom - zoomFactor);
    cameraOrtho.updateProjectionMatrix();

    const mouseWorldAfter = new THREE.Vector3(mouse.x, mouse.y, 0).unproject(cameraOrtho);
    const delta = mouseWorldBefore.sub(mouseWorldAfter);

    cameraOrtho.position.add(delta);
    orbitControls.target.add(delta);
    orbitControls.update();
    return;
  }

  if (!isTrackpadMode && event.shiftKey) {
    const panSpeed = 0.05;
    const right = new THREE.Vector3().setFromMatrixColumn(activeCamera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(activeCamera.matrix, 1);

    activeCamera.position.addScaledVector(right, event.deltaX * panSpeed);
    activeCamera.position.addScaledVector(up, -event.deltaY * panSpeed);
    orbitControls.target.addScaledVector(right, event.deltaX * panSpeed);
    orbitControls.target.addScaledVector(up, -event.deltaY * panSpeed);
    orbitControls.update();
    return;
  }

  const rect = renderer.domElement.getBoundingClientRect();
  const mouse = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, activeCamera);
  const targetMeshes = placedBlocks.map(b => b.mesh);
  const intersects = raycaster.intersectObjects(targetMeshes, false);
  const zoomTarget = new THREE.Vector3();

  if (intersects.length > 0) zoomTarget.copy(intersects[0].point);
  else {
    const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const hitFloor = raycaster.ray.intersectPlane(floorPlane, zoomTarget);
    if (!hitFloor) raycaster.ray.at(activeCamera.position.distanceTo(orbitControls.target), zoomTarget);
  }

  const zoomFactor = Math.max(Math.min(-event.deltaY * 0.0015, 0.25), -0.25);
  const dist = activeCamera.position.distanceTo(orbitControls.target);
  if (zoomFactor > 0 && dist < 1.0) return;
  if (zoomFactor < 0 && dist > 200) return;

  activeCamera.position.addScaledVector(new THREE.Vector3().subVectors(zoomTarget, activeCamera.position), zoomFactor);
  orbitControls.target.addScaledVector(new THREE.Vector3().subVectors(zoomTarget, orbitControls.target), zoomFactor);
  orbitControls.update();
}, { capture: true, passive: false });

scene.add(new THREE.AmbientLight(0xffffff, 0.6));

const hemiLight = new THREE.HemisphereLight(0xffffff, 0x888888, 0.8);
hemiLight.position.set(0, 50, 0);
scene.add(hemiLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(20, 40, 20);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 150;
dirLight.shadow.camera.left = -40;
dirLight.shadow.camera.right = 40;
dirLight.shadow.camera.top = 40;
dirLight.shadow.camera.bottom = -40;
dirLight.shadow.bias = -0.0005;
scene.add(dirLight);

scene.add(new THREE.GridHelper(80, 80, "#444444", "#222222"));

const shadowFloor = new THREE.Mesh(
  new THREE.PlaneGeometry(200, 200),
  new THREE.ShadowMaterial({ opacity: 0.6 })
);
shadowFloor.rotation.x = -Math.PI / 2;
shadowFloor.position.y = -0.01;
shadowFloor.receiveShadow = true;
scene.add(shadowFloor);

const electricalKits: Record<string, { name: string, desc: string, color: string }> = {
  S0: { name: "S0 - 4 ENCHUFES", desc: "4 POWER PLUGS AND SOCKETS", color: "#3498db" },
  S1: { name: "S1 - 1 x 4 ENCHUFES + 2 DATA", desc: "1 x 4 POWER PLUGS AND SOCKETS + 2 DATA", color: "#2ecc71" },
  S2: { name: "S2 - 2 x 4 ENCHUFES + 2 DATA", desc: "2 x 4 POWER PLUGS AND SOCKETS + 2 DATA", color: "#f1c40f" },
  S3: { name: "S3 - 3 x 4 ENCHUFES + 2 DATA", desc: "3 x 4 POWER PLUGS AND SOCKETS + 2 DATA", color: "#e67e22" },
  S4: { name: "S4 - 4 x 4 ENCHUFES + 2 DATA", desc: "4 x 4 POWER PLUGS AND SOCKETS + 2 DATA", color: "#e74c3c" },
  SP: { name: "SP - 1 ENCHUFE + 1 DATA PROYECTOR", desc: "1 POWER PLUGS AND SOCKETS + DATA PROJECTOR", color: "#9b59b6" },
  SC: { name: "SC - CUADRO", desc: "ELECTRIC SWITCHBOARD", color: "#e84393" },
  SA: { name: "SA - AIRE + 1 ENCHUFE", desc: "AIR CONDITIONING + 1 POWER PLUG AND SOCKET", color: "#00cec9" },
  SK: { name: "SK - CATERING", desc: "4x4 SOCKETS + FRIDGE + DISHWASHER + HEATER + TANK 100L", color: "#fd79a8" },
  ST: { name: "ST - TOMA CORRIENTE", desc: "SINGLE POWER OUTLET", color: "#00b894" }
};

const roofKits: Record<string, { name: string, desc: string, color: string }> = {
  R_CLASS: { name: "Classroom Roof", desc: "Standard roof element for classrooms", color: "#00cec9" },
  R_CORR: { name: "Corridor Roof", desc: "Standard roof element for corridors", color: "#6c5ce7" }
};

type QCMode = 'none' | 'elec' | 'links' | 'roof' | 'orient';
let activeQC: QCMode = 'none';

const qcLinksGroup = new THREE.Group();
scene.add(qcLinksGroup);

interface PlacedModule { id: string; typeKey: string; mesh: THREE.Mesh; elecKey?: string; roofKey?: string; }
const placedBlocks: PlacedModule[] = [];

const selectedBlocks = new Set<THREE.Mesh>();
const transformGroup = new THREE.Group();
scene.add(transformGroup);

const selectionOutlines = new Map<THREE.Mesh, THREE.LineSegments>();
const outlineMaterial = new THREE.LineBasicMaterial({ color: 0x2ecc71, depthTest: false, transparent: true });

let isPlacementMode = false;
let dragStartX = 0;
let dragStartY = 0;
let dragStartTime = 0;
let clickedAxis: string | null = null;

const contextMenu = document.getElementById("context-menu") as HTMLDivElement;

interface SceneSnapshot { blocks: { id: string, typeKey: string, elecKey?: string, roofKey?: string, pos: THREE.Vector3, rot: THREE.Euler }[] }
const history: SceneSnapshot[] = [];

function saveState() {
  if (history.length >= 10) history.shift();
  history.push({
    blocks: placedBlocks.map(b => {
      const wPos = new THREE.Vector3();
      const wQuat = new THREE.Quaternion();
      b.mesh.getWorldPosition(wPos);
      b.mesh.getWorldQuaternion(wQuat);
      const wRot = new THREE.Euler().setFromQuaternion(wQuat);
      return { id: b.id, typeKey: b.typeKey, elecKey: b.elecKey, roofKey: b.roofKey, pos: wPos, rot: wRot };
    })
  });
}

function undo() {
  if (history.length === 0) return;
  const lastState = history.pop()!;

  placedBlocks.forEach(b => {
    scene.remove(b.mesh);
    b.mesh.geometry.dispose();
    if (b.mesh.material) {
      if (Array.isArray(b.mesh.material)) b.mesh.material.forEach(m => m.dispose());
      else (b.mesh.material as THREE.Material).dispose();
    }
  });
  placedBlocks.length = 0;
  updateSelection(null, false);

  lastState.blocks.forEach(bData => {
    const mesh = new THREE.Mesh();
    applyModuleStyle(mesh, bData.typeKey);
    mesh.position.copy(bData.pos);
    mesh.rotation.copy(bData.rot);
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);
    placedBlocks.push({ id: bData.id, typeKey: bData.typeKey, elecKey: bData.elecKey, roofKey: bData.roofKey, mesh });
  });
  refreshQCColors();
  updateCostUI();
}

let isAltDown = false;
window.addEventListener("keydown", (e) => {
  if (e.key === "Alt") isAltDown = true;
  updateOrbitMode(e);

  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'd') {
    e.preventDefault();
    if (isVertexDragging) return;
    activeTool = 'osnap';
    transformControls.detach();
    const gizmoBtn = document.getElementById("gizmo-mode-btn")!;
    gizmoBtn.innerHTML = "<b>Tool: OSNAP (Magnet)</b>";
    gizmoBtn.style.background = "#e74c3c";
    return;
  }

  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }

  if (e.key === "Escape") {
    contextMenu.style.display = "none";

    if (isVertexDragging) {
      isVertexDragging = false;
      orbitControls.enabled = true;
      selectedBlocks.forEach(mesh => {
        const originalPos = dragOffsets.get(mesh);
        if (originalPos) {
          mesh.position.copy(originalPos);
          mesh.updateMatrix();
        }
      });
      updatePropertiesUI();
      snapMarker.visible = false;
    } else {
      isPlacementMode = false;
      updateModeUI();
      updateSelection(null, false);
    }
  }

  if ((e.key === "Delete" || e.key === "Backspace") && !isPlacementMode && selectedBlocks.size > 0) {
    if (document.activeElement?.tagName === 'INPUT') return;

    saveState();
    const meshesToDelete = Array.from(selectedBlocks);
    updateSelection(null, false);

    meshesToDelete.forEach(mesh => {
      scene.remove(mesh);
      const index = placedBlocks.findIndex(b => b.mesh === mesh);
      if (index !== -1) placedBlocks.splice(index, 1);
      mesh.geometry.dispose();

      if (mesh.material) {
        if (Array.isArray(mesh.material)) mesh.material.forEach(m => m.dispose());
        else (mesh.material as THREE.Material).dispose();
      }
    });

    updateCostUI();
    updatePropertiesUI();
    refreshQCColors();
  }
});

window.addEventListener("pointerdown", (event) => {
  if (event.button === 0 && !(event.target as HTMLElement).closest("#context-menu")) {
    contextMenu.style.display = "none";
  }
});

window.addEventListener("keyup", (e) => {
  if (e.key === "Alt") isAltDown = false;
  updateOrbitMode(e);
});

window.addEventListener("blur", () => {
  isAltDown = false;
  orbitControls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
});

interface BlueprintData { menuGroup: string; name: string; desc: string; cost: number; color: string; group: string; walls: { left: boolean, right: boolean }; geometry: THREE.BoxGeometry }

const blueprints: Record<string, BlueprintData> = {
  A1: { menuGroup: "Type A (Left End)", name: "A1", desc: "3 Walls + Ext Back Window", cost: 10, color: "#e74c3c", group: "classroom", walls: { left: true, right: false }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  A2PI: { menuGroup: "Type A (Left End)", name: "A2PI", desc: "3 Walls + Ext Back Window + Left Door", cost: 10, color: "#e74c3c", group: "classroom", walls: { left: true, right: false }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  A3: { menuGroup: "Type A (Left End)", name: "A3", desc: "3 Walls + Ext Back Win + Ext Front Win", cost: 10, color: "#e74c3c", group: "classroom", walls: { left: true, right: false }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  A4: { menuGroup: "Type A (Left End)", name: "A4", desc: "3 Walls + Ext Back Window", cost: 10, color: "#e74c3c", group: "classroom", walls: { left: true, right: false }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  B1: { menuGroup: "Type B (Middle Open)", name: "B1", desc: "2 Walls + Ext Back Window", cost: 10, color: "#3498db", group: "classroom", walls: { left: false, right: false }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  B2PI: { menuGroup: "Type B (Middle Open)", name: "B2PI", desc: "2 Walls + Ext Back Window + Left Door", cost: 10, color: "#3498db", group: "classroom", walls: { left: false, right: false }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  B2PD: { menuGroup: "Type B (Middle Open)", name: "B2PD", desc: "2 Walls + Ext Back Window + Right Door", cost: 10, color: "#3498db", group: "classroom", walls: { left: false, right: false }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  B3: { menuGroup: "Type B (Middle Open)", name: "B3", desc: "2 Walls + Ext Back Win + Ext Front Win", cost: 10, color: "#3498db", group: "classroom", walls: { left: false, right: false }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  B4: { menuGroup: "Type B (Middle Open)", name: "B4", desc: "2 Walls + Ext Back Window", cost: 10, color: "#3498db", group: "classroom", walls: { left: false, right: false }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  C1: { menuGroup: "Type C (Right End)", name: "C1", desc: "3 Walls + Ext Back Window", cost: 10, color: "#9b59b6", group: "classroom", walls: { left: false, right: true }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  C2PD: { menuGroup: "Type C (Right End)", name: "C2PD", desc: "3 Walls + Ext Back Window + Right Door", cost: 10, color: "#9b59b6", group: "classroom", walls: { left: false, right: true }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  C3: { menuGroup: "Type C (Right End)", name: "C3", desc: "3 Walls + Ext Back Win + Ext Front Win", cost: 10, color: "#9b59b6", group: "classroom", walls: { left: false, right: true }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  C4: { menuGroup: "Type C (Right End)", name: "C4", desc: "3 Walls + Ext Back Window", cost: 10, color: "#9b59b6", group: "classroom", walls: { left: false, right: true }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  D2PD: { menuGroup: "Type D (Standalone)", name: "D2PD", desc: "4 Walls + Ext Back Win + Right Door", cost: 10, color: "#2ecc71", group: "classroom", walls: { left: true, right: true }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  D2PI: { menuGroup: "Type D (Standalone)", name: "D2PI", desc: "4 Walls + Ext Back Win + Left Door", cost: 10, color: "#2ecc71", group: "classroom", walls: { left: true, right: true }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  E4: { menuGroup: "Type E (1 Wall)", name: "E4", desc: "1 Wall + Ext Back Window", cost: 10, color: "#e67e22", group: "classroom", walls: { left: false, right: false }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  E5PCE: { menuGroup: "Type E (1 Wall)", name: "E5PCE", desc: "1 Wall + Ext Opening Door", cost: 10, color: "#e67e22", group: "classroom", walls: { left: false, right: false }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  E5PCI: { menuGroup: "Type E (1 Wall)", name: "E5PCI", desc: "1 Wall + Int Opening Door", cost: 10, color: "#e67e22", group: "classroom", walls: { left: false, right: false }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  F1: { menuGroup: "Type F (0 Walls)", name: "F1", desc: "0 Walls", cost: 10, color: "#95a5a6", group: "classroom", walls: { left: false, right: false }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  F2: { menuGroup: "Type F (0 Walls)", name: "F2", desc: "0 Walls", cost: 10, color: "#95a5a6", group: "classroom", walls: { left: false, right: false }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  F3: { menuGroup: "Type F (0 Walls)", name: "F3", desc: "0 Walls - Open Framing", cost: 10, color: "#95a5a6", group: "classroom", walls: { left: false, right: false }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  G4: { menuGroup: "Type G & H", name: "G4", desc: "2 Walls (Left, Back) + Ext Window", cost: 10, color: "#d35400", group: "classroom", walls: { left: true, right: false }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  H4: { menuGroup: "Type G & H", name: "H4", desc: "2 Walls (Right, Back) + Ext Window", cost: 10, color: "#8e44ad", group: "classroom", walls: { left: false, right: true }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  ASPD: { menuGroup: "Restrooms", name: "ASPD", desc: "4 Walls + Ext Win + Right Door", cost: 15, color: "#1abc9c", group: "classroom", walls: { left: true, right: true }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  ASPI: { menuGroup: "Restrooms", name: "ASPI", desc: "4 Walls + Ext Win + Left Door", cost: 15, color: "#1abc9c", group: "classroom", walls: { left: true, right: true }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  ADPD: { menuGroup: "Restrooms", name: "ADPD", desc: "4 Walls + Ext Win + Right Door", cost: 15, color: "#1abc9c", group: "classroom", walls: { left: true, right: true }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  ADPI: { menuGroup: "Restrooms", name: "ADPI", desc: "4 Walls + Ext Win + Left Door", cost: 15, color: "#1abc9c", group: "classroom", walls: { left: true, right: true }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  AI: { menuGroup: "Restrooms", name: "AI", desc: "4 Walls + Int Wins + L/R Doors", cost: 15, color: "#1abc9c", group: "classroom", walls: { left: true, right: true }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  AIMPD: { menuGroup: "Restrooms", name: "AIMPD", desc: "4 Walls + Right Opening Door", cost: 15, color: "#1abc9c", group: "classroom", walls: { left: true, right: true }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  AIMPI: { menuGroup: "Restrooms", name: "AIMPI", desc: "4 Walls + Left Opening Door", cost: 15, color: "#1abc9c", group: "classroom", walls: { left: true, right: true }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  CorridorFloor: { menuGroup: "Exterior", name: "Corridor Floor", desc: "Floor plane only (1 Story)", cost: 4, color: "#f1c40f", group: "corridor", walls: { left: false, right: false }, geometry: new THREE.BoxGeometry(6, 3, 2.44) },
  CorridorStructure: { menuGroup: "Exterior", name: "Corridor Structure", desc: "Frame + Detached Walls", cost: 6, color: "#e67e22", group: "corridor", walls: { left: false, right: false }, geometry: new THREE.BoxGeometry(6, 3, 2.44) }
};

const orientMats = {
  transparent: new THREE.MeshStandardMaterial({ color: 0xffffff, transparent: true, opacity: 0.1, depthWrite: false }),
  wall: new THREE.MeshStandardMaterial({ color: 0x95a5a6, transparent: false, opacity: 1.0 }),
  facade: new THREE.MeshStandardMaterial({ color: 0x0984e3, transparent: true, opacity: 0.85 }),
  corridor: new THREE.MeshStandardMaterial({ color: 0xe17055, transparent: true, opacity: 0.85 }),
  floor: new THREE.MeshStandardMaterial({ color: 0x2d3436, transparent: true, opacity: 0.4, side: THREE.DoubleSide })
};

function getDynamicWalls(b1: PlacedModule, allBlocks: PlacedModule[]) {
  const dynWalls = { posX: true, negX: true, posZ: true, negZ: true };
  const box1 = new THREE.Box3().setFromObject(b1.mesh);
  box1.expandByScalar(0.1);

  allBlocks.forEach(b2 => {
    if (b1 === b2) return;
    const box2 = new THREE.Box3().setFromObject(b2.mesh);
    if (box1.intersectsBox(box2)) {
      const dy = Math.abs(b1.mesh.position.y - b2.mesh.position.y);
      if (dy < 1.5) {
        const dir = b2.mesh.getWorldPosition(new THREE.Vector3()).sub(b1.mesh.getWorldPosition(new THREE.Vector3()));
        const localDir = dir.clone().applyEuler(new THREE.Euler().setFromQuaternion(b1.mesh.getWorldQuaternion(new THREE.Quaternion()).invert()));

        if (Math.abs(localDir.x) > Math.abs(localDir.z)) {
          if (localDir.x > 1.0) dynWalls.posX = false;
          else if (localDir.x < -1.0) dynWalls.negX = false;
        } else {
          if (localDir.z > 1.0) dynWalls.posZ = false;
          else if (localDir.z < -1.0) dynWalls.negZ = false;
        }
      }
    }
  });
  return dynWalls;
}

function refreshQCColors() {
  document.getElementById("qc-elec-btn")!.style.background = activeQC === 'elec' ? '#f39c12' : '';
  document.getElementById("qc-roof-btn")!.style.background = activeQC === 'roof' ? '#f39c12' : '';
  document.getElementById("qc-orient-btn")!.style.background = activeQC === 'orient' ? '#f39c12' : '';
  document.getElementById("qc-links-btn")!.style.background = activeQC === 'links' ? '#f39c12' : '';

  while (qcLinksGroup.children.length > 0) {
    const child = qcLinksGroup.children[0] as THREE.Mesh;
    qcLinksGroup.remove(child);
    child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
      else (child.material as THREE.Material).dispose();
    }
  }

  placedBlocks.forEach(b => {
    const bp = blueprints[b.typeKey];

    if (activeQC === 'orient') {
      if (bp.group === 'corridor' && b.typeKey === 'CorridorStructure') {
        const dynWalls = getDynamicWalls(b, placedBlocks);
        b.mesh.material = [
          dynWalls.posX ? orientMats.wall : orientMats.transparent,
          dynWalls.negX ? orientMats.wall : orientMats.transparent,
          orientMats.floor,
          orientMats.floor,
          dynWalls.posZ ? orientMats.wall : orientMats.transparent,
          dynWalls.negZ ? orientMats.wall : orientMats.transparent
        ];
      } else if (bp.group === 'corridor' && b.typeKey === 'CorridorFloor') {
        b.mesh.material = [
          orientMats.transparent, orientMats.transparent,
          orientMats.transparent,
          orientMats.floor,
          orientMats.transparent, orientMats.transparent
        ];
      } else {
        b.mesh.material = [
          orientMats.corridor,
          orientMats.facade,
          orientMats.floor,
          orientMats.floor,
          bp.walls.right ? orientMats.wall : orientMats.transparent,
          bp.walls.left ? orientMats.wall : orientMats.transparent
        ];
      }
      return;
    }

    if (Array.isArray(b.mesh.material)) {
      b.mesh.material = new THREE.MeshStandardMaterial({
        color: bp.color, roughness: 0.7, metalness: 0.1, transparent: true, opacity: 0.9
      });
    }

    const mat = b.mesh.material as THREE.MeshStandardMaterial;

    if (activeQC === 'elec') {
      if (b.elecKey && electricalKits[b.elecKey]) {
        mat.color.set(electricalKits[b.elecKey].color);
        mat.transparent = false;
        mat.opacity = 1.0;
        mat.depthWrite = true;
      } else {
        mat.color.setHex(0xffffff);
        mat.transparent = true;
        mat.opacity = 0.5;
        mat.depthWrite = false;
      }
    } else if (activeQC === 'roof') {
      if (b.roofKey && roofKits[b.roofKey]) {
        mat.color.set(roofKits[b.roofKey].color);
        mat.transparent = false;
        mat.opacity = 1.0;
        mat.depthWrite = true;
      } else {
        mat.color.setHex(0xffffff);
        mat.transparent = true;
        mat.opacity = 0.5;
        mat.depthWrite = false;
      }
    } else if (activeQC === 'links') {
      mat.color.set(bp.color);
      mat.transparent = true;
      mat.opacity = 0.25;
      mat.depthWrite = false;
    } else {
      mat.color.set(bp.color);
      mat.transparent = true;
      mat.opacity = 0.9;
      mat.depthWrite = true;
    }
    mat.needsUpdate = true;
  });

  if (activeQC === 'links') {
    const allBlocks = placedBlocks;
    for (let i = 0; i < allBlocks.length; i++) {
      for (let j = i + 1; j < allBlocks.length; j++) {
        const b1 = allBlocks[i]; const b2 = allBlocks[j];
        const box1 = new THREE.Box3().setFromObject(b1.mesh);
        const box2 = new THREE.Box3().setFromObject(b2.mesh);
        box1.expandByScalar(0.05);

        if (box1.intersectsBox(box2)) {
          const overlap = box1.clone().intersect(box2);
          const size = new THREE.Vector3();
          overlap.getSize(size);
          const dy = Math.abs(b1.mesh.position.y - b2.mesh.position.y);

          let isVertical = false;
          let isHorizontal = false;

          if (dy > 1.5 && size.x > 0.2 && size.z > 0.2) {
            isVertical = true;
          }
          else if (dy < 1.5 && blueprints[b1.typeKey].group === 'classroom' && blueprints[b2.typeKey].group === 'classroom') {
            const dir = b2.mesh.getWorldPosition(new THREE.Vector3()).sub(b1.mesh.getWorldPosition(new THREE.Vector3()));
            const localDir1 = dir.clone().applyEuler(new THREE.Euler().setFromQuaternion(b1.mesh.getWorldQuaternion(new THREE.Quaternion()).invert()));
            if (Math.abs(localDir1.z) > 1.5 && Math.abs(localDir1.x) < 5.0) {
              isHorizontal = true;
            }
          }

          if (isVertical || isHorizontal) {
            const highlightColor = isVertical ? 0x3498db : 0xff0000;
            const center = new THREE.Vector3();
            overlap.getCenter(center);

            const geom = new THREE.BoxGeometry(Math.max(size.x, 0.05), Math.max(size.y, 0.05), Math.max(size.z, 0.05));
            const highlightMat = new THREE.MeshBasicMaterial({ color: highlightColor, depthTest: false, transparent: true, opacity: 0.6 });
            const highlightMesh = new THREE.Mesh(geom, highlightMat);
            highlightMesh.position.copy(center);
            qcLinksGroup.add(highlightMesh);

            const edges = new THREE.EdgesGeometry(geom);
            const highlightLines = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: highlightColor, depthTest: false }));
            highlightLines.position.copy(center);
            qcLinksGroup.add(highlightLines);
          }
        }
      }
    }
  }
}

function applyModuleStyle(mesh: THREE.Mesh, typeKey: string) {
  const bp = blueprints[typeKey];
  if (mesh.geometry) mesh.geometry.dispose();

  if (mesh.material) {
    if (Array.isArray(mesh.material)) {
      mesh.material.forEach(m => m.dispose());
    } else {
      (mesh.material as THREE.Material).dispose();
    }
  }

  mesh.geometry = bp.geometry;
  mesh.material = new THREE.MeshStandardMaterial({
    color: bp.color,
    roughness: 0.7,
    metalness: 0.1,
    transparent: true,
    opacity: 0.9
  });

  mesh.children.slice().forEach(c => {
    if (c.userData.isBlackOutline) {
      mesh.remove(c);
      (c as THREE.LineSegments).geometry.dispose();

      const mat = (c as THREE.LineSegments).material;
      if (Array.isArray(mat)) mat.forEach(m => m.dispose());
      else (mat as THREE.Material).dispose();
    }
  });

  const edges = new THREE.EdgesGeometry(bp.geometry);
  const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0x000000 }));
  line.userData.isBlackOutline = true;
  mesh.add(line);
}

const selectEl = document.getElementById("block-type-select") as HTMLSelectElement;
const elecSelect = document.getElementById("elec-select") as HTMLSelectElement;
const roofSelect = document.getElementById("roof-select") as HTMLSelectElement;

Object.entries(electricalKits).forEach(([key, kit]) => {
  const opt = document.createElement("option");
  opt.value = key;
  opt.innerText = kit.name;
  elecSelect.appendChild(opt);
});

Object.entries(roofKits).forEach(([key, kit]) => {
  const opt = document.createElement("option");
  opt.value = key;
  opt.innerText = kit.name;
  roofSelect.appendChild(opt);
});

elecSelect.addEventListener("change", (e) => {
  const val = (e.target as HTMLSelectElement).value;
  if (selectedBlocks.size > 0) {
    saveState();
    selectedBlocks.forEach(mesh => {
      const bData = placedBlocks.find(b => b.mesh === mesh);
      if (bData) bData.elecKey = val || undefined;
    });
    updatePropertiesUI();
    updateCostUI();
    refreshQCColors();
  }
});

roofSelect.addEventListener("change", (e) => {
  const val = (e.target as HTMLSelectElement).value;
  if (selectedBlocks.size > 0) {
    saveState();
    selectedBlocks.forEach(mesh => {
      const bData = placedBlocks.find(b => b.mesh === mesh);
      if (bData) bData.roofKey = val || undefined;
    });
    updatePropertiesUI();
    updateCostUI();
    refreshQCColors();
  }
});

const duplicateBtn = document.createElement("button");
duplicateBtn.innerHTML = `<span style="color:#2ecc71; font-weight:bold;">⧉ Duplicate Module(s)</span>`;
contextMenu.appendChild(duplicateBtn);

const rot90Btn = document.createElement("button");
rot90Btn.innerHTML = `<span style="color:#3498db; font-weight:bold;">⤾ Rotate +90°</span>`;
contextMenu.appendChild(rot90Btn);

const rot180Btn = document.createElement("button");
rot180Btn.innerHTML = `<span style="color:#e67e22; font-weight:bold;">↻ Rotate 180°</span>`;
contextMenu.appendChild(rot180Btn);

contextMenu.appendChild(document.createElement("hr"));

const groups: Record<string, any[]> = {};
for (const [key, data] of Object.entries(blueprints)) {
  if (!groups[data.menuGroup]) groups[data.menuGroup] = [];
  groups[data.menuGroup].push({ key, ...data });
}
for (const [groupName, items] of Object.entries(groups)) {
  const optGroup = document.createElement("optgroup");
  optGroup.label = groupName;
  const ctxHeader = document.createElement("div");
  ctxHeader.className = "menu-header";
  ctxHeader.innerText = groupName;
  contextMenu.appendChild(ctxHeader);

  items.forEach(item => {
    const opt = document.createElement("option");
    opt.value = item.key;
    opt.innerText = `${item.name}`;
    optGroup.appendChild(opt);

    const btn = document.createElement("button");
    btn.setAttribute("data-type", item.key);
    btn.innerHTML = `<span style="color:${item.color}">■</span> Swap to ${item.name}`;
    contextMenu.appendChild(btn);
  });
  selectEl.appendChild(optGroup);
}

contextMenu.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;

  const btn = (e.target as HTMLElement).closest('button');
  if (!btn) return;

  e.stopPropagation();

  if (btn.hasAttribute("data-type")) {
    if (selectedBlocks.size === 0) return;
    saveState();
    const newType = btn.getAttribute("data-type")!;

    const oldSelection = Array.from(selectedBlocks);
    updateSelection(null, false);

    oldSelection.forEach(mesh => {
      const blockData = placedBlocks.find(b => b.mesh === mesh);
      if (blockData) blockData.typeKey = newType;
      applyModuleStyle(mesh, newType);
    });

    oldSelection.forEach(m => updateSelection(m, true));
    contextMenu.style.display = "none";
    updateCostUI();
    refreshQCColors();
  } else if (btn === duplicateBtn) {
    if (selectedBlocks.size === 0) return;
    saveState();
    const newSelection: THREE.Mesh[] = [];

    selectedBlocks.forEach(mesh => {
      const bData = placedBlocks.find(b => b.mesh === mesh);
      if (bData) {
        const clone = new THREE.Mesh();
        applyModuleStyle(clone, bData.typeKey);
        mesh.getWorldPosition(clone.position);
        mesh.getWorldQuaternion(clone.quaternion);
        clone.position.x += globalSnap;
        clone.position.z += globalSnap;
        clone.castShadow = true; clone.receiveShadow = true;
        scene.add(clone);
        placedBlocks.push({ id: crypto.randomUUID(), typeKey: bData.typeKey, elecKey: bData.elecKey, roofKey: bData.roofKey, mesh: clone });
        newSelection.push(clone);
      }
    });

    updateSelection(null, false);
    newSelection.forEach(m => updateSelection(m, true));
    updateCostUI();
    refreshQCColors();
    contextMenu.style.display = "none";
  } else if (btn === rot90Btn) {
    if (selectedBlocks.size === 0) return;
    saveState();
    selectedBlocks.forEach(mesh => {
      mesh.rotation.y += Math.PI / 2;
      mesh.updateMatrix();
    });
    updatePropertiesUI();
    updateCostUI();
    refreshQCColors();
    contextMenu.style.display = "none";
  } else if (btn === rot180Btn) {
    if (selectedBlocks.size === 0) return;
    saveState();
    selectedBlocks.forEach(mesh => {
      mesh.rotation.y += Math.PI;
      mesh.updateMatrix();
    });
    updatePropertiesUI();
    updateCostUI();
    refreshQCColors();
    contextMenu.style.display = "none";
  }
});

let globalSnap = 0.5;
const snapInput = document.getElementById("global-snap-input") as HTMLInputElement;
snapInput.addEventListener("change", (e) => {
  globalSnap = parseFloat((e.target as HTMLInputElement).value) || 0.1;
  transformControls.setTranslationSnap(globalSnap);
});

const osnap = { end: true, mid: true, int: true, perp: true, near: true, center: false };

document.getElementById('osnap-end')!.addEventListener('change', (e) => osnap.end = (e.target as HTMLInputElement).checked);
document.getElementById('osnap-mid')!.addEventListener('change', (e) => osnap.mid = (e.target as HTMLInputElement).checked);
document.getElementById('osnap-int')!.addEventListener('change', (e) => osnap.int = (e.target as HTMLInputElement).checked);
document.getElementById('osnap-perp')!.addEventListener('change', (e) => osnap.perp = (e.target as HTMLInputElement).checked);
document.getElementById('osnap-near')!.addEventListener('change', (e) => osnap.near = (e.target as HTMLInputElement).checked);
document.getElementById('osnap-cen')!.addEventListener('change', (e) => osnap.center = (e.target as HTMLInputElement).checked);

type ToolState = 'translate' | 'rotate' | 'osnap';
let activeTool: ToolState = 'translate';

const transformControls = new TransformControls(activeCamera, renderer.domElement);
transformControls.setTranslationSnap(globalSnap);
transformControls.setRotationSnap(THREE.MathUtils.degToRad(15));
scene.add(transformControls.getHelper());

const snapMarker = new THREE.Mesh(new THREE.SphereGeometry(0.12), new THREE.MeshBasicMaterial({ color: 0xff0000, depthTest: false }));
scene.add(snapMarker);
snapMarker.visible = false;

let isVertexDragging = false;
let snapStartVertex: THREE.Vector3 | null = null;
const dragOffsets = new Map<THREE.Mesh, THREE.Vector3>();

function getMeshEdges(mesh: THREE.Mesh): THREE.Line3[] {
  const edges: THREE.Line3[] = [];
  const lineSegments = mesh.children.find(c => c.userData.isBlackOutline) as THREE.LineSegments;
  if (!lineSegments) return edges;
  const posAttr = lineSegments.geometry.attributes.position;
  for (let i = 0; i < posAttr.count; i += 2) {
    const v1 = new THREE.Vector3().fromBufferAttribute(posAttr, i).applyMatrix4(mesh.matrixWorld);
    const v2 = new THREE.Vector3().fromBufferAttribute(posAttr, i + 1).applyMatrix4(mesh.matrixWorld);
    edges.push(new THREE.Line3(v1, v2));
  }
  return edges;
}

function getSnapPoint(hitPoint: THREE.Vector3, hoveredMesh: THREE.Mesh): { point: THREE.Vector3, type: string } {
  let bestDist = Infinity;
  let bestPoint = hitPoint.clone();
  let bestType = 'none';

  const check = (pt: THREE.Vector3, type: string) => {
    const d = hitPoint.distanceTo(pt);
    if (d < bestDist) { bestDist = d; bestPoint = pt.clone(); bestType = type; }
  };

  const edges = getMeshEdges(hoveredMesh);

  edges.forEach(edge => {
    if (osnap.end) { check(edge.start, 'end'); check(edge.end, 'end'); }
    if (osnap.mid) check(edge.getCenter(new THREE.Vector3()), 'mid');
    if (osnap.near) {
      const pt = new THREE.Vector3();
      edge.closestPointToPoint(hitPoint, true, pt);
      check(pt, 'near');
    }
    if (osnap.perp && isVertexDragging && snapStartVertex) {
      const pt = new THREE.Vector3();
      edge.closestPointToPoint(snapStartVertex, true, pt);
      if (pt.distanceTo(edge.start) > 0.01 && pt.distanceTo(edge.end) > 0.01) check(pt, 'perp');
    }
  });

  if (osnap.center) {
    const center = new THREE.Vector3();
    hoveredMesh.getWorldPosition(center);
    check(center, 'center');
  }

  if (osnap.int) {
    const validTargets = placedBlocks.filter(b => b.mesh !== hoveredMesh && !selectedBlocks.has(b.mesh));
    validTargets.forEach(target => {
      const targetEdges = getMeshEdges(target.mesh);
      edges.forEach(e1 => {
        targetEdges.forEach(e2 => {
          const p1 = e1.start; const p2 = e1.end;
          const p3 = e2.start; const p4 = e2.end;
          const d = (p2.x - p1.x) * (p4.z - p3.z) - (p2.z - p1.z) * (p4.x - p3.x);

          if (Math.abs(d) > 0.0001) {
            const u = ((p3.x - p1.x) * (p4.z - p3.z) - (p3.z - p1.z) * (p4.x - p3.x)) / d;
            const v = ((p3.x - p1.x) * (p2.z - p1.z) - (p3.z - p1.z) * (p2.x - p1.x)) / d;
            if (u >= 0 && u <= 1 && v >= 0 && v <= 1) {
              const pt1 = p1.clone().lerp(p2, u);
              const pt2 = p3.clone().lerp(p4, v);
              if (Math.abs(pt1.y - pt2.y) < 0.1) check(pt1, 'int');
            }
          }
        });
      });
    });
  }

  if (bestDist > 1.5) return { point: hitPoint, type: 'none' };
  return { point: bestPoint, type: bestType };
}

function performOsnap(raycaster: THREE.Raycaster, validMeshes: THREE.Mesh[]) {
  const dist = activeCamera.position.distanceTo(orbitControls.target);
  raycaster.params.Line.threshold = isPlanView ? (cameraOrtho.top - cameraOrtho.bottom) * 0.02 : dist * 0.03;

  const outlines = validMeshes.map(m => m.children.find(c => c.userData.isBlackOutline)).filter(Boolean) as THREE.Object3D[];
  const lineHits = raycaster.intersectObjects(outlines, false);

  if (lineHits.length > 0) {
    const hit = lineHits[0];
    const parentMesh = hit.object.parent as THREE.Mesh;
    return getSnapPoint(hit.point, parentMesh);
  }

  const meshHits = raycaster.intersectObjects(validMeshes, false);
  if (meshHits.length > 0) {
    return getSnapPoint(meshHits[0].point, meshHits[0].object as THREE.Mesh);
  }
  return null;
}

renderer.domElement.addEventListener("pointermove", (event) => {
  if (activeTool !== 'osnap' || selectedBlocks.size === 0) {
    snapMarker.visible = false;
    return;
  }

  const rect = renderer.domElement.getBoundingClientRect();
  const mouse = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, activeCamera);

  if (!isVertexDragging) {
    const targets = Array.from(selectedBlocks);
    const snap = performOsnap(raycaster, targets);

    if (snap) {
      snapMarker.position.copy(snap.point);
      if (snap.type === 'end') (snapMarker.material as THREE.MeshBasicMaterial).color.setHex(0xe74c3c);
      else if (snap.type === 'mid') (snapMarker.material as THREE.MeshBasicMaterial).color.setHex(0xf1c40f);
      else if (snap.type === 'near') (snapMarker.material as THREE.MeshBasicMaterial).color.setHex(0xffffff);
      else if (snap.type === 'center') (snapMarker.material as THREE.MeshBasicMaterial).color.setHex(0x9b59b6);
      else if (snap.type === 'int') (snapMarker.material as THREE.MeshBasicMaterial).color.setHex(0x00ffff);
      else if (snap.type === 'perp') (snapMarker.material as THREE.MeshBasicMaterial).color.setHex(0xe67e22);
      else (snapMarker.material as THREE.MeshBasicMaterial).color.setHex(0x333333);
      snapMarker.visible = true;
    } else {
      snapMarker.visible = false;
    }
  } else {
    const validTargets = placedBlocks.filter(b => !selectedBlocks.has(b.mesh)).map(b => b.mesh);
    const snap = performOsnap(raycaster, validTargets);

    if (snap) {
      snapMarker.position.copy(snap.point);
      if (snap.type === 'end') (snapMarker.material as THREE.MeshBasicMaterial).color.setHex(0xe74c3c);
      else if (snap.type === 'mid') (snapMarker.material as THREE.MeshBasicMaterial).color.setHex(0xf1c40f);
      else if (snap.type === 'near') (snapMarker.material as THREE.MeshBasicMaterial).color.setHex(0xffffff);
      else if (snap.type === 'center') (snapMarker.material as THREE.MeshBasicMaterial).color.setHex(0x9b59b6);
      else if (snap.type === 'int') (snapMarker.material as THREE.MeshBasicMaterial).color.setHex(0x00ffff);
      else if (snap.type === 'perp') (snapMarker.material as THREE.MeshBasicMaterial).color.setHex(0xe67e22);
      else (snapMarker.material as THREE.MeshBasicMaterial).color.setHex(0x333333);

      snapMarker.visible = true;

      const delta = snapMarker.position.clone().sub(snapStartVertex!);
      selectedBlocks.forEach(mesh => {
        const originalPos = dragOffsets.get(mesh);
        if (originalPos) {
          mesh.position.copy(originalPos).add(delta);
          mesh.updateMatrix();
        }
      });
      updatePropertiesUI();
    } else {
      snapMarker.visible = false;
    }
  }
});

function updateSelection(mesh: THREE.Mesh | null, multi: boolean) {
  selectedBlocks.forEach(b => scene.attach(b));

  if (!multi) selectedBlocks.clear();
  if (mesh) {
    if (multi && selectedBlocks.has(mesh)) selectedBlocks.delete(mesh);
    else selectedBlocks.add(mesh);
  }

  selectionOutlines.forEach((line, m) => m.remove(line));
  selectionOutlines.clear();

  placedBlocks.forEach(b => {
    const isSelected = selectedBlocks.has(b.mesh);

    if (activeQC === 'none') {
      if (!Array.isArray(b.mesh.material)) {
        (b.mesh.material as THREE.MeshStandardMaterial).emissive.setHex(isSelected ? 0x222222 : 0x000000);
      }
    }

    if (isSelected) {
      const edges = new THREE.EdgesGeometry(b.mesh.geometry);
      const line = new THREE.LineSegments(edges, outlineMaterial);
      b.mesh.add(line);
      selectionOutlines.set(b.mesh, line);
    }
  });

  if (activeTool !== 'osnap') {
    if (selectedBlocks.size === 0) transformControls.detach();
    else if (selectedBlocks.size === 1) transformControls.attach(Array.from(selectedBlocks)[0]);
    else {
      const center = new THREE.Vector3();
      selectedBlocks.forEach(b => center.add(b.position));
      center.divideScalar(selectedBlocks.size);
      transformGroup.position.copy(center);
      transformGroup.rotation.set(0, 0, 0);
      selectedBlocks.forEach(b => transformGroup.attach(b));
      transformControls.attach(transformGroup);
    }
  } else {
    transformControls.detach();
  }
  updatePropertiesUI();
}

transformControls.addEventListener("dragging-changed", (event) => {
  orbitControls.enabled = !event.value;
  if (event.value) {
    saveState();
    if (isAltDown && selectedBlocks.size > 0) {
      selectedBlocks.forEach(mesh => {
        const bData = placedBlocks.find(b => b.mesh === mesh);
        if (bData) {
          const clone = new THREE.Mesh();
          applyModuleStyle(clone, bData.typeKey);
          mesh.getWorldPosition(clone.position);
          mesh.getWorldQuaternion(clone.quaternion);
          clone.castShadow = true; clone.receiveShadow = true;
          scene.add(clone);
          placedBlocks.push({ id: crypto.randomUUID(), typeKey: bData.typeKey, elecKey: bData.elecKey, roofKey: bData.roofKey, mesh: clone });
        }
      });
      updateCostUI();
      refreshQCColors();
    }
  }
});

transformControls.addEventListener("change", () => { updatePropertiesUI(); updateCostUI(); });

const propsPanel = document.getElementById("properties-panel")!;
const propName = document.getElementById("prop-name")!;
const propDesc = document.getElementById("prop-desc")!;
const elecDesc = document.getElementById("elec-desc")!;
const roofDesc = document.getElementById("roof-desc")!;
const posX = document.getElementById("pos-x") as HTMLInputElement;
const posY = document.getElementById("pos-y") as HTMLInputElement;
const posZ = document.getElementById("pos-z") as HTMLInputElement;
const rotX = document.getElementById("rot-x") as HTMLInputElement;
const rotY = document.getElementById("rot-y") as HTMLInputElement;
const rotZ = document.getElementById("rot-z") as HTMLInputElement;

function updatePropertiesUI() {
  if (selectedBlocks.size === 0) {
    propsPanel.style.display = "none";
    return;
  }
  propsPanel.style.display = "block";

  if (selectedBlocks.size > 1) {
    propName.innerText = "Multiple Elements Selected";
    propDesc.innerText = `You are moving ${selectedBlocks.size} modules simultaneously.`;
    [posX, posY, posZ, rotX, rotY, rotZ].forEach(i => i.disabled = true);

    const firstBData = placedBlocks.find(b => b.mesh === Array.from(selectedBlocks)[0]);

    const allSameElec = Array.from(selectedBlocks).every(m => placedBlocks.find(b => b.mesh === m)?.elecKey === firstBData?.elecKey);
    elecSelect.value = allSameElec && firstBData?.elecKey ? firstBData.elecKey : "";
    elecDesc.innerText = allSameElec && firstBData?.elecKey ? electricalKits[firstBData.elecKey].desc : "Mixed or No electrical kits assigned.";

    const allSameRoof = Array.from(selectedBlocks).every(m => placedBlocks.find(b => b.mesh === m)?.roofKey === firstBData?.roofKey);
    roofSelect.value = allSameRoof && firstBData?.roofKey ? firstBData.roofKey : "";
    roofDesc.innerText = allSameRoof && firstBData?.roofKey ? roofKits[firstBData.roofKey].desc : "Mixed or No roof assigned.";

    return;
  }

  [posX, posY, posZ, rotX, rotY, rotZ].forEach(i => i.disabled = false);
  const singleMesh = Array.from(selectedBlocks)[0];
  const bData = placedBlocks.find(b => b.mesh === singleMesh);

  if (bData) {
    const bp = blueprints[bData.typeKey];
    propName.innerText = bp.name;
    propDesc.innerText = bp.desc;

    if (bData.elecKey && electricalKits[bData.elecKey]) {
      elecSelect.value = bData.elecKey;
      elecDesc.innerText = electricalKits[bData.elecKey].desc;
    } else {
      elecSelect.value = "";
      elecDesc.innerText = "No electrical kit assigned.";
    }

    if (bData.roofKey && roofKits[bData.roofKey]) {
      roofSelect.value = bData.roofKey;
      roofDesc.innerText = roofKits[bData.roofKey].desc;
    } else {
      roofSelect.value = "";
      roofDesc.innerText = "No roof assigned.";
    }
  }

  posX.value = singleMesh.position.x.toFixed(3);
  posY.value = singleMesh.position.y.toFixed(3);
  posZ.value = singleMesh.position.z.toFixed(3);
  rotX.value = THREE.MathUtils.radToDeg(singleMesh.rotation.x).toFixed(1);
  rotY.value = THREE.MathUtils.radToDeg(singleMesh.rotation.y).toFixed(1);
  rotZ.value = THREE.MathUtils.radToDeg(singleMesh.rotation.z).toFixed(1);
}

function applyParametricEdit() {
  if (selectedBlocks.size !== 1) return;
  saveState();
  const singleMesh = Array.from(selectedBlocks)[0];
  singleMesh.position.set(parseFloat(posX.value) || 0, parseFloat(posY.value) || 0, parseFloat(posZ.value) || 0);
  singleMesh.rotation.set(
    THREE.MathUtils.degToRad(parseFloat(rotX.value) || 0),
    THREE.MathUtils.degToRad(parseFloat(rotY.value) || 0),
    THREE.MathUtils.degToRad(parseFloat(rotZ.value) || 0)
  );
  singleMesh.updateMatrix();
  updateCostUI();
  refreshQCColors();
}

[posX, posY, posZ, rotX, rotY, rotZ].forEach(input => input.addEventListener("change", applyParametricEdit));

function animate() {
  requestAnimationFrame(animate);
  orbitControls.update();
  renderer.render(scene, activeCamera);
}
animate();

renderer.domElement.addEventListener("pointerdown", (event) => {
  dragStartX = event.clientX;
  dragStartY = event.clientY;
  dragStartTime = Date.now();
  clickedAxis = transformControls.axis;

  if (event.button === 0 && !transformControls.axis) {
    const rect = renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, activeCamera);

    if (!isPlacementMode) {
      if (activeTool === 'osnap' && selectedBlocks.size > 0) {
        if (isVertexDragging) {
          isVertexDragging = false;
          orbitControls.enabled = true;
          updateCostUI();
          refreshQCColors();
          return;
        }

        const targets = Array.from(selectedBlocks);
        const snap = performOsnap(raycaster, targets);
        if (snap) {
          saveState();

          if (isAltDown) {
            const newSelection: THREE.Mesh[] = [];
            selectedBlocks.forEach(mesh => {
              const bData = placedBlocks.find(b => b.mesh === mesh);
              if (bData) {
                const clone = new THREE.Mesh();
                applyModuleStyle(clone, bData.typeKey);
                mesh.getWorldPosition(clone.position);
                mesh.getWorldQuaternion(clone.quaternion);
                clone.castShadow = true; clone.receiveShadow = true;
                scene.add(clone);
                placedBlocks.push({ id: crypto.randomUUID(), typeKey: bData.typeKey, elecKey: bData.elecKey, roofKey: bData.roofKey, mesh: clone });
                newSelection.push(clone);
              }
            });
            updateSelection(null, false);
            newSelection.forEach(m => updateSelection(m, true));
          }

          isVertexDragging = true;
          orbitControls.enabled = false;
          snapStartVertex = snap.point;
          dragOffsets.clear();
          selectedBlocks.forEach(b => dragOffsets.set(b, b.position.clone()));
          return;
        }
      }

      const targetMeshes = placedBlocks.map(b => b.mesh);
      const intersects = raycaster.intersectObjects(targetMeshes, false);
      if (intersects.length > 0) {
        updateSelection(intersects[0].object as THREE.Mesh, event.shiftKey || event.metaKey);
      } else {
        updateSelection(null, false);
      }
      return;
    }

    if (isPlacementMode) {
      saveState();
      const selectedType = selectEl.value;
      const blueprint = blueprints[selectedType];

      blueprint.geometry.computeBoundingBox();
      const baseSize = new THREE.Vector3();
      blueprint.geometry.boundingBox!.getSize(baseSize);

      const worldNewSize = baseSize.clone();
      if (blueprint.group === 'corridor') worldNewSize.set(baseSize.z, baseSize.y, baseSize.x);

      let spawnPos: THREE.Vector3 | null = null;
      const targetMeshes = placedBlocks.map(b => b.mesh);
      const blockIntersects = raycaster.intersectObjects(targetMeshes, false);

      if (blockIntersects.length > 0) {
        const hit = blockIntersects[0];
        if (hit.face) {
          const targetMesh = hit.object as THREE.Mesh;
          const normal = hit.face.normal.clone().transformDirection(targetMesh.matrixWorld).normalize();
          const targetBox = new THREE.Box3().setFromObject(targetMesh);
          const targetSize = new THREE.Vector3();
          targetBox.getSize(targetSize);

          const offsetX = normal.x * ((targetSize.x / 2) + (worldNewSize.x / 2));
          const offsetY = normal.y * ((targetSize.y / 2) + (worldNewSize.y / 2));
          const offsetZ = normal.z * ((targetSize.z / 2) + (worldNewSize.z / 2));
          spawnPos = targetMesh.position.clone().add(new THREE.Vector3(offsetX, offsetY, offsetZ));
        }
      } else {
        const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        const intersectPoint = new THREE.Vector3();
        if (raycaster.ray.intersectPlane(floorPlane, intersectPoint)) {
          spawnPos = new THREE.Vector3(
            Math.round(intersectPoint.x / globalSnap) * globalSnap,
            worldNewSize.y / 2,
            Math.round(intersectPoint.z / globalSnap) * globalSnap
          );
        }
      }

      if (spawnPos) {
        const blockMesh = new THREE.Mesh();
        applyModuleStyle(blockMesh, selectedType);

        blockMesh.position.set(
          Math.round(spawnPos.x * 1000) / 1000,
          Math.round(spawnPos.y * 1000) / 1000,
          Math.round(spawnPos.z * 1000) / 1000
        );
        if (blueprint.group === 'corridor') {
          blockMesh.rotation.y = Math.PI / 2;
          blockMesh.updateMatrix();
        }
        blockMesh.castShadow = true; blockMesh.receiveShadow = true;
        scene.add(blockMesh);
        placedBlocks.push({ id: crypto.randomUUID(), typeKey: selectedType, mesh: blockMesh });
        updateCostUI();
        refreshQCColors();
      }
    }
  }
});

renderer.domElement.addEventListener("pointerup", (event) => {
  const deltaX = Math.abs(event.clientX - dragStartX);
  const deltaY = Math.abs(event.clientY - dragStartY);
  const timeElapsed = Date.now() - dragStartTime;

  if (event.button === 2) {
    if (deltaX < 10 && deltaY < 10 && timeElapsed < 250 && !isPlacementMode) {
      const rect = renderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, activeCamera);

      const targetMeshes = placedBlocks.map(b => b.mesh);
      const intersects = raycaster.intersectObjects(targetMeshes, false);

      if (intersects.length > 0) {
        const clickedMesh = intersects[0].object as THREE.Mesh;
        if (!selectedBlocks.has(clickedMesh)) updateSelection(clickedMesh, false);
        contextMenu.style.display = "flex";
        contextMenu.style.left = `${event.clientX}px`;
        contextMenu.style.top = `${event.clientY}px`;
      } else {
        contextMenu.style.display = "none";
      }
    }
    return;
  }

  if (event.button !== 0) return;

  if (isVertexDragging) {
    if (deltaX < 5 && deltaY < 5) return;

    isVertexDragging = false;
    orbitControls.enabled = true;
    updateCostUI();
    refreshQCColors();
    return;
  }

  const axisAtClick = clickedAxis;
  clickedAxis = null;

  if (deltaX < 5 && deltaY < 5 && axisAtClick && selectedBlocks.size > 0) {
    if (axisAtClick === "X" || axisAtClick === "Y" || axisAtClick === "Z") {
      setTimeout(() => {
        const isRotate = transformControls.mode === "rotate";
        const unit = isRotate ? "degrees" : "meters";
        const input = window.prompt(`Offset along ${axisAtClick} axis (${unit}):`, "0");

        if (input !== null) {
          const val = parseFloat(input);
          if (!isNaN(val)) {
            saveState();
            const axisLower = axisAtClick.toLowerCase() as "x" | "y" | "z";
            const target = selectedBlocks.size === 1 ? Array.from(selectedBlocks)[0] : transformGroup;
            if (isRotate) target.rotation[axisLower] += THREE.MathUtils.degToRad(val);
            else target.position[axisLower] = Math.round((target.position[axisLower] + val) * 1000) / 1000;

            target.updateMatrix();
            updatePropertiesUI();
            updateCostUI();
            refreshQCColors();
          }
        }
      }, 10);
    }
  }
});

const modeSelectBtn = document.getElementById("mode-select-btn")!;
const modeBuildBtn = document.getElementById("mode-build-btn")!;

function updateModeUI() {
  if (isPlacementMode) {
    modeBuildBtn.style.background = "#629270";
    modeSelectBtn.style.background = "#3c5444";
  } else {
    modeSelectBtn.style.background = "#629270";
    modeBuildBtn.style.background = "#3c5444";
  }
}
updateModeUI();

modeSelectBtn.addEventListener("click", () => {
  isPlacementMode = false;
  updateModeUI();
});

modeBuildBtn.addEventListener("click", () => {
  isPlacementMode = true;
  updateSelection(null, false);
  updateModeUI();
});

const categoryMap: Record<string, string> = {
  ELEC: "Electrical Equipment",
  CAB: "Electrical Equipment",
  MEC: "Electrical Equipment",
  PER: "Metal Profiles",
  EST: "Metal Profiles",
  REV: "Walls & Finishes",
  PAN: "Walls & Finishes",
  FONT: "Toilet & Plumbing",
  SANI: "Toilet & Plumbing",
  CARP: "Doors & Windows",
  PUE: "Doors & Windows",
  VEN: "Doors & Windows"
};

function getCategory(id: string): string {
  const prefix = id.split('-')[0].toUpperCase();
  return categoryMap[prefix] || "Miscellaneous";
}

function updateCostUI() {
  let classroomCount = 0; let corridorCount = 0; let totalCost = 0;
  let standardLinks = 0; let panelLinks = 0; let simpleLinks = 0; let verticalLinks = 0;

  const elecCounts: Record<string, number> = {};
  const roofCounts: Record<string, number> = {};
  const feeCounts: Record<string, number> = {};

  const shoppingCart: Record<string, { name: string; qty: number }> = {};
  let dynamicWallMeters = 0;

  // MODIFIED: We now accept a multiplier so we can add specific kit quantities based on structural counting!
  function addBomToCart(key: string, multiplier: number = 1) {
    const partBom = (bomData as any)[key];
    if (partBom) {
      for (const [id, details] of Object.entries(partBom)) {
        if (!details || !(details as any).name || (details as any).name.trim() === '') continue;

        if (!shoppingCart[id]) shoppingCart[id] = { name: (details as any).name, qty: 0 };
        // Multiply the quantity needed by the amount of times this assembly occurs
        shoppingCart[id].qty += ((details as any).qty * multiplier);
      }
    }
  }

  placedBlocks.forEach(b => {
    const bp = blueprints[b.typeKey];

    if (bp.group === 'classroom') {
      classroomCount++;
      addBomToCart('ESTRUCTURA');
    }

    if (bp.group === 'corridor') {
      corridorCount++;
      if (b.typeKey === 'CorridorStructure') {
        const dynWalls = getDynamicWalls(b, placedBlocks);
        if (dynWalls.posX) dynamicWallMeters += 2.44;
        if (dynWalls.negX) dynamicWallMeters += 2.44;
        if (dynWalls.posZ) dynamicWallMeters += 6.00;
        if (dynWalls.negZ) dynamicWallMeters += 6.00;
      }
    }

    feeCounts[b.typeKey] = (feeCounts[b.typeKey] || 0) + 1;
    totalCost += bp.cost;

    if (b.elecKey) elecCounts[b.elecKey] = (elecCounts[b.elecKey] || 0) + 1;
    if (b.roofKey) roofCounts[b.roofKey] = (roofCounts[b.roofKey] || 0) + 1;

    addBomToCart(b.typeKey);
    if (b.elecKey) addBomToCart(b.elecKey);
    if (b.roofKey) addBomToCart(b.roofKey);
  });

  if (dynamicWallMeters > 0) {
    shoppingCart["REV-DYN-WALL"] = {
      name: "Corridor Dynamic Walls (Linear m)",
      qty: parseFloat(dynamicWallMeters.toFixed(2))
    };
  }

  const allBlocks = placedBlocks;
  for (let i = 0; i < allBlocks.length; i++) {
    for (let j = i + 1; j < allBlocks.length; j++) {
      const b1 = allBlocks[i]; const b2 = allBlocks[j];
      const box1 = new THREE.Box3().setFromObject(b1.mesh);
      const box2 = new THREE.Box3().setFromObject(b2.mesh);
      box1.expandByScalar(0.05);

      if (box1.intersectsBox(box2)) {
        const overlap = box1.clone().intersect(box2);
        const size = new THREE.Vector3();
        overlap.getSize(size);
        const dy = Math.abs(b1.mesh.position.y - b2.mesh.position.y);

        if (dy > 1.5 && size.x > 0.2 && size.z > 0.2) {
          verticalLinks++;
        }
        else if (dy < 1.5 && blueprints[b1.typeKey].group === 'classroom' && blueprints[b2.typeKey].group === 'classroom') {
          const dir = b2.mesh.getWorldPosition(new THREE.Vector3()).sub(b1.mesh.getWorldPosition(new THREE.Vector3()));
          const localDir1 = dir.clone().applyEuler(new THREE.Euler().setFromQuaternion(b1.mesh.getWorldQuaternion(new THREE.Quaternion()).invert()));
          if (Math.abs(localDir1.z) > 1.5 && Math.abs(localDir1.x) < 5.0) {
            const b1Side = localDir1.z > 0 ? 'right' : 'left';
            const b1HasWall = blueprints[b1.typeKey].walls[b1Side];
            const localDir2 = dir.clone().negate().applyEuler(new THREE.Euler().setFromQuaternion(b2.mesh.getWorldQuaternion(new THREE.Quaternion()).invert()));
            const b2Side = localDir2.z > 0 ? 'right' : 'left';
            const b2HasWall = blueprints[b2.typeKey].walls[b2Side];
            const wallCount = (b1HasWall ? 1 : 0) + (b2HasWall ? 1 : 0);
            if (wallCount === 0) standardLinks++; else if (wallCount === 1) panelLinks++; else simpleLinks++;
          }
        }
      }
    }
  }

  // ADDED: Inject Adosamientos into BOM Cart using the counts generated above
  // (Assuming you named the Excel files 'WEB-XXX LARGO_STANDARD.xlsx' and 'WEB-XXX LARGO.xlsx' so the script grabbed these keys)
  if (standardLinks > 0) addBomToCart('LARGO_STANDARD', standardLinks);
  if (panelLinks > 0) addBomToCart('LARGO', panelLinks);

  document.getElementById("qto-list")!.innerHTML = `
    <div style="display: flex; justify-content: space-between; color: #ccc;"><span>Classrooms:</span><span>${classroomCount}</span></div>
    <div style="display: flex; justify-content: space-between; color: #ccc;"><span>Corridors:</span><span>${corridorCount}</span></div>
  `;
  document.getElementById("link-standard")!.innerText = standardLinks.toString();
  document.getElementById("link-panel")!.innerText = panelLinks.toString();
  document.getElementById("link-simples")!.innerText = simpleLinks.toString();
  document.getElementById("link-verticales")!.innerText = verticalLinks.toString();

  const groupedCart: Record<string, { id: string, name: string, qty: number }[]> = {};
  for (const [id, item] of Object.entries(shoppingCart)) {
    const cat = getCategory(id);
    if (!groupedCart[cat]) groupedCart[cat] = [];
    groupedCart[cat].push({ id, name: item.name, qty: item.qty });
  }

  let bomHTML = '';
  for (const [cat, items] of Object.entries(groupedCart)) {
    bomHTML += `<div style="background: #111; color: #74a382; padding: 4px; margin-top: 6px; font-weight: bold; font-size: 0.85em; border-radius: 3px;">${cat}</div>`;
    for (const item of items) {
      bomHTML += `<div style="display: flex; justify-content: space-between; color: #ccc; font-size: 0.85em; margin: 2px 0 2px 8px;">
        <span title="${item.id}" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 200px;">${item.name}</span>
        <span style="color: white; font-weight: bold;">${item.qty}</span>
      </div>`;
    }
  }
  document.getElementById("boq-bom-list")!.innerHTML = bomHTML || `<div style="color: #666; font-style: italic;">No items loaded</div>`;


  let roofHTML = '';
  for (const [key, count] of Object.entries(roofCounts)) {
    roofHTML += `<div style="display: flex; justify-content: space-between; color: #ccc;"><span>${roofKits[key].name}:</span> <span>${count}</span></div>`;
  }
  document.getElementById("boq-roof-list")!.innerHTML = roofHTML || `<div style="color: #666; font-style: italic;">No roofs assigned</div>`;

  let feeHTML = '';
  for (const [key, count] of Object.entries(feeCounts)) {
    const bp = blueprints[key];
    feeHTML += `<div style="display: flex; justify-content: space-between;"><span>${bp.name} (x${count})</span><span>€${count * bp.cost}</span></div>`;
  }
  document.getElementById("fee-list")!.innerHTML = feeHTML || `<div style="color: #666; font-style: italic;">No modules placed.</div>`;
  document.getElementById("total-cost")!.innerText = `€${totalCost}`;

  (window as any).__boqData = {
    classrooms: classroomCount, corridors: corridorCount,
    bom: shoppingCart, elec: elecCounts, roofs: roofCounts,
    standardLinks, panelLinks, simpleLinks, verticalLinks, totalFee: totalCost
  };
}

document.getElementById("export-csv-btn")!.addEventListener("click", async () => {
  const data = (window as any).__boqData;
  if (!data) return alert("Nothing to export!");

  let csv = "Category,Item ID,Item Name,Quantity\n";
  csv += `Modules,,Classrooms,${data.classrooms}\n`;
  csv += `Modules,,Corridors,${data.corridors}\n`;

  for (const [id, item] of Object.entries(data.bom)) {
    const cleanName = (item as any).name.replace(/"/g, '""');
    const cat = getCategory(id);
    csv += `BOM - ${cat},${id},"${cleanName}",${(item as any).qty}\n`;
  }

  for (const [key, count] of Object.entries(data.elec)) {
    csv += `Electrical Kits,${key},${electricalKits[key as string].name},${count}\n`;
  }

  for (const [key, count] of Object.entries(data.roofs)) {
    csv += `Roofs,${key},${roofKits[key as string].name},${count}\n`;
  }

  csv += `Adosamientos,,Largo Standard,${data.standardLinks}\n`;
  csv += `Adosamientos,,Largo Panel,${data.panelLinks}\n`;
  csv += `Adosamientos,,Simples,${data.simpleLinks}\n`;
  csv += `Adosamientos,,Conexiones Verticales,${data.verticalLinks}\n`;
  csv += `Project Fee,,Total Fee (EUR),${data.totalFee}\n`;

  try {
    if ('showSaveFilePicker' in window) {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: 'modular_school_boq.csv',
        types: [{
          description: 'CSV File',
          accept: { 'text/csv': ['.csv'] },
        }],
      });
      const writable = await handle.createWritable();
      await writable.write(csv);
      await writable.close();
    } else {
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "modular_school_boq.csv";
      a.click();
      URL.revokeObjectURL(url);
    }
  } catch (err: any) {
    if (err.name !== 'AbortError') {
      console.error("Export failed:", err);
      alert("An error occurred while exporting the CSV.");
    }
  }
});

const feeBtn = document.getElementById("toggle-fee-btn")!;
const feePanel = document.getElementById("fee-panel")!;
feeBtn.addEventListener("click", () => {
  if (feePanel.style.display === "none") {
    feePanel.style.display = "block";
    feeBtn.innerText = "Hide Project Fee";
  } else {
    feePanel.style.display = "none";
    feeBtn.innerText = "Show Project Fee";
  }
});

const gizmoModeBtn = document.getElementById("gizmo-mode-btn")!;
gizmoModeBtn.addEventListener("click", () => {
  if (activeTool === 'translate') {
    activeTool = 'rotate';
    transformControls.setMode("rotate");
    transformControls.enabled = true;
    if (selectedBlocks.size > 0) updateSelection(null, true);
    gizmoModeBtn.innerText = "Gizmo: ROTATE";
    gizmoModeBtn.style.background = "#3b5945";
  } else if (activeTool === 'rotate') {
    activeTool = 'osnap';
    transformControls.detach();
    gizmoModeBtn.innerHTML = "<b>Tool: OSNAP (Magnet)</b>";
    gizmoModeBtn.style.background = "#e74c3c";
  } else {
    activeTool = 'translate';
    transformControls.setMode("translate");
    transformControls.enabled = true;
    if (selectedBlocks.size > 0) updateSelection(null, true);
    gizmoModeBtn.innerText = "Gizmo: TRANSLATE";
    gizmoModeBtn.style.background = "#466b53";
  }
});

const zoomExtentsBtn = document.getElementById("zoom-extents-btn")!;
zoomExtentsBtn.addEventListener("click", () => {
  if (placedBlocks.length === 0) {
    orbitControls.target.set(0, 0, 0);
    if (isPlanView) {
      cameraOrtho.position.set(0, 50, 0);
      cameraOrtho.zoom = 1;
      cameraOrtho.updateProjectionMatrix();
    } else {
      cameraPerspective.position.set(15, 15, 15);
    }
    orbitControls.update();
    return;
  }

  const box = new THREE.Box3();
  placedBlocks.forEach(b => {
    const meshBox = new THREE.Box3().setFromObject(b.mesh);
    box.expandByPoint(meshBox.min);
    box.expandByPoint(meshBox.max);
  });

  const center = new THREE.Vector3();
  box.getCenter(center);
  const size = new THREE.Vector3();
  box.getSize(size);

  const maxDim = Math.max(size.x, size.y, size.z);

  if (isPlanView) {
    orbitControls.target.set(center.x, 0, center.z);
    cameraOrtho.position.set(center.x, 50, center.z);
    cameraOrtho.zoom = viewSize / (maxDim * 1.2);
    cameraOrtho.updateProjectionMatrix();
  } else {
    orbitControls.target.copy(center);
    const fov = cameraPerspective.fov * (Math.PI / 180);
    let cameraZ = Math.abs(maxDim / 2 / Math.tan(fov / 2));
    cameraZ *= 1.5;

    const direction = cameraPerspective.position.clone().sub(center).normalize();
    if (direction.lengthSq() < 0.01) direction.set(1, 1, 1).normalize();

    cameraPerspective.position.copy(center).add(direction.multiplyScalar(cameraZ));
  }
  orbitControls.update();
});

const viewModeBtn = document.getElementById("view-mode-btn")!;
viewModeBtn.addEventListener("click", () => {
  isPlanView = !isPlanView;
  if (isPlanView) {
    activeCamera = cameraOrtho;
    cameraOrtho.position.set(orbitControls.target.x, 50, orbitControls.target.z);
    orbitControls.object = cameraOrtho;
    orbitControls.enableRotate = false;
    viewModeBtn.innerText = "3D Perspective";
    viewModeBtn.style.background = "#f39c12";
  } else {
    activeCamera = cameraPerspective;
    orbitControls.object = cameraPerspective;
    orbitControls.enableRotate = true;
    viewModeBtn.innerText = "2D Plan View";
    viewModeBtn.style.background = "#52795f";
  }
  transformControls.camera = activeCamera;
  orbitControls.update();
});

const qcElecBtn = document.getElementById("qc-elec-btn")!;
const qcRoofBtn = document.getElementById("qc-roof-btn")!;
const qcOrientBtn = document.getElementById("qc-orient-btn")!;
const qcLinksBtn = document.getElementById("qc-links-btn")!;

qcElecBtn.addEventListener("click", () => {
  activeQC = activeQC === 'elec' ? 'none' : 'elec';
  refreshQCColors();
});

qcRoofBtn.addEventListener("click", () => {
  activeQC = activeQC === 'roof' ? 'none' : 'roof';
  refreshQCColors();
});

qcOrientBtn.addEventListener("click", () => {
  activeQC = activeQC === 'orient' ? 'none' : 'orient';
  refreshQCColors();
});

qcLinksBtn.addEventListener("click", () => {
  activeQC = activeQC === 'links' ? 'none' : 'links';
  refreshQCColors();
});

document.getElementById("save-btn")!.addEventListener("click", async () => {
  if (placedBlocks.length === 0) return alert("Nothing to save!");

  updateSelection(null, false);

  const dataToSave = placedBlocks.map(b => ({
    id: b.id, typeKey: b.typeKey, elecKey: b.elecKey, roofKey: b.roofKey,
    pos: { x: b.mesh.position.x, y: b.mesh.position.y, z: b.mesh.position.z },
    rot: { x: b.mesh.rotation.x, y: b.mesh.rotation.y, z: b.mesh.rotation.z }
  }));

  const jsonString = JSON.stringify(dataToSave, null, 2);

  try {
    if ('showSaveFilePicker' in window) {
      const handle = await (window as any).showSaveFilePicker({
        suggestedName: 'modular_school.json',
        types: [{
          description: 'JSON File',
          accept: { 'application/json': ['.json'] },
        }],
      });
      const writable = await handle.createWritable();
      await writable.write(jsonString);
      await writable.close();
    } else {
      const blob = new Blob([jsonString], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "modular_school.json";
      a.click();
      URL.revokeObjectURL(url);
    }
  } catch (err: any) {
    if (err.name !== 'AbortError') {
      console.error("Save failed:", err);
      alert("An error occurred while saving the file.");
    }
  }
});

const loadInput = document.getElementById("load-file-input") as HTMLInputElement;
document.getElementById("load-btn")!.addEventListener("click", () => loadInput.click());
loadInput.addEventListener("change", (event) => {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const data = JSON.parse(e.target?.result as string);
      updateSelection(null, false);
      placedBlocks.forEach(b => {
        scene.remove(b.mesh);
        b.mesh.geometry.dispose();
        if (b.mesh.material) {
          if (Array.isArray(b.mesh.material)) b.mesh.material.forEach(m => m.dispose());
          else (b.mesh.material as THREE.Material).dispose();
        }
      });
      placedBlocks.length = 0; history.length = 0;

      data.forEach((bData: any) => {
        const bp = blueprints[bData.typeKey];
        if (!bp) return;
        const mesh = new THREE.Mesh();
        applyModuleStyle(mesh, bData.typeKey);
        mesh.position.set(bData.pos.x, bData.pos.y, bData.pos.z);
        mesh.rotation.set(bData.rot.x, bData.rot.y, bData.rot.z);
        mesh.castShadow = true; mesh.receiveShadow = true;
        scene.add(mesh);
        placedBlocks.push({ id: bData.id || crypto.randomUUID(), typeKey: bData.typeKey, elecKey: bData.elecKey, roofKey: bData.roofKey, mesh });
      });
      updateCostUI(); updatePropertiesUI(); refreshQCColors();
    } catch (err) { alert("Failed to load file. Ensure it is a valid project JSON."); }
  };
  reader.readAsText(file);
  loadInput.value = "";
});

document.getElementById("export-gltf-btn")!.addEventListener("click", () => {
  if (placedBlocks.length === 0) return alert("Nothing to export yet!");
  const exporter = new GLTFExporter();
  const exportScene = new THREE.Scene();
  placedBlocks.forEach(b => {
    const clone = b.mesh.clone();
    b.mesh.getWorldPosition(clone.position);
    b.mesh.getWorldQuaternion(clone.quaternion);

    if (Array.isArray(clone.material)) clone.material = new THREE.MeshStandardMaterial();
    (clone.material as THREE.MeshStandardMaterial).color.set(blueprints[b.typeKey].color);
    (clone.material as THREE.MeshStandardMaterial).transparent = true;
    (clone.material as THREE.MeshStandardMaterial).opacity = 0.9;
    (clone.material as THREE.MeshStandardMaterial).depthWrite = true;

    exportScene.add(clone);
  });
  exporter.parse(exportScene, (gltf) => {
    const blob = new Blob([JSON.stringify(gltf, null, 2)], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "modular_model.gltf"; a.click(); URL.revokeObjectURL(url);
  }, (err) => console.error(err), { binary: false });
});

document.getElementById("export-ifc-btn")!.addEventListener("click", () => {
  alert("IFC EXPORT UNAVAILABLE: Currently using standard THREE meshes. Web-IFC implementation required for full BIM data export.");
});

function updateSizing() {
  if (!container) return;
  const width = container.clientWidth; const height = container.clientHeight;
  if (width === 0 || height === 0) return;
  const currentAspect = width / height;
  cameraPerspective.aspect = currentAspect; cameraPerspective.updateProjectionMatrix();
  cameraOrtho.left = -viewSize * currentAspect / 2; cameraOrtho.right = viewSize * currentAspect / 2;
  cameraOrtho.top = viewSize / 2; cameraOrtho.bottom = -viewSize / 2;
  cameraOrtho.updateProjectionMatrix();
  renderer.setSize(width, height);
}
window.addEventListener("resize", updateSizing);
setTimeout(updateSizing, 100);