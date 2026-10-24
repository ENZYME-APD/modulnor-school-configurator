import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { TransformControls } from "three/examples/jsm/controls/TransformControls.js";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { store } from "../store";
import { consumeInvalidation, invalidate } from "./invalidate";

// ─────────────────────────────────────────────────────────────────────────────
// Viewer: renderer, cameras, lighting, post-processing, navigation and the
// on-demand render loop. Interaction logic lives in main.ts.
// ─────────────────────────────────────────────────────────────────────────────

const BACKGROUND = 0x1c1e20;
const VIEW_SIZE = 30; // ortho frustum height at zoom 1 (m)

export type ViewerCamera = THREE.PerspectiveCamera | THREE.OrthographicCamera;

export interface Viewer {
  scene: THREE.Scene;
  /** Helpers drawn on top of everything, without AO (gizmo, snap marker, QC links). */
  overlay: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  cameraPerspective: THREE.PerspectiveCamera;
  cameraOrtho: THREE.OrthographicCamera;
  readonly camera: ViewerCamera;
  orbitControls: OrbitControls;
  transformControls: TransformControls;
  transformGroup: THREE.Group;
  setPlanView(plan: boolean): void;
  zoomExtents(objects: THREE.Object3D[]): void;
  fitShadows(objects: THREE.Object3D[]): void;
  /** Normalised device coords → raycaster for the active camera. */
  raycasterFromEvent(event: {
    clientX: number;
    clientY: number;
  }): THREE.Raycaster;
  setTrackpadMode(on: boolean): void;
  setAmbientOcclusion(on: boolean): void;
}

export function createViewer(container: HTMLElement): Viewer {
  const width = container.clientWidth || 800;
  const height = container.clientHeight || 600;
  const aspect = width / height;

  // ── Scene ────────────────────────────────────────────────────────────────
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(BACKGROUND);
  scene.fog = new THREE.Fog(BACKGROUND, 120, 320);
  const overlay = new THREE.Scene();

  // ── Cameras ──────────────────────────────────────────────────────────────
  const cameraPerspective = new THREE.PerspectiveCamera(50, aspect, 0.1, 1000);
  cameraPerspective.position.set(18, 14, 18);

  const cameraOrtho = new THREE.OrthographicCamera(
    (-VIEW_SIZE * aspect) / 2,
    (VIEW_SIZE * aspect) / 2,
    VIEW_SIZE / 2,
    -VIEW_SIZE / 2,
    0.1,
    1000,
  );
  cameraOrtho.position.set(0, 50, 0);
  cameraOrtho.lookAt(0, 0, 0);

  let camera: ViewerCamera = cameraPerspective;

  // ── Renderer ─────────────────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  renderer.toneMapping = THREE.NeutralToneMapping; // keeps module colour-coding true
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.autoClear = false;
  container.appendChild(renderer.domElement);

  // ── Image-based lighting (studio environment, no external HDRI needed) ──
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.55;
  pmrem.dispose();

  // ── Lights ───────────────────────────────────────────────────────────────
  scene.add(new THREE.HemisphereLight(0xdfe8f5, 0x3a3328, 0.6));

  const sun = new THREE.DirectionalLight(0xfff4e5, 2.4);
  sun.position.set(-22, 38, 26); // from front-left so shadows read from the default view
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 3;
  scene.add(sun, sun.target);
  const sunOffset = sun.position.clone();

  // ── Ground ───────────────────────────────────────────────────────────────
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(600, 600),
    new THREE.MeshStandardMaterial({
      color: 0x2a2c2e,
      roughness: 0.95,
      metalness: 0,
    }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  ground.receiveShadow = true;
  scene.add(ground);

  const grid = new THREE.GridHelper(120, 120, 0x4a4e52, 0x35383b);
  (grid.material as THREE.Material).transparent = true;
  (grid.material as THREE.Material).opacity = 0.55;
  grid.position.y = 0.001;
  scene.add(grid);

  // ── Post-processing: MSAA → GTAO → tone mapping/sRGB ─────────────────────
  const renderTarget = new THREE.WebGLRenderTarget(width, height, {
    type: THREE.HalfFloatType,
    samples: 4,
  });
  const composer = new EffectComposer(renderer, renderTarget);
  const renderPass = new RenderPass(scene, camera);
  let gtaoPass = createGTAO(camera);
  const outputPass = new OutputPass();
  composer.addPass(renderPass);
  composer.addPass(gtaoPass);
  composer.addPass(outputPass);
  composer.setPixelRatio(renderer.getPixelRatio());
  composer.setSize(width, height);

  function createGTAO(cam: ViewerCamera): GTAOPass {
    const w = container.clientWidth || width;
    const h = container.clientHeight || height;
    const pass = new GTAOPass(scene, cam, w, h);
    pass.output = GTAOPass.OUTPUT.Default;
    pass.blendIntensity = 0.85;
    pass.updateGtaoMaterial({
      radius: 0.6,
      distanceExponent: 1.5,
      thickness: 1,
      scale: 1,
      samples: 16,
    });
    pass.updatePdMaterial({
      lumaPhi: 10,
      depthPhi: 2,
      normalPhi: 3,
      radius: 6,
      rings: 2,
      samples: 16,
    });
    return pass;
  }

  /** GTAO compiles camera-type defines at construction, so rebuild it on camera switch. */
  function rebuildGTAO(): void {
    const enabled = gtaoPass.enabled;
    composer.removePass(gtaoPass);
    gtaoPass.dispose();
    gtaoPass = createGTAO(camera);
    gtaoPass.enabled = enabled;
    composer.insertPass(gtaoPass, 1);
    composer.setSize(container.clientWidth, container.clientHeight);
  }

  // ── Controls ─────────────────────────────────────────────────────────────
  const orbitControls = new OrbitControls<ViewerCamera>(
    camera,
    renderer.domElement,
  );
  orbitControls.enableDamping = true;
  orbitControls.dampingFactor = 0.08;
  orbitControls.enableZoom = false; // custom zoom-to-cursor below
  orbitControls.mouseButtons = {
    LEFT: null as any,
    MIDDLE: THREE.MOUSE.PAN,
    RIGHT: THREE.MOUSE.ROTATE,
  };
  orbitControls.addEventListener("change", invalidate);

  const updateOrbitMode = (e: MouseEvent | KeyboardEvent) => {
    orbitControls.mouseButtons.MIDDLE =
      e.shiftKey || e.metaKey || e.ctrlKey
        ? THREE.MOUSE.ROTATE
        : THREE.MOUSE.PAN;
  };
  renderer.domElement.addEventListener("pointerdown", updateOrbitMode, {
    capture: true,
  });
  renderer.domElement.addEventListener("contextmenu", (e) =>
    e.preventDefault(),
  );
  window.addEventListener("keydown", updateOrbitMode);
  window.addEventListener("keyup", updateOrbitMode);
  window.addEventListener("blur", () => {
    orbitControls.mouseButtons.MIDDLE = THREE.MOUSE.PAN;
  });

  const transformGroup = new THREE.Group();
  scene.add(transformGroup);

  const transformControls = new TransformControls(camera, renderer.domElement);
  transformControls.setTranslationSnap(store.globalSnap);
  transformControls.setRotationSnap(THREE.MathUtils.degToRad(15));
  transformControls.addEventListener("change", invalidate);
  overlay.add(transformControls.getHelper());

  // ── Picking helper ───────────────────────────────────────────────────────
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function raycasterFromEvent(event: {
    clientX: number;
    clientY: number;
  }): THREE.Raycaster {
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(ndc, camera);
    return raycaster;
  }

  // ── Wheel navigation (zoom-to-cursor, trackpad orbit/pan, plan zoom) ─────
  let trackpadMode = false;
  const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();

  function panBy(dx: number, dy: number): void {
    const right = tmpA.setFromMatrixColumn(camera.matrix, 0);
    const up = tmpB.setFromMatrixColumn(camera.matrix, 1);
    camera.position.addScaledVector(right, dx).addScaledVector(up, -dy);
    orbitControls.target.addScaledVector(right, dx).addScaledVector(up, -dy);
  }

  renderer.domElement.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      event.stopImmediatePropagation();

      if (
        trackpadMode &&
        !event.ctrlKey &&
        !event.metaKey &&
        !store.isPlanView
      ) {
        if (event.shiftKey) {
          panBy(event.deltaX * 0.015, event.deltaY * 0.015);
        } else {
          const offset = camera.position.clone().sub(orbitControls.target);
          const spherical = new THREE.Spherical().setFromVector3(offset);
          spherical.theta += event.deltaX * 0.005;
          spherical.phi = THREE.MathUtils.clamp(
            spherical.phi + event.deltaY * 0.005,
            0.01,
            Math.PI - 0.01,
          );
          offset.setFromSpherical(spherical);
          camera.position.copy(orbitControls.target).add(offset);
          camera.lookAt(orbitControls.target);
        }
      } else if (store.isPlanView) {
        const ray = raycasterFromEvent(event);
        const before = ray.ray.origin.clone();
        cameraOrtho.zoom = Math.max(
          0.1,
          cameraOrtho.zoom * Math.exp(-event.deltaY * 0.0015),
        );
        cameraOrtho.updateProjectionMatrix();
        const after = raycasterFromEvent(event).ray.origin;
        const delta = before.sub(after);
        delta.y = 0;
        cameraOrtho.position.add(delta);
        orbitControls.target.add(delta);
      } else if (event.shiftKey) {
        panBy(event.deltaX * 0.05, event.deltaY * 0.05);
      } else {
        const ray = raycasterFromEvent(event);
        const hits = ray.intersectObjects(
          store.placedBlocks.map((b) => b.mesh),
          false,
        );
        const zoomTarget = new THREE.Vector3();
        if (hits.length > 0) zoomTarget.copy(hits[0].point);
        else if (!ray.ray.intersectPlane(floorPlane, zoomTarget))
          ray.ray.at(
            camera.position.distanceTo(orbitControls.target),
            zoomTarget,
          );

        const zoomFactor = THREE.MathUtils.clamp(
          -event.deltaY * 0.0015,
          -0.25,
          0.25,
        );
        const dist = camera.position.distanceTo(orbitControls.target);
        if ((zoomFactor > 0 && dist < 1.0) || (zoomFactor < 0 && dist > 300))
          return;
        camera.position.addScaledVector(
          zoomTarget.clone().sub(camera.position),
          zoomFactor,
        );
        orbitControls.target.addScaledVector(
          zoomTarget.clone().sub(orbitControls.target),
          zoomFactor,
        );
      }
      orbitControls.update();
      invalidate();
    },
    { capture: true, passive: false },
  );

  // ── View switching ───────────────────────────────────────────────────────
  function setPlanView(plan: boolean): void {
    store.isPlanView = plan;
    if (plan) {
      cameraOrtho.position.set(
        orbitControls.target.x,
        50,
        orbitControls.target.z,
      );
      camera = cameraOrtho;
    } else {
      camera = cameraPerspective;
    }
    sun.castShadow = !plan; // plan views read better without cast shadows
    orbitControls.object = camera;
    orbitControls.enableRotate = !plan;
    transformControls.camera = camera;
    renderPass.camera = camera;
    rebuildGTAO();
    orbitControls.update();
    invalidate();
  }

  // ── Framing helpers ──────────────────────────────────────────────────────
  function boundsOf(objects: THREE.Object3D[]): THREE.Box3 {
    const box = new THREE.Box3();
    objects.forEach((o) => box.expandByObject(o));
    return box;
  }

  function zoomExtents(objects: THREE.Object3D[]): void {
    if (objects.length === 0) {
      orbitControls.target.set(0, 0, 0);
      if (store.isPlanView) {
        cameraOrtho.position.set(0, 50, 0);
        cameraOrtho.zoom = 1;
        cameraOrtho.updateProjectionMatrix();
      } else cameraPerspective.position.set(18, 14, 18);
      orbitControls.update();
      invalidate();
      return;
    }
    const box = boundsOf(objects);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);

    if (store.isPlanView) {
      orbitControls.target.set(center.x, 0, center.z);
      cameraOrtho.position.set(center.x, 50, center.z);
      const a =
        (cameraOrtho.right - cameraOrtho.left) /
        (cameraOrtho.top - cameraOrtho.bottom);
      cameraOrtho.zoom = VIEW_SIZE / (Math.max(size.z, size.x / a) * 1.2);
      cameraOrtho.updateProjectionMatrix();
    } else {
      orbitControls.target.copy(center);
      const fov = THREE.MathUtils.degToRad(cameraPerspective.fov);
      let dir = cameraPerspective.position.clone().sub(center).normalize();
      if (dir.lengthSq() < 0.01) dir = new THREE.Vector3(1, 1, 1).normalize();
      cameraPerspective.position
        .copy(center)
        .addScaledVector(dir, Math.abs(maxDim / 2 / Math.tan(fov / 2)) * 1.5);
    }
    orbitControls.update();
    invalidate();
  }

  /** Tightens the sun's shadow frustum around the model for crisp shadows. */
  function fitShadows(objects: THREE.Object3D[]): void {
    const box = objects.length
      ? boundsOf(objects)
      : new THREE.Box3(
          new THREE.Vector3(-10, 0, -10),
          new THREE.Vector3(10, 3, 10),
        );
    const sphere = box.getBoundingSphere(new THREE.Sphere());
    const r = Math.max(sphere.radius, 8) * 1.15;
    sun.target.position.copy(sphere.center);
    sun.position.copy(sphere.center).add(
      sunOffset
        .clone()
        .normalize()
        .multiplyScalar(r * 2.5),
    );
    const cam = sun.shadow.camera;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = 0.5;
    cam.far = r * 5;
    cam.updateProjectionMatrix();
    invalidate();
  }

  // ── Resize (container-aware, catches sidebar/panel changes) ──────────────
  function updateSizing(): void {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (w === 0 || h === 0) return;
    const a = w / h;
    cameraPerspective.aspect = a;
    cameraPerspective.updateProjectionMatrix();
    cameraOrtho.left = (-VIEW_SIZE * a) / 2;
    cameraOrtho.right = (VIEW_SIZE * a) / 2;
    cameraOrtho.top = VIEW_SIZE / 2;
    cameraOrtho.bottom = -VIEW_SIZE / 2;
    cameraOrtho.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
    invalidate();
  }
  new ResizeObserver(updateSizing).observe(container);

  // ── On-demand render loop ────────────────────────────────────────────────
  function frame(): void {
    requestAnimationFrame(frame);
    const moving = orbitControls.update(); // true while damping
    if (!moving && !consumeInvalidation()) return;
    renderer.clear();
    composer.render();
    renderer.clearDepth();
    renderer.render(overlay, camera);
  }
  requestAnimationFrame(frame);

  return {
    scene,
    overlay,
    renderer,
    cameraPerspective,
    cameraOrtho,
    get camera() {
      return camera;
    },
    orbitControls,
    transformControls,
    transformGroup,
    setPlanView,
    zoomExtents,
    fitShadows,
    raycasterFromEvent,
    setTrackpadMode: (on) => {
      trackpadMode = on;
    },
    setAmbientOcclusion: (on) => {
      gtaoPass.enabled = on;
      invalidate();
    },
  };
}
