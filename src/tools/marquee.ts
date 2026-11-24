import * as THREE from "three";
import type { PlacedModule } from "../types";
import { computeModuleBoxes } from "../bom/linkDetector";

// CAD-style box selection, started by a left-drag on empty space:
//   left → right  = WINDOW   (solid blue): only modules fully inside the box
//   right → left  = CROSSING (dashed green): anything the box touches
// Holding Shift adds to the current selection. Escape cancels.

const DRAG_THRESHOLD = 4; // px before a click becomes a box

/** The 8 corners of a box as min/max flags per axis. */
const CORNERS = [0, 1].flatMap((x) =>
  [0, 1].flatMap((y) => [0, 1].map((z) => [x, y, z])),
);

interface MarqueeDeps {
  canvas: HTMLCanvasElement;
  getCamera: () => THREE.Camera;
  getBlocks: () => PlacedModule[];
  /** Box finished: select these meshes (add = keep current selection). */
  onSelect: (meshes: THREE.Mesh[], add: boolean) => void;
  /** Plain click on empty space (no drag). */
  onEmptyClick: (add: boolean) => void;
}

let deps: MarqueeDeps;
let start: { x: number; y: number } | null = null;
let dragging = false;
let box: HTMLDivElement;

export function initMarquee(d: MarqueeDeps): void {
  deps = d;
  box = document.createElement("div");
  box.className = "marquee-box";
  box.hidden = true;
  document.body.appendChild(box);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") cancelMarquee();
  });
  window.addEventListener("blur", cancelMarquee);
}

/** True while a box is being drawn (other drag tools should stay quiet). */
export const isMarqueeActive = (): boolean => dragging;

/** Call on a left pointerdown over empty space. */
export function beginMarquee(event: PointerEvent): void {
  start = { x: event.clientX, y: event.clientY };
  dragging = false;
}

export function cancelMarquee(): void {
  start = null;
  dragging = false;
  if (box) box.hidden = true;
}

function rectFrom(e: { clientX: number; clientY: number }) {
  const s = start!;
  return {
    left: Math.min(s.x, e.clientX),
    right: Math.max(s.x, e.clientX),
    top: Math.min(s.y, e.clientY),
    bottom: Math.max(s.y, e.clientY),
    crossing: e.clientX < s.x,
  };
}

function onMove(e: PointerEvent): void {
  if (!start) return;
  if (!dragging) {
    if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < DRAG_THRESHOLD)
      return;
    dragging = true;
  }
  const r = rectFrom(e);
  box.hidden = false;
  box.classList.toggle("crossing", r.crossing);
  box.style.left = `${r.left}px`;
  box.style.top = `${r.top}px`;
  box.style.width = `${r.right - r.left}px`;
  box.style.height = `${r.bottom - r.top}px`;
}

function onUp(e: PointerEvent): void {
  if (!start || e.button !== 0) return;
  const add = e.shiftKey || e.metaKey;
  if (!dragging) {
    cancelMarquee();
    deps.onEmptyClick(add);
    return;
  }
  const r = rectFrom(e);
  cancelMarquee();
  deps.onSelect(pick(r), add);
}

/** Modules whose on-screen box is inside (window) or touches (crossing) the rectangle. */
function pick(r: ReturnType<typeof rectFrom>): THREE.Mesh[] {
  const camera = deps.getCamera();
  const canvasRect = deps.canvas.getBoundingClientRect();
  const blocks = deps.getBlocks();
  const boxes = computeModuleBoxes(blocks);
  const v = new THREE.Vector3();
  const picked: THREE.Mesh[] = [];

  for (const b of blocks) {
    const wb = boxes.get(b)!;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let behind = false;
    for (const [cx, cy, cz] of CORNERS) {
      v.set(
        cx ? wb.max.x : wb.min.x,
        cy ? wb.max.y : wb.min.y,
        cz ? wb.max.z : wb.min.z,
      ).project(camera);
      if (v.z > 1 || v.z < -1) behind = true;
      const sx = canvasRect.left + ((v.x + 1) / 2) * canvasRect.width;
      const sy = canvasRect.top + ((1 - v.y) / 2) * canvasRect.height;
      minX = Math.min(minX, sx);
      maxX = Math.max(maxX, sx);
      minY = Math.min(minY, sy);
      maxY = Math.max(maxY, sy);
    }
    if (behind) continue;
    const inside =
      minX >= r.left && maxX <= r.right && minY >= r.top && maxY <= r.bottom;
    const touches =
      maxX >= r.left && minX <= r.right && maxY >= r.top && minY <= r.bottom;
    if (r.crossing ? touches : inside) picked.push(b.mesh);
  }
  return picked;
}
