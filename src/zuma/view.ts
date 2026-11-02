import { paintCharacter } from "../art/characters.ts";
import { type Segment, placeOf } from "./rules.ts";

export const COLORS = ["#ff5d8f", "#ffd166", "#7bdff2", "#c8f7a0", "#c9a6ff"];

export type ZumaMap =
  | "spiral"
  | "snake"
  | "loop"
  | "castle"
  | "subway"
  | "river"
  | "maze"
  | "mountain"
  | "garden"
  | "interchange";

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
    const cssW = canvas.clientWidth || 1;
    const cssH = canvas.clientHeight || 1;
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
    observer.observe(canvas);
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
  if (map === "castle") return roundedPoly(width, height, CASTLE);
  if (map === "subway") return roundedPoly(width, height, SUBWAY);
  if (map === "river") return river(width, height);
  if (map === "maze") return roundedPoly(width, height, MAZE);
  if (map === "mountain") return roundedPoly(width, height, MOUNTAIN);
  if (map === "garden") return garden(width, height);
  if (map === "interchange") return interchange(width, height);
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

const CASTLE: Pt[] = [
  { x: 0.84, y: 0.74 },
  { x: 0.16, y: 0.74 },
  { x: 0.16, y: 0.16 },
  { x: 0.84, y: 0.16 },
  { x: 0.84, y: 0.58 },
  { x: 0.7, y: 0.58 },
  { x: 0.7, y: 0.36 },
  { x: 0.3, y: 0.36 },
  { x: 0.3, y: 0.24 },
  { x: 0.5, y: 0.24 },
];

const SUBWAY: Pt[] = [
  { x: 0.12, y: 0.16 },
  { x: 0.88, y: 0.16 },
  { x: 0.88, y: 0.34 },
  { x: 0.2, y: 0.34 },
  { x: 0.2, y: 0.66 },
  { x: 0.8, y: 0.66 },
  { x: 0.8, y: 0.84 },
  { x: 0.16, y: 0.84 },
];

const MAZE: Pt[] = [
  { x: 0.12, y: 0.12 },
  { x: 0.88, y: 0.12 },
  { x: 0.88, y: 0.28 },
  { x: 0.24, y: 0.28 },
  { x: 0.24, y: 0.56 },
  { x: 0.76, y: 0.56 },
  { x: 0.76, y: 0.74 },
  { x: 0.16, y: 0.74 },
  { x: 0.16, y: 0.88 },
  { x: 0.42, y: 0.88 },
];

const MOUNTAIN: Pt[] = [
  { x: 0.86, y: 0.82 },
  { x: 0.14, y: 0.82 },
  { x: 0.2, y: 0.68 },
  { x: 0.8, y: 0.68 },
  { x: 0.74, y: 0.54 },
  { x: 0.26, y: 0.54 },
  { x: 0.32, y: 0.4 },
  { x: 0.68, y: 0.4 },
  { x: 0.62, y: 0.26 },
  { x: 0.38, y: 0.26 },
  { x: 0.38, y: 0.36 },
];

function river(width: number, height: number): Pt[] {
  const points: Pt[] = [];
  const steps = 160;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push({
      x: width * (0.5 + Math.sin(t * Math.PI * 3.5) * 0.32),
      y: height * (0.1 + t * 0.8),
    });
  }
  return points;
}

function garden(width: number, height: number): Pt[] {
  const radius = Math.min(width, height) * 0.1;
  const beds = [
    { x: width * 0.24, y: height * 0.22, from: Math.PI * 0.2, to: Math.PI * 1.7 },
    { x: width * 0.76, y: height * 0.24, from: Math.PI * 1.1, to: Math.PI * 2.6 },
    { x: width * 0.74, y: height * 0.76, from: -Math.PI * 0.2, to: Math.PI * 1.3 },
    { x: width * 0.26, y: height * 0.74, from: Math.PI * 0.8, to: Math.PI * 2.2 },
  ];
  const points: Pt[] = [];
  beds.forEach((bed, index) => {
    const arcPoints = arc(bed.x, bed.y, radius, bed.from, bed.to, 28);
    const prev = points[points.length - 1];
    const door = arcPoints[0];
    if (prev && door) points.push(...line(prev, door, 8));
    points.push(...arcPoints.slice(index === 0 ? 0 : 1));
  });
  return points;
}

function interchange(width: number, height: number): Pt[] {
  const points: Pt[] = [];
  const steps = 36;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    points.push({
      x: width * (0.12 + t * 0.76),
      y: height * (0.2 + Math.sin(t * Math.PI) * 0.08),
    });
  }
  const crest = points[points.length - 1];
  if (!crest) return points;
  points.push(...line(crest, { x: width * 0.88, y: height * 0.78 }, 14));
  const drop = points[points.length - 1];
  if (!drop) return points;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    points.push({
      x: width * (0.88 - t * 0.7),
      y: height * (0.78 - Math.sin(t * Math.PI) * 0.06),
    });
  }
  const lane = points[points.length - 1];
  if (!lane) return points;
  const ramp = { x: width * 0.4, y: height * 0.62 };
  points.push(...line(lane, ramp, 10));
  points.push(...line(ramp, { x: width * 0.58, y: height * 0.68 }, 8));
  return points;
}

function roundedPoly(width: number, height: number, stops: readonly Pt[]): Pt[] {
  const pts = stops.map((point) => ({ x: point.x * width, y: point.y * height }));
  const first = pts[0];
  const last = pts[pts.length - 1];
  if (!first || !last) return [];
  if (pts.length < 3) return pts;
  const cutLimit = Math.min(width, height) * 0.045;
  const out: Pt[] = [first];
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1];
    const curr = pts[i];
    const next = pts[i + 1];
    const tail = out[out.length - 1];
    if (!prev || !curr || !next || !tail) continue;
    const inLen = Math.hypot(curr.x - prev.x, curr.y - prev.y) || 1;
    const outLen = Math.hypot(next.x - curr.x, next.y - curr.y) || 1;
    const cut = Math.min(cutLimit, inLen * 0.45, outLen * 0.45);
    const arrive = {
      x: curr.x - ((curr.x - prev.x) / inLen) * cut,
      y: curr.y - ((curr.y - prev.y) / inLen) * cut,
    };
    const leave = {
      x: curr.x + ((next.x - curr.x) / outLen) * cut,
      y: curr.y + ((next.y - curr.y) / outLen) * cut,
    };
    out.push(...line(tail, arrive, 8));
    const start = Math.atan2(arrive.y - curr.y, arrive.x - curr.x);
    let delta = Math.atan2(leave.y - curr.y, leave.x - curr.x) - start;
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    for (let step = 1; step <= 6; step++) {
      const theta = start + (delta * step) / 6;
      out.push({ x: curr.x + Math.cos(theta) * cut, y: curr.y + Math.sin(theta) * cut });
    }
  }
  const tail = out[out.length - 1];
  if (tail) out.push(...line(tail, last, 10));
  return out;
}

function line(from: Pt, to: Pt, steps: number): Pt[] {
  const points: Pt[] = [];
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    points.push({ x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
  }
  return points;
}

function arc(cx: number, cy: number, radius: number, from: number, to: number, steps: number): Pt[] {
  const points: Pt[] = [];
  for (let i = 0; i <= steps; i++) {
    const theta = from + ((to - from) * i) / steps;
    points.push({ x: cx + Math.cos(theta) * radius, y: cy + Math.sin(theta) * radius });
  }
  return points;
}

type Pt = { x: number; y: number };

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
