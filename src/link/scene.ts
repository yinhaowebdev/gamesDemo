import { Body, Box, ContactMaterial, Material, Quaternion, SAPBroadphase, Vec3, World } from "cannon-es";
import * as THREE from "three";
import { convexPolyhedron } from "./hull.ts";
import { type Board, type SpawnPose, listTiles } from "./rules.ts";

const LIFT = 0.35;
const WALL = 0.08;
const WALL_H = 16;
const PHI = 0.2;
const DROP = 1.6;
const SETTLE_MS = 2800;
const QUIET_MS = 450;
const LINEAR_DAMP = 0.16;
const ANGULAR_DAMP = 0.08;

const PROP_BOX: { hx: number; hy: number; hz: number; ox: number; oy: number; oz: number }[] = [
  { hx: 0.22, hy: 0.36, hz: 0.22, ox: 0, oy: 0.1, oz: 0 },
  { hx: 0.39, hy: 0.1, hz: 0.29, ox: 0, oy: 0, oz: 0 },
  { hx: 0.42, hy: 0.145, hz: 0.24, ox: 0, oy: -0.075, oz: 0.07 },
  { hx: 0.39, hy: 0.23, hz: 0.22, ox: 0, oy: 0.01, oz: 0 },
  { hx: 0.3, hy: 0.27, hz: 0.3, ox: 0, oy: 0.02, oz: 0 },
  { hx: 0.28, hy: 0.32, hz: 0.28, ox: 0, oy: 0.04, oz: 0 },
  { hx: 0.27, hy: 0.2, hz: 0.2, ox: 0.07, oy: 0, oz: 0 },
  { hx: 0.32, hy: 0.09, hz: 0.3, ox: 0, oy: 0.01, oz: 0.07 },
  { hx: 0.34, hy: 0.08, hz: 0.34, ox: 0, oy: 0, oz: 0 },
  { hx: 0.17, hy: 0.41, hz: 0.17, ox: 0, oy: 0.1, oz: 0 },
  { hx: 0.39, hy: 0.07, hz: 0.39, ox: 0, oy: 0, oz: 0 },
  { hx: 0.17, hy: 0.17, hz: 0.36, ox: 0, oy: 0, oz: 0 },
];

export interface LinkScene {
  setBoard(board: Board, poses: readonly SpawnPose[]): void;
  setHeld(id: number | null): void;
  paintToy(canvas: HTMLCanvasElement, kind: number): void;
  playTake(id: number): Promise<void>;
  settle(): Promise<void>;
  suspend(): void;
  dispose(): void;
}

interface Actor {
  id: number;
  mesh: THREE.Object3D;
  outline: THREE.LineSegments;
  body: Body;
  mode: "fixed" | "live";
  picked: boolean;
  rest: { position: THREE.Vector3; quaternion: THREE.Quaternion };
}

interface TakeJob {
  id: number;
  until: number;
  resolve: () => void;
}

interface SettleJob {
  deadline: number;
  quietSince: number;
  resolve: () => void;
}

export function createLinkScene(
  canvas: HTMLCanvasElement,
  hooks: { onPick: (id: number) => void; onFrame: (dt: number) => void },
): LinkScene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xd7f1ff);
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const ambient = new THREE.AmbientLight(0xffffff, 0.72);
  const sun = new THREE.DirectionalLight(0xffffff, 1.35);
  sun.position.set(5, 11, 4);
  scene.add(ambient, sun);

  const world = new World({ gravity: new Vec3(0, -18, 0) });
  world.broadphase = new SAPBroadphase(world);
  world.allowSleep = true;
  const toyMaterial = new Material("toy");
  const binMaterial = new Material("bin");
  world.addContactMaterial(new ContactMaterial(toyMaterial, toyMaterial, { friction: 0.28, restitution: 0.04 }));
  world.addContactMaterial(new ContactMaterial(toyMaterial, binMaterial, { friction: 0.8, restitution: 0.02 }));

  const edgeMat = new THREE.LineBasicMaterial({ color: 0xffd166 });
  const tableGeo = new THREE.BoxGeometry(1, 0.5, 1);
  const tableMat = new THREE.MeshStandardMaterial({ color: 0x241848, roughness: 0.9 });
  const tableMesh = new THREE.Mesh(tableGeo, tableMat);
  tableMesh.position.y = -0.25;
  scene.add(tableMesh);

  const actors = new Map<number, Actor>();
  const look = new THREE.Vector3(0, 0.45, 0);
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();

  let halfW = 2;
  let halfD = 2;
  let pileTop = 1;
  let radius = 10;
  let theta = 0.75;
  let phi = PHI;
  let tableBody: Body | null = null;
  let walls: Body[] = [];
  let takeJob: TakeJob | null = null;
  let settleJob: SettleJob | null = null;
  let raf = 0;
  let last = 0;
  let looping = false;

  let drag: { id: number; x: number; y: number; lastX: number; lastY: number; moved: boolean } | null = null;

  const solids = new Map<number, THREE.MeshStandardMaterial>();
  const headGeo = new THREE.SphereGeometry(0.22, 16, 12);
  const eyeGeo = new THREE.SphereGeometry(0.045, 8, 6);
  const dollBodyGeo = new THREE.BoxGeometry(0.42, 0.36, 0.3);
  const tileGeo = new THREE.BoxGeometry(0.78, 0.2, 0.58);
  const soleGeo = new THREE.BoxGeometry(0.84, 0.12, 0.34);
  const upperGeo = new THREE.BoxGeometry(0.46, 0.18, 0.3);
  const toeGeo = new THREE.SphereGeometry(0.15, 12, 8);
  const carBodyGeo = new THREE.BoxGeometry(0.78, 0.2, 0.36);
  const cabinGeo = new THREE.BoxGeometry(0.34, 0.16, 0.28);
  const wheelGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.08, 10);
  const baseGeo = new THREE.CylinderGeometry(0.26, 0.3, 0.14, 14);
  const neckGeo = new THREE.CylinderGeometry(0.1, 0.16, 0.2, 12);
  const capGeo = new THREE.SphereGeometry(0.13, 12, 8);
  const discGeo = new THREE.CircleGeometry(0.16, 16);
  const giftGeo = new THREE.BoxGeometry(0.56, 0.56, 0.56);
  const ribbonGeo = new THREE.BoxGeometry(0.12, 0.08, 0.6);
  const mugGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.4, 16);
  const handleGeo = new THREE.BoxGeometry(0.16, 0.18, 0.08);
  const bookGeo = new THREE.BoxGeometry(0.64, 0.16, 0.46);
  const pageGeo = new THREE.BoxGeometry(0.5, 0.02, 0.34);
  const markGeo = new THREE.BoxGeometry(0.1, 0.08, 0.18);
  const drumGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.16, 20);
  const drumHeadGeo = new THREE.CircleGeometry(0.18, 16);
  const cartonGeo = new THREE.BoxGeometry(0.34, 0.62, 0.34);
  const strawGeo = new THREE.CylinderGeometry(0.035, 0.035, 0.22, 8);
  const crossLongGeo = new THREE.BoxGeometry(0.78, 0.14, 0.26);
  const crossShortGeo = new THREE.BoxGeometry(0.26, 0.14, 0.78);
  const pillGeo = new THREE.CylinderGeometry(0.15, 0.15, 0.72, 14);
  const bandGeo = new THREE.CylinderGeometry(0.17, 0.17, 0.16, 14);

  function solid(color: number): THREE.MeshStandardMaterial {
    const cached = solids.get(color);
    if (cached) return cached;
    const material = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.04 });
    solids.set(color, material);
    return material;
  }

  function inkMaterial(key: number, mark: string, ink: string): THREE.MeshStandardMaterial {
    const cached = solids.get(key);
    if (cached) return cached;
    const face = document.createElement("canvas");
    face.width = 256;
    face.height = 256;
    const ctx = face.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#f6efe2";
      ctx.fillRect(0, 0, 256, 256);
      ctx.strokeStyle = ink;
      ctx.lineWidth = 18;
      ctx.strokeRect(28, 28, 200, 200);
      ctx.fillStyle = ink;
      ctx.font = "700 132px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(mark, 128, 136);
    }
    const texture = new THREE.CanvasTexture(face);
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.MeshStandardMaterial({ map: texture, roughness: 0.6, metalness: 0.02 });
    solids.set(key, material);
    return material;
  }

  function createProp(kind: number): THREE.Group {
    const group = new THREE.Group();
    const which = ((kind % 12) + 12) % 12;
    if (which === 0) {
      const body = new THREE.Mesh(dollBodyGeo, solid(0xff5d8f));
      body.position.y = -0.08;
      const head = new THREE.Mesh(headGeo, solid(0xffc2d4));
      head.position.y = 0.24;
      group.add(body, head);
      for (const x of [-0.07, 0.07]) {
        const eye = new THREE.Mesh(eyeGeo, solid(0x2a3358));
        eye.position.set(x, 0.4, 0.05);
        group.add(eye);
      }
    } else if (which === 1) {
      group.add(new THREE.Mesh(tileGeo, inkMaterial(1001, "中", "#e23b3b")));
    } else if (which === 2) {
      const sole = new THREE.Mesh(soleGeo, solid(0xff8a3d));
      sole.position.y = -0.16;
      const upper = new THREE.Mesh(upperGeo, solid(0xfff6e8));
      upper.position.set(0, -0.02, -0.04);
      const toe = new THREE.Mesh(toeGeo, solid(0xff8a3d));
      toe.position.set(0, -0.08, 0.16);
      toe.scale.y = 0.65;
      group.add(sole, upper, toe);
    } else if (which === 3) {
      const body = new THREE.Mesh(carBodyGeo, solid(0xffd23f));
      const cabin = new THREE.Mesh(cabinGeo, solid(0xfff6e8));
      cabin.position.set(0, 0.16, -0.02);
      group.add(body, cabin);
      for (const x of [-0.26, 0.26]) {
        for (const z of [-0.12, 0.12]) {
          const wheel = new THREE.Mesh(wheelGeo, solid(0x2a3358));
          wheel.rotation.z = Math.PI / 2;
          wheel.position.set(x, -0.12, z);
          group.add(wheel);
        }
      }
    } else if (which === 4) {
      const base = new THREE.Mesh(baseGeo, solid(0x7a4e9a));
      base.position.y = -0.18;
      const neck = new THREE.Mesh(neckGeo, solid(0xfff6e8));
      const cap = new THREE.Mesh(capGeo, solid(0x7a4e9a));
      cap.position.y = 0.16;
      const disc = new THREE.Mesh(discGeo, inkMaterial(1004, "車", "#3b2460"));
      disc.rotation.x = -Math.PI / 2;
      disc.position.y = 0.28;
      group.add(base, neck, cap, disc);
    } else if (which === 5) {
      const box = new THREE.Mesh(giftGeo, solid(0x3dbe6e));
      const ribbonZ = new THREE.Mesh(ribbonGeo, solid(0xffd23f));
      ribbonZ.position.y = 0.32;
      const ribbonX = new THREE.Mesh(ribbonGeo, solid(0xffd23f));
      ribbonX.position.y = 0.32;
      ribbonX.rotation.y = Math.PI / 2;
      group.add(box, ribbonZ, ribbonX);
    } else if (which === 6) {
      const cup = new THREE.Mesh(mugGeo, solid(0x3aa0ff));
      const handle = new THREE.Mesh(handleGeo, solid(0x1d6fbf));
      handle.position.x = 0.26;
      group.add(cup, handle);
    } else if (which === 7) {
      const cover = new THREE.Mesh(bookGeo, solid(0x2a3358));
      const page = new THREE.Mesh(pageGeo, solid(0xfff6e8));
      page.position.y = 0.09;
      const bookmark = new THREE.Mesh(markGeo, solid(0xe23b3b));
      bookmark.position.set(0, 0.06, 0.28);
      group.add(cover, page, bookmark);
    } else if (which === 8) {
      const drum = new THREE.Mesh(drumGeo, solid(0xe23b4a));
      const head = new THREE.Mesh(drumHeadGeo, solid(0xfff6e8));
      head.rotation.x = -Math.PI / 2;
      head.position.y = 0.081;
      group.add(drum, head);
    } else if (which === 9) {
      const carton = new THREE.Mesh(cartonGeo, solid(0x2ec4b6));
      const straw = new THREE.Mesh(strawGeo, solid(0xfff6e8));
      straw.position.y = 0.4;
      group.add(carton, straw);
    } else if (which === 10) {
      group.add(new THREE.Mesh(crossLongGeo, solid(0x5b4bdb)), new THREE.Mesh(crossShortGeo, solid(0x5b4bdb)));
    } else {
      const pill = new THREE.Mesh(pillGeo, solid(0xfff6e8));
      pill.rotation.x = Math.PI / 2;
      const band = new THREE.Mesh(bandGeo, solid(0xe23b4a));
      band.rotation.x = Math.PI / 2;
      group.add(pill, band);
    }
    return group;
  }

  const propEdges: THREE.BufferGeometry[] = [];
  const propBoxes = PROP_BOX.map((spec) => new Box(new Vec3(spec.hx, spec.hy, spec.hz)));
  for (let which = 0; which < 12; which++) {
    const sample = createProp(which);
    const data = convexPolyhedron(samplePoints(sample));
    const positions: number[] = [];
    const seen = new Set<string>();
    for (const face of data.faces) {
      for (let i = 0; i < face.length; i++) {
        const a = face[i];
        const b = face[(i + 1) % face.length];
        if (a === undefined || b === undefined) continue;
        const key = a < b ? `${a}:${b}` : `${b}:${a}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const va = data.vertices[a];
        const vb = data.vertices[b];
        if (!va || !vb) continue;
        positions.push(va.x, va.y, va.z, vb.x, vb.y, vb.z);
      }
    }
    const edges = new THREE.BufferGeometry();
    edges.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    propEdges.push(edges);
  }

  function placeCamera(): void {
    camera.position.set(
      look.x + radius * Math.sin(phi) * Math.sin(theta),
      look.y + radius * Math.cos(phi),
      look.z + radius * Math.sin(phi) * Math.cos(theta),
    );
    camera.lookAt(look);
  }

  function fitRadius(): void {
    const aspect = Math.max(camera.aspect, 0.01);
    camera.fov = aspect < 0.9 ? 46 : 40;
    camera.updateProjectionMatrix();
    const vfov = (camera.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    const span = Math.hypot(halfW * 2, halfD * 2);
    const framed = Math.max(span / Math.tan(hfov / 2), span / Math.tan(vfov / 2)) * 0.62;
    look.set(0, pileTop * 0.32, 0);
    radius = Math.max(framed, (pileTop - look.y + 0.7) / Math.cos(PHI));
  }

  function resize(): void {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    fitRadius();
  }

  const iconCanvas = document.createElement("canvas");
  const iconRenderer = new THREE.WebGLRenderer({ canvas: iconCanvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  iconRenderer.setPixelRatio(1);
  iconRenderer.setSize(128, 128, false);
  iconRenderer.outputColorSpace = THREE.SRGBColorSpace;
  iconRenderer.setClearColor(0x000000, 0);
  const iconScene = new THREE.Scene();
  const iconCamera = new THREE.PerspectiveCamera(30, 1, 0.05, 20);
  const iconAmbient = new THREE.AmbientLight(0xffffff, 0.82);
  const iconSun = new THREE.DirectionalLight(0xffffff, 1.25);
  iconSun.position.set(2.4, 4.2, 3);
  iconScene.add(iconAmbient, iconSun);
  const iconCenter = new THREE.Vector3();
  const iconSize = new THREE.Vector3();
  const iconDir = new THREE.Vector3(0.62, 0.78, 1).normalize();

  function paintToy(target: HTMLCanvasElement, kind: number): void {
    const prop = createProp(kind);
    iconScene.add(prop);
    const bounds = new THREE.Box3().setFromObject(prop);
    bounds.getCenter(iconCenter);
    bounds.getSize(iconSize);
    const distance = Math.max(iconSize.x, iconSize.y, iconSize.z, 0.2) * 2.05;
    iconCamera.position.copy(iconCenter).addScaledVector(iconDir, distance);
    iconCamera.lookAt(iconCenter);
    iconRenderer.render(iconScene, iconCamera);
    const ctx = target.getContext("2d");
    if (ctx) {
      ctx.clearRect(0, 0, target.width, target.height);
      ctx.drawImage(iconCanvas, 0, 0, target.width, target.height);
    }
    prop.removeFromParent();
  }

  function setHeld(id: number | null): void {
    for (const actor of actors.values()) {
      actor.picked = actor.id === id;
      actor.outline.visible = actor.picked;
    }
  }

  function clearWalls(): void {
    for (const wall of walls) world.removeBody(wall);
    walls = [];
  }

  function addWall(x: number, y: number, z: number, hx: number, hy: number, hz: number): void {
    const body = new Body({
      mass: 0,
      type: Body.STATIC,
      material: binMaterial,
      shape: new Box(new Vec3(hx, hy, hz)),
      position: new Vec3(x, y, z),
    });
    world.addBody(body);
    walls.push(body);
  }

  function rebuildTable(): void {
    tableMesh.scale.set(halfW * 2, 1, halfD * 2);
    if (tableBody) world.removeBody(tableBody);
    tableBody = new Body({
      mass: 0,
      type: Body.STATIC,
      material: binMaterial,
      shape: new Box(new Vec3(halfW, 0.25, halfD)),
      position: new Vec3(0, -0.25, 0),
    });
    world.addBody(tableBody);
    clearWalls();
    const hy = WALL_H / 2;
    addWall(halfW + WALL, hy, 0, WALL, hy, halfD + WALL);
    addWall(-(halfW + WALL), hy, 0, WALL, hy, halfD + WALL);
    addWall(0, hy, halfD + WALL, halfW + WALL, hy, WALL);
    addWall(0, hy, -(halfD + WALL), halfW + WALL, hy, WALL);
  }

  function clearActors(): void {
    for (const id of [...actors.keys()]) destroyActor(id);
  }

  function destroyActor(id: number): void {
    const actor = actors.get(id);
    if (!actor) return;
    actors.delete(id);
    if (world.bodies.includes(actor.body)) world.removeBody(actor.body);
    actor.mesh.removeFromParent();
  }

  function remember(actor: Actor): void {
    const p = actor.body.position;
    const q = actor.body.quaternion;
    actor.rest.position.set(p.x, p.y, p.z);
    actor.rest.quaternion.set(q.x, q.y, q.z, q.w);
  }

  function pin(actor: Actor): void {
    remember(actor);
    actor.mode = "fixed";
    actor.body.type = Body.STATIC;
    actor.body.mass = 0;
    actor.body.updateMassProperties();
    actor.body.velocity.set(0, 0, 0);
    actor.body.angularVelocity.set(0, 0, 0);
    actor.body.position.set(actor.rest.position.x, actor.rest.position.y, actor.rest.position.z);
    actor.body.quaternion.set(
      actor.rest.quaternion.x,
      actor.rest.quaternion.y,
      actor.rest.quaternion.z,
      actor.rest.quaternion.w,
    );
  }

  function release(actor: Actor): void {
    actor.mode = "live";
    actor.picked = false;
    actor.outline.visible = false;
    actor.body.type = Body.DYNAMIC;
    actor.body.mass = 1;
    actor.body.updateMassProperties();
    actor.body.linearDamping = LINEAR_DAMP;
    actor.body.angularDamping = ANGULAR_DAMP;
    actor.body.allowSleep = true;
    actor.body.wakeUp();
    if (!world.bodies.includes(actor.body)) world.addBody(actor.body);
  }

  function calm(): boolean {
    if (actors.size === 0) return true;
    for (const actor of actors.values()) {
      if (actor.mode !== "live") return false;
      if (actor.body.velocity.length() > 0.55) return false;
      if (actor.body.angularVelocity.length() > 0.8) return false;
    }
    return true;
  }

  function finishTake(): void {
    if (!takeJob) return;
    destroyActor(takeJob.id);
    const resolve = takeJob.resolve;
    takeJob = null;
    resolve();
  }

  function finishSettle(): void {
    if (!settleJob) return;
    for (const actor of actors.values()) {
      if (actor.mode === "live") pin(actor);
    }
    const resolve = settleJob.resolve;
    settleJob = null;
    resolve();
  }

  function syncFixed(): void {
    for (const actor of actors.values()) {
      if (actor.mode !== "fixed") continue;
      const y = actor.rest.position.y + (actor.picked ? LIFT : 0);
      actor.body.position.set(actor.rest.position.x, y, actor.rest.position.z);
      actor.body.velocity.set(0, 0, 0);
      actor.body.angularVelocity.set(0, 0, 0);
      actor.body.quaternion.set(
        actor.rest.quaternion.x,
        actor.rest.quaternion.y,
        actor.rest.quaternion.z,
        actor.rest.quaternion.w,
      );
      actor.mesh.position.set(actor.rest.position.x, y, actor.rest.position.z);
      actor.mesh.quaternion.copy(actor.rest.quaternion);
      actor.outline.visible = actor.picked;
    }
  }

  function syncLive(): void {
    for (const actor of actors.values()) {
      if (actor.mode !== "live") continue;
      const p = actor.body.position;
      const q = actor.body.quaternion;
      actor.mesh.position.set(p.x, p.y, p.z);
      actor.mesh.quaternion.set(q.x, q.y, q.z, q.w);
    }
  }

  function frame(now: number): void {
    if (!looping) return;
    raf = requestAnimationFrame(frame);
    const dt = last === 0 ? 1 / 60 : Math.min(0.05, (now - last) / 1000);
    last = now;
    hooks.onFrame(dt);
    if (takeJob && now >= takeJob.until) finishTake();
    syncFixed();
    if ([...actors.values()].some((actor) => actor.mode === "live")) {
      world.step(1 / 60, dt, 3);
      syncLive();
    }
    if (settleJob) {
      if (!calm()) settleJob.quietSince = 0;
      else if (settleJob.quietSince === 0) settleJob.quietSince = now;
      const held = settleJob.quietSince !== 0 && now - settleJob.quietSince >= QUIET_MS;
      if (held || now >= settleJob.deadline) finishSettle();
    }
    placeCamera();
    renderer.render(scene, camera);
  }

  function ensureLoop(): void {
    resize();
    if (looping) return;
    looping = true;
    last = 0;
    raf = requestAnimationFrame(frame);
  }

  function suspend(): void {
    looping = false;
    cancelAnimationFrame(raf);
    raf = 0;
    last = 0;
    finishTake();
    finishSettle();
    clearActors();
  }

  function pick(event: PointerEvent): void {
    if (settleJob) return;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    pointerNdc.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    placeCamera();
    camera.updateMatrixWorld();
    const meshes = [...actors.values()].filter((actor) => actor.mode === "fixed").map((actor) => actor.mesh);
    for (const mesh of meshes) mesh.updateMatrixWorld(true);
    raycaster.setFromCamera(pointerNdc, camera);
    const hit = raycaster.intersectObjects(meshes, true).find((item) => item.object instanceof THREE.Mesh);
    const id = hit?.object.userData.id;
    if (typeof id === "number") hooks.onPick(id);
  }

  function onPointerDown(event: PointerEvent): void {
    event.preventDefault();
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // Untrusted events and some WebViews cannot capture the pointer.
    }
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, lastX: event.clientX, lastY: event.clientY, moved: false };
  }

  function onPointerMove(event: PointerEvent): void {
    const current = drag;
    if (!current || current.id !== event.pointerId) return;
    const dx = event.clientX - current.x;
    const dy = event.clientY - current.y;
    if (!current.moved && Math.hypot(dx, dy) < 10) return;
    if (!current.moved) {
      current.moved = true;
      current.lastX = event.clientX;
      current.lastY = event.clientY;
      return;
    }
    theta -= (event.clientX - current.lastX) * 0.005;
    current.lastX = event.clientX;
    current.lastY = event.clientY;
  }

  function onPointerUp(event: PointerEvent): void {
    const current = drag;
    if (!current || current.id !== event.pointerId) return;
    drag = null;
    if (!current.moved) pick(event);
  }

  canvas.style.touchAction = "none";
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("contextmenu", preventMenu);
  const observer = new ResizeObserver(() => resize());
  observer.observe(canvas);
  resize();
  placeCamera();

  return {
    setBoard(board: Board, poses: readonly SpawnPose[]): void {
      finishTake();
      finishSettle();
      clearActors();
      halfW = 1.2;
      halfD = 1.2;
      pileTop = 1;
      for (const pose of poses) {
        halfW = Math.max(halfW, Math.abs(pose.x) + 0.7);
        halfD = Math.max(halfD, Math.abs(pose.z) + 0.7);
        pileTop = Math.max(pileTop, pose.y + 0.4);
      }
      theta = 0.72;
      phi = PHI;
      fitRadius();
      rebuildTable();
      const byId = new Map(poses.map((pose) => [pose.id, pose]));
      for (const entry of listTiles(board)) {
        const pose = byId.get(entry.tile.id);
        if (!pose) continue;
        const rotation = new Quaternion();
        rotation.setFromEuler(pose.pitch, pose.yaw, pose.roll, "YXZ");
        const which = ((entry.tile.kind % 12) + 12) % 12;
        const mesh = createProp(entry.tile.kind);
        mesh.position.set(pose.x, pose.y + DROP, pose.z);
        mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
        const edges = propEdges[which];
        const box = propBoxes[which];
        const spec = PROP_BOX[which];
        if (!edges || !box || !spec) continue;
        const outline = new THREE.LineSegments(edges, edgeMat);
        outline.visible = false;
        outline.scale.setScalar(1.04);
        outline.raycast = () => {};
        mesh.add(outline);
        mesh.traverse((child) => {
          child.userData.id = entry.tile.id;
        });
        const body = new Body({
          mass: 1,
          type: Body.DYNAMIC,
          material: toyMaterial,
          allowSleep: true,
          linearDamping: LINEAR_DAMP,
          angularDamping: ANGULAR_DAMP,
          position: new Vec3(pose.x, pose.y + DROP, pose.z),
          quaternion: rotation,
        });
        body.addShape(box, new Vec3(spec.ox, spec.oy, spec.oz));
        scene.add(mesh);
        world.addBody(body);
        actors.set(entry.tile.id, {
          id: entry.tile.id,
          mesh,
          outline,
          body,
          mode: "live",
          picked: false,
          rest: {
            position: new THREE.Vector3(pose.x, pose.y + DROP, pose.z),
            quaternion: new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w),
          },
        });
      }
      ensureLoop();
    },
    setHeld,
    paintToy,
    playTake(id: number): Promise<void> {
      finishTake();
      const actor = actors.get(id);
      if (!actor) return Promise.resolve();
      if (actor.mode === "live") pin(actor);
      actor.picked = true;
      actor.outline.visible = true;
      return new Promise((resolve) => {
        takeJob = { id, until: performance.now() + 180, resolve };
        ensureLoop();
      });
    },
    settle(): Promise<void> {
      finishSettle();
      for (const actor of actors.values()) release(actor);
      return new Promise((resolve) => {
        settleJob = { deadline: performance.now() + SETTLE_MS, quietSince: 0, resolve };
        ensureLoop();
      });
    },
    suspend,
    dispose(): void {
      suspend();
      looping = false;
      observer.disconnect();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("contextmenu", preventMenu);
      finishTake();
      finishSettle();
      clearActors();
      clearWalls();
      if (tableBody) world.removeBody(tableBody);
      tableBody = null;
      renderer.dispose();
      iconRenderer.dispose();
      for (const edges of propEdges) edges.dispose();
      headGeo.dispose();
      eyeGeo.dispose();
      dollBodyGeo.dispose();
      tileGeo.dispose();
      soleGeo.dispose();
      upperGeo.dispose();
      toeGeo.dispose();
      carBodyGeo.dispose();
      cabinGeo.dispose();
      wheelGeo.dispose();
      baseGeo.dispose();
      neckGeo.dispose();
      capGeo.dispose();
      discGeo.dispose();
      giftGeo.dispose();
      ribbonGeo.dispose();
      mugGeo.dispose();
      handleGeo.dispose();
      bookGeo.dispose();
      pageGeo.dispose();
      markGeo.dispose();
      drumGeo.dispose();
      drumHeadGeo.dispose();
      cartonGeo.dispose();
      strawGeo.dispose();
      crossLongGeo.dispose();
      crossShortGeo.dispose();
      pillGeo.dispose();
      bandGeo.dispose();
      for (const material of solids.values()) {
        material.map?.dispose();
        material.dispose();
      }
      tableGeo.dispose();
      edgeMat.dispose();
      tableMat.dispose();
    },
  };
}

function preventMenu(event: Event): void {
  event.preventDefault();
}

const sampleVec = new THREE.Vector3();

export function samplePoints(group: THREE.Object3D): { x: number; y: number; z: number }[] {
  group.updateMatrixWorld(true);
  const points: { x: number; y: number; z: number }[] = [];
  const push = (): void => {
    points.push({ x: sampleVec.x, y: sampleVec.y, z: sampleVec.z });
  };
  group.traverse((node) => {
    if (!(node instanceof THREE.Mesh)) return;
    const geo = node.geometry;
    if (geo instanceof THREE.BoxGeometry) {
      const { width, height, depth } = geo.parameters;
      for (const x of [-width / 2, width / 2]) {
        for (const y of [-height / 2, height / 2]) {
          for (const z of [-depth / 2, depth / 2]) {
            sampleVec.set(x, y, z).applyMatrix4(node.matrixWorld);
            push();
          }
        }
      }
    } else if (geo instanceof THREE.SphereGeometry) {
      const radius = geo.parameters.radius;
      sampleVec.set(0, radius, 0).applyMatrix4(node.matrixWorld);
      push();
      sampleVec.set(0, -radius, 0).applyMatrix4(node.matrixWorld);
      push();
      for (let ring = 1; ring <= 3; ring++) {
        const phi = (Math.PI * ring) / 4;
        for (let step = 0; step < 8; step++) {
          const theta = (Math.PI * step) / 4;
          sampleVec
            .set(radius * Math.sin(phi) * Math.cos(theta), radius * Math.cos(phi), radius * Math.sin(phi) * Math.sin(theta))
            .applyMatrix4(node.matrixWorld);
          push();
        }
      }
    } else if (geo instanceof THREE.CylinderGeometry) {
      const { radiusTop, radiusBottom, height } = geo.parameters;
      for (const [y, radius] of [
        [height / 2, radiusTop],
        [-height / 2, radiusBottom],
      ] as const) {
        for (let step = 0; step < 8; step++) {
          const theta = (Math.PI * step) / 4;
          sampleVec.set(radius * Math.sin(theta), y, radius * Math.cos(theta)).applyMatrix4(node.matrixWorld);
          push();
        }
      }
    } else if (geo instanceof THREE.CircleGeometry) {
      const radius = geo.parameters.radius ?? 1;
      for (let step = 0; step < 8; step++) {
        const theta = (Math.PI * step) / 4;
        sampleVec.set(radius * Math.cos(theta), radius * Math.sin(theta), 0).applyMatrix4(node.matrixWorld);
        push();
      }
    }
  });
  return points;
}
