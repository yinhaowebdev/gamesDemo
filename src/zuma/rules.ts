export const DIAMETER = 1;

export interface Ball {
  id: number;
  color: number;
}

/** 下标 0 是最靠近终点的球。head 是这颗球在轨道上的位置。 */
export interface Segment {
  head: number;
  balls: Ball[];
}

export interface LevelDef {
  colors: number;
  count: number;
  speed: number;
}

export interface Rng {
  int(max: number): number;
}

export type Side = "before" | "after";

export interface StepResult {
  segments: Segment[];
  lost: boolean;
  won: boolean;
}

export const LEVELS: LevelDef[] = [
  { colors: 4, count: 24, speed: 0.4 },
  { colors: 4, count: 36, speed: 0.5 },
  { colors: 5, count: 48, speed: 0.62 },
  { colors: 5, count: 60, speed: 0.78 },
];

const CATCH = 3;

export function pathLength(level: LevelDef): number {
  return level.count + 32;
}

export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return {
    int(max: number) {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      const n = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
      return Math.floor(n * max);
    },
  };
}

export function isWon(segments: readonly Segment[]): boolean {
  return segments.every((segment) => segment.balls.length === 0);
}

export function isLost(segments: readonly Segment[], limit: number): boolean {
  return segments.some((segment) => segment.balls.length > 0 && segment.head >= limit);
}

export function ballCount(segments: readonly Segment[]): number {
  return segments.reduce((sum, segment) => sum + segment.balls.length, 0);
}

export function colorsIn(segments: readonly Segment[]): number[] {
  const found: number[] = [];
  for (const segment of segments) {
    for (const ball of segment.balls) {
      if (!found.includes(ball.color)) found.push(ball.color);
    }
  }
  return found;
}

export function drawColor(segments: readonly Segment[], rng: Rng): number {
  const colors = colorsIn(segments);
  if (colors.length === 0) return 0;
  return colors[rng.int(colors.length)] ?? 0;
}

export function placeOf(segment: Segment, index: number): number {
  return segment.head - index * DIAMETER;
}

function touchHead(front: Segment): number {
  return front.head - front.balls.length * DIAMETER;
}

function sameSeam(front: Segment, rear: Segment): boolean {
  const tail = front.balls[front.balls.length - 1];
  const nose = rear.balls[0];
  return tail != null && nose != null && tail.color === nose.color;
}

function clone(segments: readonly Segment[]): Segment[] {
  return segments.map((segment) => ({
    head: segment.head,
    balls: segment.balls.map((ball) => ({ id: ball.id, color: ball.color })),
  }));
}

function byFront(segments: readonly Segment[]): Segment[] {
  return clone(segments).sort((a, b) => b.head - a.head);
}

function runAt(balls: readonly Ball[], index: number): { start: number; end: number } {
  const color = balls[index]?.color;
  let start = index;
  let end = index + 1;
  while (start > 0 && balls[start - 1]?.color === color) start -= 1;
  while (end < balls.length && balls[end]?.color === color) end += 1;
  return { start, end };
}

function split(segment: Segment, start: number, end: number): Segment[] {
  const parts: Segment[] = [];
  if (start > 0) parts.push({ head: segment.head, balls: segment.balls.slice(0, start) });
  if (end < segment.balls.length) {
    parts.push({
      head: segment.head - end * DIAMETER,
      balls: segment.balls.slice(end),
    });
  }
  return parts;
}

function clearAt(segment: Segment, index: number): Segment[] {
  if (index < 0 || index >= segment.balls.length) return [segment];
  const { start, end } = runAt(segment.balls, index);
  if (end - start < 3) return [segment];
  return split(segment, start, end);
}

export function insertBall(
  segments: readonly Segment[],
  segmentIndex: number,
  ballIndex: number,
  side: Side,
  ball: Ball,
): Segment[] {
  const next = clone(segments);
  const segment = next[segmentIndex];
  if (!segment) return next;
  const at = side === "before" ? ballIndex : ballIndex + 1;
  segment.balls.splice(at, 0, { id: ball.id, color: ball.color });
  const parts = clearAt(segment, at);
  next.splice(segmentIndex, 1, ...parts);
  return next;
}

export function resolveContacts(segments: readonly Segment[]): Segment[] {
  const current = byFront(segments).filter((segment) => segment.balls.length > 0);
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < current.length - 1; i++) {
      const front = current[i];
      const rear = current[i + 1];
      if (!front || !rear) continue;
      if (rear.head < touchHead(front) - 1e-6) continue;
      const merged: Segment = { head: front.head, balls: [...front.balls, ...rear.balls] };
      const parts = clearAt(merged, front.balls.length);
      current.splice(i, 2, ...parts);
      changed = true;
      break;
    }
  }
  return current;
}

export function hasGap(segments: readonly Segment[]): boolean {
  const ordered = byFront(segments);
  for (let i = 0; i < ordered.length - 1; i++) {
    const front = ordered[i];
    const rear = ordered[i + 1];
    if (!front || !rear) continue;
    if (rear.head < touchHead(front) - 1e-6) return true;
  }
  return false;
}

export function advance(segments: readonly Segment[], distance: number, limit: number): StepResult {
  const ordered = byFront(segments);
  const shift = ordered.map(() => distance);
  for (let i = 0; i < ordered.length - 1; i++) {
    const front = ordered[i];
    const rear = ordered[i + 1];
    if (!front || !rear) continue;
    const gap = touchHead(front) - rear.head;
    if (gap <= 1e-6) continue;
    if (sameSeam(front, rear)) {
      const pull = Math.min(CATCH * distance, gap);
      for (let k = 0; k <= i; k++) {
        const current = shift[k] ?? distance;
        shift[k] = current > 0 ? -pull : current - pull;
      }
    } else {
      const current = shift[i + 1] ?? distance;
      if (current > 0) shift[i + 1] = distance * CATCH;
    }
  }
  const moved = ordered.map((segment, index) => ({
    head: segment.head + (shift[index] ?? distance),
    balls: segment.balls,
  }));
  for (let i = 0; i < moved.length - 1; i++) {
    const front = moved[i];
    const rear = moved[i + 1];
    if (!front || !rear) continue;
    const touch = touchHead(front);
    if (rear.head > touch) rear.head = touch;
  }
  if (isLost(moved, limit)) return { segments: moved, lost: true, won: false };
  const joined = resolveContacts(moved);
  return { segments: joined, lost: false, won: isWon(joined) };
}

export function createLevel(level: LevelDef, rng: Rng): Segment[] {
  const balls: Ball[] = [];
  let id = 1;
  for (let i = 0; i < level.count; i++) {
    let color = rng.int(Math.max(1, level.colors));
    const prev = balls[i - 1];
    const prev2 = balls[i - 2];
    if (prev && prev2 && prev.color === color && prev2.color === color && level.colors > 1) {
      color = (color + 1 + rng.int(level.colors - 1)) % level.colors;
    }
    balls.push({ id, color });
    id += 1;
  }
  return [{ head: level.count, balls }];
}
