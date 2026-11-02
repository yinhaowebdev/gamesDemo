import { Body, Box, ContactMaterial, Material, Quaternion, SAPBroadphase, Vec3, World } from "cannon-es";
import * as THREE from "three";
import { paintFace } from "./face.ts";
import { CUBE, GAP, type Board, type SpawnPose, listTiles, tableHalf } from "./rules.ts";

const LIFT = 0.35;
const WALL = 0.08;
const WALL_H = 8;
const SETTLE_MS = 2200;
const QUIET_MS = 450;

export interface LinkScene {
  setBoard(board: Board, poses: readonly SpawnPose[]): void;
  playTake(id: number): Promise<void>;
  settle(): Promise<void>;
  suspend(): void;
  dispose(): void;
}

interface Actor {
  id: number;
  mesh: THREE.Mesh;
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

  const boxGeo = new THREE.BoxGeometry(CUBE, CUBE, CUBE);
  const edgesGeo = new THREE.EdgesGeometry(boxGeo);
  const tileShape = new Box(new Vec3(CUBE / 2, CUBE / 2, CUBE / 2));
  const edgeMat = new THREE.LineBasicMaterial({ color: 0xffd166 });
  const tableGeo = new THREE.BoxGeometry(1, 0.5, 1);
  const tableMat = new THREE.MeshStandardMaterial({ color: 0x241848, roughness: 0.9 });
  const tableMesh = new THREE.Mesh(tableGeo, tableMat);
  tableMesh.position.y = -0.25;
  scene.add(tableMesh);

  const tops = new Map<number, THREE.MeshStandardMaterial>();
  const actors = new Map<number, Actor>();
  const look = new THREE.Vector3(0, 0.45, 0);
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();

  let width = 1;
  let depth = 1;
  let radius = 10;
  let theta = 0.75;
  let phi = 0.92;
  let tableBody: Body | null = null;
  let walls: Body[] = [];
  let takeJob: TakeJob | null = null;
  let settleJob: SettleJob | null = null;
  let raf = 0;
  let last = 0;
  let looping = false;

  let drag: { id: number; x: number; y: number; lastX: number; lastY: number; moved: boolean } | null = null;

  function topMaterial(kind: number): THREE.MeshStandardMaterial {
    const cached = tops.get(kind);
    if (cached) return cached;
    const canvasFace = document.createElement("canvas");
    canvasFace.width = 256;
    canvasFace.height = 256;
    paintFace(canvasFace, kind);
    const texture = new THREE.CanvasTexture(canvasFace);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.needsUpdate = true;
    const material = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 0.58,
      metalness: 0.04,
    });
    tops.set(kind, material);
    return material;
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
    const span = Math.hypot((width + 1.2) * GAP, (depth + 1.2) * GAP) * 0.62 + 1.6;
    radius = Math.max(span / Math.tan(hfov / 2), (span * 0.9) / Math.tan(vfov / 2)) * 1.2;
    look.set(0, 0.75, 0);
  }

  function resize(): void {
    const parent = canvas.parentElement;
    const w = parent?.clientWidth || canvas.clientWidth || 1;
    const h = parent?.clientHeight || canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(1, h);
    fitRadius();
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
    const { halfW, halfD } = tableHalf(width, depth);
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
    world.removeBody(actor.body);
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
    actor.body.type = Body.KINEMATIC;
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
    actor.body.allowSleep = true;
    actor.body.wakeUp();
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

  function calm(): boolean {
    if (actors.size === 0) return true;
    for (const actor of actors.values()) {
      if (actor.mode !== "live") return false;
      if (actor.body.velocity.length() > 0.55) return false;
      if (actor.body.angularVelocity.length() > 0.8) return false;
    }
    return true;
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
    world.step(1 / 60, dt, 3);
    syncLive();
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
    raycaster.setFromCamera(pointerNdc, camera);
    const meshes = [...actors.values()].filter((actor) => actor.mode === "fixed").map((actor) => actor.mesh);
    const hit = raycaster.intersectObjects(meshes, false)[0];
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
    phi = Math.min(0.42, Math.max(0.08, phi + (event.clientY - current.lastY) * 0.005));
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
  observer.observe(canvas.parentElement ?? canvas);
  resize();
  placeCamera();

  return {
    setBoard(board: Board, poses: readonly SpawnPose[]): void {
      finishTake();
      finishSettle();
      clearActors();
      width = board.width;
      depth = board.depth;
      theta = 0.72;
      phi = 0.2;
      fitRadius();
      rebuildTable();
      const byId = new Map(poses.map((pose) => [pose.id, pose]));
      for (const entry of listTiles(board)) {
        const pose = byId.get(entry.tile.id);
        if (!pose) continue;
        const rotation = new Quaternion();
        rotation.setFromEuler(pose.pitch, pose.yaw, pose.roll, "YXZ");
        const mesh = new THREE.Mesh(boxGeo, topMaterial(entry.tile.kind));
        mesh.position.set(pose.x, pose.y, pose.z);
        mesh.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
        mesh.userData.id = entry.tile.id;
        const outline = new THREE.LineSegments(edgesGeo, edgeMat);
        outline.visible = false;
        outline.scale.setScalar(1.04);
        mesh.add(outline);
        const body = new Body({
          mass: 1,
          type: Body.DYNAMIC,
          material: toyMaterial,
          allowSleep: true,
          shape: tileShape,
          position: new Vec3(pose.x, pose.y, pose.z),
          quaternion: rotation,
          linearDamping: 0.16,
          angularDamping: 0.08,
        });
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
            position: new THREE.Vector3(pose.x, pose.y, pose.z),
            quaternion: new THREE.Quaternion(rotation.x, rotation.y, rotation.z, rotation.w),
          },
        });
      }
      ensureLoop();
    },
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
      boxGeo.dispose();
      edgesGeo.dispose();
      tableGeo.dispose();
      edgeMat.dispose();
      tableMat.dispose();
      for (const material of tops.values()) {
        material.map?.dispose();
        material.dispose();
      }
      tops.clear();
    },
  };
}

function preventMenu(event: Event): void {
  event.preventDefault();
}
