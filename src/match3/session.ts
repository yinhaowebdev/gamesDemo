import { play } from "../audio/bus.ts";
import {
  type Pos,
  COLS,
  ROWS,
  adjacent,
  createBoard,
  mulberry32,
  playSwap,
} from "../game/board.ts";
import { LEVELS, pointsFor } from "../game/levels.ts";
import { createView } from "../game/view.ts";

const SAVE_KEY = "xxl-progress";

interface Save {
  level: number;
  best: number[];
  finished: boolean;
}

function must<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`缺少 ${selector}`);
  return el;
}

const levelEl = must<HTMLElement>("#level");
const scoreEl = must<HTMLElement>("#score");
const targetEl = must<HTMLElement>("#target");
const bestEl = must<HTMLElement>("#best");
const movesEl = must<HTMLElement>("#moves");
const boardEl = must<HTMLElement>("#board");
const toastEl = must<HTMLElement>("#toast");
const overlayEl = must<HTMLElement>("#overlay");
const overlayTitle = must<HTMLElement>("#overlay-title");
const overlayText = must<HTMLElement>("#overlay-text");
const overlayAction = must<HTMLButtonElement>("#overlay-action");

const view = createView(boardEl);
const rng = mulberry32(Date.now() >>> 0);
let save = loadSave();
let levelIndex = save.level;
let board = createBoard(rng);
let score = 0;
let moves = LEVELS[levelIndex].moves;
let busy = false;
let selected: Pos | null = null;
let pointer: { id: number; pos: Pos; x: number; y: number } | null = null;
let toastTimer = 0;
let overlayMode: "win" | "lose" | "finished" | null = null;
let leave: () => void = () => {};
let booted = false;

function loadSave(): Save {
  const empty: Save = { level: 0, best: LEVELS.map(() => 0), finished: false };
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return empty;
    const parsed = JSON.parse(raw) as Partial<Save>;
    const best = LEVELS.map((_, index) => {
      const value = parsed.best?.[index];
      return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
    });
    const level =
      typeof parsed.level === "number"
        ? Math.min(LEVELS.length - 1, Math.max(0, Math.floor(parsed.level)))
        : 0;
    return { level, best, finished: parsed.finished === true };
  } catch {
    return empty;
  }
}

function persist(): void {
  save.best[levelIndex] = Math.max(save.best[levelIndex] ?? 0, score);
  localStorage.setItem(SAVE_KEY, JSON.stringify(save));
}

function renderHud(): void {
  const level = LEVELS[levelIndex];
  levelEl.textContent = String(levelIndex + 1);
  scoreEl.textContent = String(score);
  targetEl.textContent = `/ ${level.target}`;
  bestEl.textContent = `最高 ${save.best[levelIndex] ?? 0}`;
  movesEl.textContent = String(moves);
}

function showToast(text: string): void {
  toastEl.textContent = text;
  toastEl.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.hidden = true;
  }, 900);
}

function hideOverlay(): void {
  overlayEl.hidden = true;
  overlayMode = null;
}

function showOverlay(mode: "win" | "lose" | "finished", title: string, text: string, action: string): void {
  play(mode === "lose" ? "lose" : "win");
  overlayMode = mode;
  overlayTitle.textContent = title;
  overlayText.textContent = text;
  overlayAction.textContent = action;
  overlayEl.hidden = false;
}

function startLevel(index: number): void {
  levelIndex = index;
  save.level = index;
  score = 0;
  moves = LEVELS[index].moves;
  board = createBoard(rng);
  selected = null;
  view.mount(board);
  view.setSelected(null);
  hideOverlay();
  persist();
  renderHud();
}

function samePos(a: Pos, b: Pos): boolean {
  return a.r === b.r && a.c === b.c;
}

function cellFromEvent(event: PointerEvent): Pos | null {
  const rect = boardEl.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  if (x < 0 || y < 0 || x >= rect.width || y >= rect.height) return null;
  return {
    r: Math.min(ROWS - 1, Math.floor((y / rect.height) * ROWS)),
    c: Math.min(COLS - 1, Math.floor((x / rect.width) * COLS)),
  };
}

function dragTarget(origin: Pos, dx: number, dy: number): Pos | null {
  if (Math.hypot(dx, dy) < 18) return null;
  let r = origin.r;
  let c = origin.c;
  if (Math.abs(dx) > Math.abs(dy)) c += dx > 0 ? 1 : -1;
  else r += dy > 0 ? 1 : -1;
  if (r < 0 || c < 0 || r >= ROWS || c >= COLS) return null;
  return { r, c };
}

async function userSwap(from: Pos, to: Pos): Promise<void> {
  if (busy || overlayMode) return;
  if (!adjacent(from, to)) return;
  busy = true;
  selected = null;
  view.setSelected(null);
  try {
    const result = playSwap(board, from, to, rng);
    await view.animateSwap(from, to);
    if (!result.valid) {
      await view.animateSwap(to, from);
      return;
    }
    moves -= 1;
    renderHud();
    for (let index = 0; index < result.steps.length; index++) {
      const cleared = result.steps[index].clearedCount;
      if (cleared > 0) play("clear");
      score += pointsFor(cleared, index);
      renderHud();
      await view.playStep(result.steps[index]);
    }
    board = result.board;
    if (result.shuffled) {
      showToast("洗牌");
      await view.show(board);
    }
    persist();
    renderHud();
    const level = LEVELS[levelIndex];
    if (score >= level.target) {
      const last = levelIndex >= LEVELS.length - 1;
      if (last) {
        save.finished = true;
        persist();
        showOverlay("finished", "全部通过", `得分 ${score}`, "从头再来");
      } else {
        showOverlay("win", "过关", `得分 ${score}，目标 ${level.target}`, "下一关");
      }
    } else if (moves <= 0) {
      showOverlay("lose", "步数用尽", `得分 ${score}，目标 ${level.target}`, "重试");
    }
  } finally {
    busy = false;
  }
}

function onPointerUp(event: PointerEvent): void {
  if (!pointer || event.pointerId !== pointer.id) return;
  const start = pointer.pos;
  const dx = event.clientX - pointer.x;
  const dy = event.clientY - pointer.y;
  pointer = null;
  if (busy || overlayMode) return;
  const under = cellFromEvent(event);
  const dragged = under && adjacent(start, under) ? under : dragTarget(start, dx, dy);
  if (dragged) {
    void userSwap(start, dragged);
    return;
  }
  if (Math.hypot(dx, dy) >= 18) return;
  const tapped = under ?? start;
  if (selected && adjacent(selected, tapped)) {
    const from = selected;
    selected = null;
    view.setSelected(null);
    void userSwap(from, tapped);
    return;
  }
  if (selected && samePos(selected, tapped)) {
    selected = null;
    view.setSelected(null);
    return;
  }
  selected = tapped;
  view.setSelected(tapped);
}

function boot(): void {
  boardEl.addEventListener("pointerdown", (event) => {
    if (busy || overlayMode) return;
    const pos = cellFromEvent(event);
    if (!pos) return;
    event.preventDefault();
    try {
      boardEl.setPointerCapture(event.pointerId);
    } catch {
      // Untrusted events and some WebViews cannot capture the pointer.
    }
    pointer = { id: event.pointerId, pos, x: event.clientX, y: event.clientY };
  });
  boardEl.addEventListener("pointerup", onPointerUp);
  boardEl.addEventListener("pointercancel", onPointerUp);
  boardEl.addEventListener("contextmenu", (event) => event.preventDefault());
  overlayAction.addEventListener("click", () => {
    if (overlayMode === "win") {
      startLevel(levelIndex + 1);
      return;
    }
    if (overlayMode === "lose") {
      startLevel(levelIndex);
      return;
    }
    if (overlayMode === "finished") {
      save.finished = false;
      startLevel(0);
    }
  });
  must<HTMLButtonElement>("#match3-back").addEventListener("click", () => leave());
  view.mount(board);
  renderHud();
  if (save.finished) {
    showOverlay("finished", "全部通过", "十关都打完了", "从头再来");
  }
}

export function startMatch3(onBack: () => void): void {
  leave = onBack;
  if (booted) return;
  booted = true;
  boot();
}
