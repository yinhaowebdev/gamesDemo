import { paintCharacter } from "../art/characters.ts";
import { type Segment, placeOf } from "./rules.ts";

export const COLORS = ["#ff5d8f", "#ffd166", "#7bdff2", "#c8f7a0", "#c9a6ff"];

export type ZumaMap = "spiral" | "snake" | "loop";

export interface Shot {
  x: number;
  y: number;
  color: number;
}

export interface Nudge {
  segmentIndex: number;
  fromIndex: number;
  amount: number;
}

export interface DrawState {
  pathUnits: number;
  segments: readonly Segment[];
  held: number;
  next: number;
  shot: Shot | null;
  nudge: Nudge | null;
}

interface Sample {
  x: number;
  y: number;
  s: number;
}

export interface ZumaView {
  aim(): number;
  shooter(): { x: number; y: number };
  ballRadius(): number;
  point(distance: number): { x: number; y: number };
  outside(x: number, y: number): boolean;
  draw(state: DrawState): void;
  listen(onFire: () => void): void;
  setMap(next: ZumaMap): void;
  suspend(): void;
}

export function createZumaView(canvas: HTMLCanvasElement): ZumaView {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("无法绘制祖玛");
  const context = ctx;
  let samples: Sample[] = [];
  let pathUnits = 1;
  let map: ZumaMap = "spiral";
  const sprites = new Map<number, HTMLCanvasElement>();
  let angle = -Math.PI / 2;
  let wired = false;
  let onFire: () => void = () => {};
  let width = 1;
  let height = 1;

  function shooter(): { x: number; y: number } {
    return { x: width / 2, y: height * 0.46 };
  }

  function rebuild(units: number): void {
    const parent = canvas.parentElement;
    const cssW = parent?.clientWidth || canvas.clientWidth || 1;
    const cssH = parent?.clientHeight || canvas.clientHeight || 1;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(cssW * dpr));
    canvas.height = Math.max(1, Math.floor(cssH * dpr));
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    width = cssW;
    height = cssH;
    pathUnits = Math.max(1, units);
    samples = measure(traceMap(map, shooter(), width, height));
  }

  function ballRadius(): number {
    const last = samples[samples.length - 1];
    if (!last || pathUnits <= 0) return 14;
    return (last.s / pathUnits) * 0.46;
  }

  function point(distance: number): { x: number; y: number } {
    const last = samples[samples.length - 1];
    const first = samples[0];
    if (!last || !first) return shooter();
    const px = (distance / pathUnits) * last.s;
    if (px <= 0) return { x: first.x, y: first.y };
    if (px >= last.s) return { x: last.x, y: last.y };
    let low = 0;
    let high = samples.length - 1;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      const sample = samples[mid];
      if (!sample || sample.s < px) low = mid + 1;
      else high = mid;
    }
    const b = samples[low];
    const a = samples[low - 1] ?? b;
    if (!a || !b) return shooter();
    const span = b.s - a.s;
    const t = span <= 0.0001 ? 0 : (px - a.s) / span;
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }

  function sprite(color: number): HTMLCanvasElement {
    const found = sprites.get(color);
    if (found) return found;
    const tile = document.createElement("canvas");
    tile.width = 128;
    tile.height = 128;
    const tileCtx = tile.getContext("2d");
    if (tileCtx) paintCharacter(tileCtx, color, COLORS[color] ?? "#fff", 128);
    sprites.set(color, tile);
    return tile;
  }

  function drawBall(x: number, y: number, radius: number, color: number): void {
    context.save();
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.clip();
    context.drawImage(sprite(color), x - radius, y - radius, radius * 2, radius * 2);
    context.restore();
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.lineWidth = Math.max(2, radius * 0.14);
    context.strokeStyle = "#fff";
    context.stroke();
  }

  function draw(state: DrawState): void {
    if (samples.length === 0 || state.pathUnits !== pathUnits) rebuild(state.pathUnits);
    context.clearRect(0, 0, width, height);
    context.beginPath();
    samples.forEach((sample, index) => {
      if (index === 0) context.moveTo(sample.x, sample.y);
      else context.lineTo(sample.x, sample.y);
    });
    context.strokeStyle = "rgba(126, 176, 214, 0.55)";
    context.lineWidth = Math.max(10, ballRadius() * 1.85);
    context.lineCap = "round";
    context.stroke();
    const end = point(state.pathUnits);
    context.beginPath();
    context.arc(end.x, end.y, ballRadius() * 0.85, 0, Math.PI * 2);
    context.strokeStyle = "#ff8fb3";
    context.lineWidth = 3;
    context.stroke();
    const radius = ballRadius();
    state.segments.forEach((segment, segmentIndex) => {
      segment.balls.forEach((ball, index) => {
        let distance = placeOf(segment, index);
        const nudge = state.nudge;
        if (nudge && nudge.segmentIndex === segmentIndex && index >= nudge.fromIndex) {
          distance += nudge.amount;
        }
        const at = point(distance);
        drawBall(at.x, at.y, radius, ball.color);
      });
    });
    if (state.shot) drawBall(state.shot.x, state.shot.y, radius, state.shot.color);
    const origin = shooter();
    const nose = 36;
    context.beginPath();
    context.moveTo(origin.x, origin.y);
    context.lineTo(origin.x + Math.cos(angle) * nose, origin.y + Math.sin(angle) * nose);
    context.strokeStyle = "rgba(42, 64, 102, 0.55)";
    context.lineWidth = 3;
    context.stroke();
    drawBall(origin.x, origin.y, radius * 0.82, state.held);
    drawBall(origin.x - radius * 1.7, origin.y + radius * 1.5, radius * 0.48, state.next);
  }

  function listen(fire: () => void): void {
    onFire = fire;
    if (wired) return;
    wired = true;
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", onPointerDown);
    canvas.addEventListener("pointermove", onPointerMove);
    canvas.addEventListener("pointerup", onPointerUp);
    canvas.addEventListener("pointercancel", onPointerUp);
    canvas.addEventListener("contextmenu", preventMenu);
    const observer = new ResizeObserver(() => rebuild(pathUnits));
    observer.observe(canvas.parentElement ?? canvas);
    resizeObserver = observer;
  }

  let resizeObserver: ResizeObserver | null = null;

  function aimFrom(event: PointerEvent): void {
    const rect = canvas.getBoundingClientRect();
    const origin = shooter();
    const x = event.clientX - rect.left - origin.x;
    const y = event.clientY - rect.top - origin.y;
    if (Math.hypot(x, y) < 8) return;
    angle = Math.atan2(y, x);
  }

  function onPointerDown(event: PointerEvent): void {
    aimFrom(event);
  }

  function onPointerMove(event: PointerEvent): void {
    if (event.buttons === 0 && event.pointerType === "mouse") aimFrom(event);
    else if (event.buttons !== 0) aimFrom(event);
  }

  function onPointerUp(event: PointerEvent): void {
    aimFrom(event);
    onFire();
  }

  return {
    aim: () => angle,
    shooter,
    ballRadius,
    point,
    outside(x: number, y: number): boolean {
      return x < -40 || y < -40 || x > width + 40 || y > height + 40;
    },
    draw,
    listen,
    setMap(next) {
      map = next;
      samples = [];
    },
    suspend() {
      wired = false;
      onFire = () => {};
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("contextmenu", preventMenu);
      resizeObserver?.disconnect();
      resizeObserver = null;
    },
  };
}

function preventMenu(event: Event): void {
  event.preventDefault();
}

function measure(points: { x: number; y: number }[]): Sample[] {
  const samples: Sample[] = [];
  let length = 0;
  for (const point of points) {
    const prev = samples[samples.length - 1];
    if (prev) length += Math.hypot(point.x - prev.x, point.y - prev.y);
    samples.push({ x: point.x, y: point.y, s: length });
  }
  return samples;
}

function traceMap(map: ZumaMap, origin: { x: number; y: number }, width: number, height: number): { x: number; y: number }[] {
  if (map === "snake") return snake(width, height);
  if (map === "loop") return loop(origin, width, height);
  return spiral(origin, width, height);
}

function spiral(origin: { x: number; y: number }, width: number, height: number): { x: number; y: number }[] {
  const outer = Math.min(width, height) * 0.42;
  const inner = Math.max(64, Math.min(width, height) * 0.16);
  const turns = 2.2;
  const steps = 320;
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const theta = t * turns * Math.PI * 2;
    const r = outer + (inner - outer) * t;
    points.push({ x: origin.x + Math.cos(theta) * r, y: origin.y + Math.sin(theta) * r });
  }
  return points;
}

function snake(width: number, height: number): { x: number; y: number }[] {
  const left = width * 0.1;
  const right = width * 0.9;
  const rows = [height * 0.16, height * 0.32, height * 0.62, height * 0.8];
  const points: { x: number; y: number }[] = [];
  rows.forEach((y, index) => {
    const from = index % 2 === 0 ? right : left;
    const to = index % 2 === 0 ? left : right;
    const prev = points[points.length - 1];
    if (prev) {
      for (let i = 1; i <= 8; i++) points.push({ x: prev.x, y: prev.y + ((y - prev.y) * i) / 8 });
    }
    for (let i = prev ? 1 : 0; i <= 24; i++) points.push({ x: from + ((to - from) * i) / 24, y });
  });
  return points;
}

function loop(origin: { x: number; y: number }, width: number, height: number): { x: number; y: number }[] {
  const outer = rounded(origin, Math.min(width, height) * 0.4, Math.min(width, height) * 0.34, 0, Math.PI * 2);
  const inner = rounded(origin, Math.min(width, height) * 0.24, Math.min(width, height) * 0.2, Math.PI * 2, Math.PI * 0.35);
  const bridge = outer[outer.length - 1];
  const door = inner[0];
  const points = outer.slice();
  if (bridge && door) {
    for (let i = 1; i <= 8; i++) {
      const t = i / 8;
      points.push({ x: bridge.x + (door.x - bridge.x) * t, y: bridge.y + (door.y - bridge.y) * t });
    }
  }
  points.push(...inner.slice(1));
  return points;
}

function rounded(
  origin: { x: number; y: number },
  rx: number,
  ry: number,
  from: number,
  to: number,
): { x: number; y: number }[] {
  const steps = 80;
  const points: { x: number; y: number }[] = [];
  for (let i = 0; i <= steps; i++) {
    const theta = from + ((to - from) * i) / steps;
    const x = Math.cos(theta);
    const y = Math.sin(theta);
    const ax = Math.abs(x) ** 0.55;
    const ay = Math.abs(y) ** 0.55;
    points.push({
      x: origin.x + Math.sign(x) * ax * rx,
      y: origin.y + Math.sign(y) * ay * ry,
    });
  }
  return points;
}
