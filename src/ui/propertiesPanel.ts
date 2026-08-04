import * as THREE from "three";
import { store } from "../store";
import { blueprints } from "../data/blueprints";
import { electricalKits } from "../data/electricalKits";
import { roofKits } from "../data/roofKits";
import { saveState } from "../modules/history";

// ── DOM refs (resolved once at module load, DOM is ready by then) ─────────────

const propsPanel = document.getElementById("properties-panel")!;
const propName   = document.getElementById("prop-name")!;
const propDesc   = document.getElementById("prop-desc")!;
const elecDesc   = document.getElementById("elec-desc")!;
const roofDesc   = document.getElementById("roof-desc")!;
const posX       = document.getElementById("pos-x") as HTMLInputElement;
const posY       = document.getElementById("pos-y") as HTMLInputElement;
const posZ       = document.getElementById("pos-z") as HTMLInputElement;
const rotX       = document.getElementById("rot-x") as HTMLInputElement;
const rotY       = document.getElementById("rot-y") as HTMLInputElement;
const rotZ       = document.getElementById("rot-z") as HTMLInputElement;
export const elecSelect = document.getElementById("elec-select") as HTMLSelectElement;
export const roofSelect = document.getElementById("roof-select") as HTMLSelectElement;

// ── UI Update ─────────────────────────────────────────────────────────────────

/** Refreshes the properties panel to reflect the current selection. */
export function updatePropertiesUI(): void {
  if (store.selectedBlocks.size === 0) {
    propsPanel.style.display = "none";
    return;
  }
  propsPanel.style.display = "block";

  if (store.selectedBlocks.size > 1) {
    propName.innerText = "Multiple Elements Selected";
    propDesc.innerText = `You are moving ${store.selectedBlocks.size} modules simultaneously.`;
    [posX, posY, posZ, rotX, rotY, rotZ].forEach((i) => (i.disabled = true));

    const firstMesh  = Array.from(store.selectedBlocks)[0];
    const firstBData = store.placedBlocks.find((b) => b.mesh === firstMesh);

    const allSameElec = Array.from(store.selectedBlocks).every(
      (m) => store.placedBlocks.find((b) => b.mesh === m)?.elecKey === firstBData?.elecKey,
    );
    elecSelect.value = allSameElec && firstBData?.elecKey ? firstBData.elecKey : "";
    elecDesc.innerText =
      allSameElec && firstBData?.elecKey
        ? electricalKits[firstBData.elecKey].desc
        : "Mixed or No electrical kits assigned.";

    const allSameRoof = Array.from(store.selectedBlocks).every(
      (m) => store.placedBlocks.find((b) => b.mesh === m)?.roofKey === firstBData?.roofKey,
    );
    roofSelect.value = allSameRoof && firstBData?.roofKey ? firstBData.roofKey : "";
    roofDesc.innerText =
      allSameRoof && firstBData?.roofKey
        ? roofKits[firstBData.roofKey].desc
        : "Mixed or No roof assigned.";
    return;
  }

  [posX, posY, posZ, rotX, rotY, rotZ].forEach((i) => (i.disabled = false));
  const singleMesh = Array.from(store.selectedBlocks)[0];
  const bData      = store.placedBlocks.find((b) => b.mesh === singleMesh);

  if (bData) {
    const bp       = blueprints[bData.typeKey];
    propName.innerText = bp.name;
    propDesc.innerText = bp.desc;

    if (bData.elecKey && electricalKits[bData.elecKey]) {
      elecSelect.value   = bData.elecKey;
      elecDesc.innerText = electricalKits[bData.elecKey].desc;
    } else {
      elecSelect.value   = "";
      elecDesc.innerText = "No electrical kit assigned.";
    }

    if (bData.roofKey && roofKits[bData.roofKey]) {
      roofSelect.value   = bData.roofKey;
      roofDesc.innerText = roofKits[bData.roofKey].desc;
    } else {
      roofSelect.value   = "";
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

// ── Parametric Position / Rotation Edit ───────────────────────────────────────

/** Applies the values typed into the position/rotation inputs to the selected mesh. */
export function applyParametricEdit(): void {
  if (store.selectedBlocks.size !== 1) return;
  saveState();
  const mesh = Array.from(store.selectedBlocks)[0];
  mesh.position.set(
    parseFloat(posX.value) || 0,
    parseFloat(posY.value) || 0,
    parseFloat(posZ.value) || 0,
  );
  mesh.rotation.set(
    THREE.MathUtils.degToRad(parseFloat(rotX.value) || 0),
    THREE.MathUtils.degToRad(parseFloat(rotY.value) || 0),
    THREE.MathUtils.degToRad(parseFloat(rotZ.value) || 0),
  );
  mesh.updateMatrix();
}

// ── Event Listener Init ───────────────────────────────────────────────────────

export interface PropertiesPanelCallbacks {
  onSaveState:  () => void;
  onCostUpdate: () => void;
  onQCRefresh:  () => void;
}

/**
 * Wires up the elec/roof select changes and the position/rotation input changes.
 * Call once after the DOM is ready.
 */
export function initPropertiesPanel(cb: PropertiesPanelCallbacks): void {
  elecSelect.addEventListener("change", (e) => {
    const val = (e.target as HTMLSelectElement).value;
    if (store.selectedBlocks.size === 0) return;
    cb.onSaveState();
    store.selectedBlocks.forEach((mesh) => {
      const bData = store.placedBlocks.find((b) => b.mesh === mesh);
      if (bData) bData.elecKey = val || undefined;
    });
    updatePropertiesUI();
    cb.onCostUpdate();
    cb.onQCRefresh();
  });

  roofSelect.addEventListener("change", (e) => {
    const val = (e.target as HTMLSelectElement).value;
    if (store.selectedBlocks.size === 0) return;
    cb.onSaveState();
    store.selectedBlocks.forEach((mesh) => {
      const bData = store.placedBlocks.find((b) => b.mesh === mesh);
      if (bData) bData.roofKey = val || undefined;
    });
    updatePropertiesUI();
    cb.onCostUpdate();
    cb.onQCRefresh();
  });

  [posX, posY, posZ, rotX, rotY, rotZ].forEach((input) =>
    input.addEventListener("change", () => {
      applyParametricEdit();
      cb.onCostUpdate();
      cb.onQCRefresh();
    }),
  );
}
