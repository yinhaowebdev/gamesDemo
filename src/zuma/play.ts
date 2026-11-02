import { play } from "../audio/bus.ts";
import { createFlight, sideFromContact, type Flight, type FlightHit } from "./flight.ts";
import { createZumaView, type Nudge, type Shot, type ZumaMap, type ZumaView } from "./view.ts";
import {
  LEVELS,
  type Segment,
  type Side,
  advance,
  ballCount,
  createLevel,
  drawColor,
  insertBall,
  isWon,
  mulberry32,
  pathLength,
  placeOf,
} from "./rules.ts";

const HINT = "瞄准轨道上的球，三个同色就能消。";
const SHOT_SPEED = 740;
const MAPS: ZumaMap[] = ["spiral", "snake", "loop"];

let back: () => void = () => {};
let view: ZumaView | null = null;
let wired = false;
let looping = false;
let raf = 0;
let last = 0;
let levelIndex = 0;
let map: ZumaMap = "spiral";
let segments: Segment[] = [];
let held = 0;
let upcoming = 0;
let shot: Shot | null = null;
let flight: Flight | null = null;
let seat: Seat | null = null;
let ended = false;
let seq = 1;
let shownCount = -1;
const rng = mulberry32(Date.now() >>> 0);

interface Seat {
  segmentIndex: number;
  ballIndex: number;
  side: Side;
  color: number;
  elapsed: number;
}

function must<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`缺少 ${selector}`);
  return el;
}

function renderHud(): void {
  must<HTMLElement>("#zuma-level").textContent = `第 ${levelIndex + 1} 关`;
  const count = ballCount(segments);
  if (count !== shownCount) {
    shownCount = count;
    must<HTMLElement>("#zuma-left").textContent = `剩余 ${count}`;
  }
}

function showOverlay(title: string, text: string, action: string): void {
  ended = true;
  shot = null;
  seat = null;
  flight?.clear();
  must<HTMLElement>("#zuma-overlay-title").textContent = title;
  must<HTMLElement>("#zuma-overlay-text").textContent = text;
  must<HTMLButtonElement>("#zuma-overlay-action").textContent = action;
  must<HTMLElement>("#zuma-overlay").hidden = false;
}

function begin(index: number): void {
  const level = LEVELS[index];
  if (!level || !view) return;
  levelIndex = index;
  segments = createLevel(level, rng);
  seq = level.count + 1;
  held = drawColor(segments, rng);
  upcoming = drawColor(segments, rng);
  shot = null;
  seat = null;
  flight?.clear();
  ended = false;
  shownCount = -1;
  must<HTMLElement>("#zuma-overlay").hidden = true;
  must<HTMLElement>("#zuma-hint").textContent = HINT;
  renderHud();
  renderMaps();
  ensureLoop();
}

function renderMaps(): void {
  for (const id of MAPS) {
    must<HTMLButtonElement>(`#zuma-map-${id}`).classList.toggle("is-on", id === map);
  }
}

function chooseMap(next: ZumaMap): void {
  map = next;
  view?.setMap(next);
  begin(levelIndex);
}

function finish(title: string, text: string, action: string, cue: "win" | "lose"): void {
  if (ended) return;
  play(cue);
  showOverlay(title, text, action);
}

function launch(): void {
  if (!view || !flight || ended || shot || seat) return;
  const angle = view.aim();
  const origin = view.shooter();
  const radius = view.ballRadius();
  const start = radius * 2.2;
  const x = origin.x + Math.cos(angle) * start;
  const y = origin.y + Math.sin(angle) * start;
  flight.launch(x, y, Math.cos(angle) * SHOT_SPEED, Math.sin(angle) * SHOT_SPEED, radius);
  shot = { x, y, color: held };
  play("shoot");
}

function tangentAt(distance: number): { x: number; y: number } {
  const board = view;
  if (!board) return { x: 1, y: 0 };
  const a = board.point(distance);
  const b = board.point(distance + 0.35);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: dx / len, y: dy / len };
}

function miss(): void {
  shot = null;
  seat = null;
  flight?.clearShot();
  held = upcoming;
  upcoming = drawColor(segments, rng);
}

function beginSeat(found: FlightHit): void {
  if (!shot || !view) return;
  const parts = found.key.split(":");
  const segmentIndex = Number(parts[0]);
  const ballIndex = Number(parts[1]);
  const segment = segments[segmentIndex];
  if (!segment || !Number.isInteger(segmentIndex) || !Number.isInteger(ballIndex)) {
    miss();
    return;
  }
  const tangent = tangentAt(placeOf(segment, ballIndex));
  seat = {
    segmentIndex,
    ballIndex,
    side: sideFromContact(tangent.x, tangent.y, found.nx, found.ny),
    color: shot.color,
    elapsed: 0,
  };
  play("seat");
}

function nudgeOf(): Nudge | null {
  if (!seat) return null;
  const at = seat.side === "before" ? seat.ballIndex : seat.ballIndex + 1;
  return { segmentIndex: seat.segmentIndex, fromIndex: at, amount: -Math.min(1, seat.elapsed / 0.2) };
}

function commitSeat(): void {
  if (!seat) return;
  const before = ballCount(segments);
  const id = seq;
  seq += 1;
  segments = insertBall(segments, seat.segmentIndex, seat.ballIndex, seat.side, { id, color: seat.color });
  const cleared = ballCount(segments) < before;
  seat = null;
  shot = null;
  flight?.clearShot();
  held = upcoming;
  upcoming = drawColor(segments, rng);
  if (cleared) play("clear");
  if (isWon(segments)) {
    const last = levelIndex >= LEVELS.length - 1;
    finish(last ? "全部通过" : "过关", "球清完了", last ? "再来一局" : "下一关", "win");
  }
}

function tickFlight(dt: number): void {
  const board = view;
  if (!board || !flight || !shot) return;
  const radius = board.ballRadius();
  const balls = segments.flatMap((segment, segmentIndex) =>
    segment.balls.map((_, ballIndex) => {
      const at = board.point(placeOf(segment, ballIndex));
      return { key: `${segmentIndex}:${ballIndex}`, x: at.x, y: at.y, radius };
    }),
  );
  flight.sync(balls);
  flight.step(dt);
  const pos = flight.position();
  if (pos) {
    shot.x = pos.x;
    shot.y = pos.y;
  }
  const hit = flight.takeHit();
  if (hit) beginSeat(hit);
  else if (shot && board.outside(shot.x, shot.y)) miss();
}

function tickSeat(dt: number): void {
  const board = view;
  if (!board || !flight || !shot || !seat) return;
  seat.elapsed += dt;
  const segment = segments[seat.segmentIndex];
  if (!segment) {
    miss();
    return;
  }
  const at = seat.side === "before" ? seat.ballIndex : seat.ballIndex + 1;
  const target = board.point(placeOf(segment, at));
  flight.pull(target.x, target.y);
  flight.step(dt);
  const pos = flight.position();
  if (pos) {
    shot.x = pos.x;
    shot.y = pos.y;
  }
  const close = pos != null && Math.hypot(pos.x - target.x, pos.y - target.y) < board.ballRadius() * 0.4;
  if ((seat.elapsed >= 0.2 && close) || seat.elapsed >= 0.45) commitSeat();
}

function frame(now: number): void {
  if (!looping) return;
  raf = requestAnimationFrame(frame);
  const dt = last === 0 ? 1 / 60 : Math.min(0.05, (now - last) / 1000);
  last = now;
  const level = LEVELS[levelIndex];
  if (level && !ended) {
    if (seat) tickSeat(dt);
    else {
      const step = advance(segments, level.speed * dt, pathLength(level));
      segments = step.segments;
      if (step.lost) finish("到终点了", "球滚到头了", "重试", "lose");
      else if (step.won) {
        const last = levelIndex >= LEVELS.length - 1;
        finish(last ? "全部通过" : "过关", "球清完了", last ? "再来一局" : "下一关", "win");
      } else if (shot) tickFlight(dt);
    }
  }
  view?.draw({
    pathUnits: level ? pathLength(level) : 1,
    segments,
    held,
    next: upcoming,
    shot,
    nudge: nudgeOf(),
  });
  renderHud();
}

function ensureLoop(): void {
  if (looping) return;
  looping = true;
  last = 0;
  raf = requestAnimationFrame(frame);
}

function wire(): void {
  if (wired) return;
  wired = true;
  must<HTMLButtonElement>("#zuma-back").addEventListener("click", () => back());
  for (const id of MAPS) {
    must<HTMLButtonElement>(`#zuma-map-${id}`).addEventListener("click", () => chooseMap(id));
  }
  must<HTMLButtonElement>("#zuma-overlay-action").addEventListener("click", () => {
    const action = must<HTMLButtonElement>("#zuma-overlay-action").textContent;
    if (action === "下一关") begin(levelIndex + 1);
    else if (action === "再来一局") begin(0);
    else begin(levelIndex);
  });
}

export function startZuma(onBack: () => void): void {
  back = onBack;
  wire();
  if (!view) {
    view = createZumaView(must<HTMLCanvasElement>("#zuma-view"));
    view.listen(launch);
    flight = createFlight();
  }
  begin(levelIndex);
}

export function stopZuma(): void {
  looping = false;
  cancelAnimationFrame(raf);
  raf = 0;
  last = 0;
  shot = null;
  seat = null;
  flight?.clear();
}
