import { play } from "../audio/bus.ts";
import { createLinkScene, type LinkScene } from "./scene.ts";
import {
  LEVELS,
  TRAY_LIMIT,
  type Board,
  type TrayTile,
  createLevel,
  listTiles,
  mulberry32,
  placeInTray,
  removeTile,
  scatterPoses,
} from "./rules.ts";

const HINT = "点一个方块，确认后放进暂存。三个相同才能消。";

let back: () => void = () => {};
let scene: LinkScene | null = null;
let epoch = 0;
let wired = false;
let levelIndex = 0;
let board: Board | null = null;
let tray: TrayTile[] = [];
let held: TrayTile | null = null;
let busy = false;
let ended = false;
let remaining = 0;
let shownSecond = -1;
const rng = mulberry32(Date.now() >>> 0);

function must<T extends Element>(selector: string): T {
  const el = document.querySelector<T>(selector);
  if (!el) throw new Error(`缺少 ${selector}`);
  return el;
}

function formatTime(seconds: number): string {
  const whole = Math.max(0, Math.ceil(seconds));
  const minutes = Math.floor(whole / 60);
  const rest = whole % 60;
  return `${minutes}:${rest.toString().padStart(2, "0")}`;
}

function renderHud(count = tray.length): void {
  must<HTMLElement>("#link-level").textContent = `第 ${levelIndex + 1} 关`;
  must<HTMLElement>("#link-pairs").textContent = `暂存 ${count}/${TRAY_LIMIT}`;
  const second = Math.ceil(remaining);
  shownSecond = second;
  must<HTMLElement>("#link-time").textContent = formatTime(remaining);
}

function renderHeld(): void {
  const slot = must<HTMLButtonElement>("#link-held");
  const confirm = must<HTMLButtonElement>("#link-confirm");
  const locked = held === null || busy || ended;
  slot.replaceChildren();
  slot.classList.toggle("is-held", held !== null);
  slot.disabled = locked;
  confirm.disabled = locked;
  if (!held || !scene) return;
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  scene.paintToy(canvas, held.kind);
  slot.appendChild(canvas);
}

function renderTray(slots: readonly TrayTile[]): void {
  const root = must<HTMLElement>("#link-tray");
  root.replaceChildren();
  for (let i = 0; i < TRAY_LIMIT; i++) {
    const slot = document.createElement("div");
    slot.className = "tray-slot";
    const tile = slots[i];
    if (tile && scene) {
      const canvas = document.createElement("canvas");
      canvas.width = 128;
      canvas.height = 128;
      scene.paintToy(canvas, tile.kind);
      slot.appendChild(canvas);
    }
    root.appendChild(slot);
  }
}

function showOverlay(title: string, text: string, action: string): void {
  ended = true;
  play(title === "时间到" || title === "暂存区满了" ? "lose" : "win");
  must<HTMLElement>("#link-overlay-title").textContent = title;
  must<HTMLElement>("#link-overlay-text").textContent = text;
  must<HTMLButtonElement>("#link-overlay-action").textContent = action;
  must<HTMLElement>("#link-overlay").hidden = false;
  renderHeld();
}

function begin(index: number): void {
  const level = LEVELS[index];
  if (!level || !scene) return;
  epoch += 1;
  const token = epoch;
  levelIndex = index;
  board = createLevel(level, rng);
  tray = [];
  held = null;
  busy = true;
  ended = false;
  remaining = level.seconds;
  shownSecond = -1;
  must<HTMLElement>("#link-overlay").hidden = true;
  must<HTMLElement>("#link-hint").textContent = HINT;
  scene.setBoard(board, scatterPoses(board, rng));
  scene.setHeld(null);
  renderTray(tray);
  renderHeld();
  renderHud();
  void scene.settle().finally(() => {
    if (token === epoch) {
      busy = false;
      renderHeld();
    }
  });
}

function onFrame(dt: number): void {
  if (!board || busy || ended) return;
  remaining -= dt;
  if (remaining <= 0) {
    remaining = 0;
    renderHud();
    showOverlay("时间到", "这一局超时了", "重试");
    return;
  }
  const second = Math.ceil(remaining);
  if (second !== shownSecond) {
    shownSecond = second;
    must<HTMLElement>("#link-time").textContent = formatTime(remaining);
  }
}

function clearHeld(): void {
  held = null;
  scene?.setHeld(null);
  renderHeld();
}

function onPick(id: number): void {
  if (!board || !scene || busy || ended) return;
  if (held?.id === id) {
    clearHeld();
    return;
  }
  const found = listTiles(board).find((entry) => entry.tile.id === id);
  if (!found) return;
  held = { id: found.tile.id, kind: found.tile.kind };
  scene.setHeld(id);
  renderHeld();
}

function confirmHeld(): void {
  if (!board || !scene || busy || ended || !held) return;
  const tile = removeTile(board, held.id);
  if (!tile) return;
  clearHeld();
  const token = epoch;
  const current = scene;
  busy = true;
  renderHeld();
  const placed = placeInTray(tray, tile);
  const pending = tray.slice();
  let insertAt = pending.length;
  for (let i = pending.length - 1; i >= 0; i--) {
    if (pending[i]?.kind === tile.kind) {
      insertAt = i + 1;
      break;
    }
  }
  pending.splice(insertAt, 0, tile);
  tray = placed.slots;
  renderTray(pending);
  renderHud(pending.length);
  void finishPick(token, current, tile.id, placed.cleared.length > 0, placed.full);
}

async function finishPick(
  token: number,
  current: LinkScene,
  id: number,
  cleared: boolean,
  full: boolean,
): Promise<void> {
  try {
    await current.playTake(id);
    if (token !== epoch || scene !== current || !board) return;
    await current.settle();
    if (token !== epoch || scene !== current || !board) return;
    if (cleared) {
      play("triple");
      await wait(220);
      if (token !== epoch || scene !== current) return;
      renderTray(tray);
    }
    renderHud();
    if (listTiles(board).length === 0 && tray.length === 0) {
      const last = levelIndex >= LEVELS.length - 1;
      showOverlay(last ? "全部通过" : "过关", "方块清完了", last ? "再来一局" : "下一关");
      return;
    }
    if (full) showOverlay("暂存区满了", "没有凑成三个", "重试");
  } finally {
    if (token === epoch) {
      busy = false;
      renderHeld();
    }
  }
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function wire(): void {
  if (wired) return;
  wired = true;
  must<HTMLButtonElement>("#link-back").addEventListener("click", () => back());
  must<HTMLButtonElement>("#link-held").addEventListener("click", () => {
    if (busy || ended) return;
    clearHeld();
  });
  must<HTMLButtonElement>("#link-confirm").addEventListener("click", () => confirmHeld());
  must<HTMLButtonElement>("#link-overlay-action").addEventListener("click", () => {
    const action = must<HTMLButtonElement>("#link-overlay-action").textContent;
    if (action === "下一关") begin(levelIndex + 1);
    else if (action === "再来一局") begin(0);
    else begin(levelIndex);
  });
}

export function startLink(onBack: () => void): void {
  back = onBack;
  wire();
  busy = false;
  if (!scene) {
    const canvas = must<HTMLCanvasElement>("#link-view");
    scene = createLinkScene(canvas, { onPick, onFrame });
  }
  begin(levelIndex);
}

export function stopLink(): void {
  epoch += 1;
  scene?.suspend();
  busy = false;
}
