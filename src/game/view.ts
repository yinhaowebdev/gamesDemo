import { type Board, type CascadeStep, COLS, type Gem, type Pos, ROWS } from "./board.ts";

const FLOWERS = [
  new URL("../assets/flowers/flower-red.jpg", import.meta.url).href,
  new URL("../assets/flowers/flower-yellow.jpg", import.meta.url).href,
  new URL("../assets/flowers/flower-cyan.jpg", import.meta.url).href,
  new URL("../assets/flowers/flower-green.jpg", import.meta.url).href,
  new URL("../assets/flowers/flower-purple.jpg", import.meta.url).href,
  new URL("../assets/flowers/flower-orange.jpg", import.meta.url).href,
];

const SWAP_MS = 160;
const POP_MS = 180;
const FALL_MS = 230;

const KINDS = [
  { shape: "circle", color: "#ff4d6d" },
  { shape: "square", color: "#ffd166" },
  { shape: "diamond", color: "#4cc9f0" },
  { shape: "hex", color: "#80ed99" },
  { shape: "triangle", color: "#c77dff" },
  { shape: "oval", color: "#ff9f1c" },
];

export interface View {
  mount(board: Board): void;
  setSelected(pos: Pos | null): void;
  animateSwap(a: Pos, b: Pos): Promise<void>;
  playStep(step: CascadeStep): Promise<void>;
  show(board: Board): Promise<void>;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

export function createView(root: HTMLElement): View {
  const grid = document.createElement("div");
  grid.className = "grid";
  const slots = document.createElement("div");
  slots.className = "slots";
  const pieces = document.createElement("div");
  pieces.className = "pieces";
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const slot = document.createElement("div");
      slot.className = "slot";
      slot.style.transform = `translate(${c * 100}%, ${r * 100}%)`;
      slots.append(slot);
    }
  }
  grid.append(slots, pieces);
  root.replaceChildren(grid);

  const byId = new Map<number, HTMLElement>();

  function writePos(el: HTMLElement, pos: Pos, ms: number): void {
    el.dataset.r = String(pos.r);
    el.dataset.c = String(pos.c);
    el.style.transition = ms > 0 ? `transform ${ms}ms ease` : "none";
    el.style.transform = `translate(${pos.c * 100}%, ${pos.r * 100}%)`;
  }

  function gemAt(pos: Pos): HTMLElement | null {
    for (const el of byId.values()) {
      if (Number(el.dataset.r) === pos.r && Number(el.dataset.c) === pos.c) return el;
    }
    return null;
  }

  function createGem(gem: Gem, pos: Pos): HTMLElement {
    const el = document.createElement("div");
    el.className = "gem";
    el.dataset.id = String(gem.id);
    el.dataset.special = gem.special;
    const inner = document.createElement("div");
    inner.className = "gem-inner";
    const shape = document.createElement("div");
    const style = KINDS[gem.kind] ?? KINDS[0];
    shape.className = `shape ${style.shape}`;
    shape.style.backgroundColor = style.color;
    shape.style.setProperty("--gem", style.color);
    const photo = document.createElement("img");
    photo.src = FLOWERS[gem.kind] ?? FLOWERS[0] ?? "";
    photo.alt = "";
    shape.append(photo);
    inner.append(shape);
    el.append(inner);
    pieces.append(el);
    byId.set(gem.id, el);
    writePos(el, pos, 0);
    return el;
  }

  return {
    mount(board) {
      pieces.replaceChildren();
      byId.clear();
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const gem = board[r][c];
          if (gem) createGem(gem, { r, c });
        }
      }
    },

    setSelected(pos) {
      for (const el of byId.values()) el.classList.remove("selected");
      if (!pos) return;
      gemAt(pos)?.classList.add("selected");
    },

    async animateSwap(a, b) {
      const first = gemAt(a);
      const second = gemAt(b);
      if (!first || !second) return;
      writePos(first, b, SWAP_MS);
      writePos(second, a, SWAP_MS);
      await wait(SWAP_MS + 20);
    },

    async playStep(step) {
      const popping: HTMLElement[] = [];
      for (const pos of step.clear.cleared) {
        const el = gemAt(pos);
        if (!el) continue;
        el.classList.remove("selected");
        el.querySelector(".gem-inner")?.classList.add("pop");
        popping.push(el);
      }
      if (popping.length > 0) await wait(POP_MS);
      for (const el of popping) {
        byId.delete(Number(el.dataset.id));
        el.remove();
      }
      for (const spawned of step.clear.spawned) {
        const el = createGem(spawned.gem, spawned.pos);
        el.querySelector(".gem-inner")?.classList.add("pop-in");
      }
      for (const birth of step.births) {
        createGem(birth.gem, { r: birth.fromRow, c: birth.to.c });
      }
      if (step.clear.spawned.length > 0 || step.births.length > 0) {
        void pieces.offsetWidth;
      }
      for (const fall of step.falls) {
        const el = byId.get(fall.id);
        if (el) writePos(el, fall.to, FALL_MS);
      }
      for (const birth of step.births) {
        const el = byId.get(birth.gem.id);
        if (el) writePos(el, birth.to, FALL_MS);
      }
      if (step.falls.length > 0 || step.births.length > 0) await wait(FALL_MS + 40);
    },

    async show(board) {
      const seen = new Set<number>();
      let moved = false;
      for (let r = 0; r < ROWS; r++) {
        for (let c = 0; c < COLS; c++) {
          const gem = board[r][c];
          if (!gem) continue;
          seen.add(gem.id);
          const existing = byId.get(gem.id);
          if (!existing) {
            createGem(gem, { r, c });
            moved = true;
            continue;
          }
          if (Number(existing.dataset.r) !== r || Number(existing.dataset.c) !== c) {
            writePos(existing, { r, c }, FALL_MS);
            moved = true;
          }
        }
      }
      for (const [id, el] of byId) {
        if (seen.has(id)) continue;
        el.remove();
        byId.delete(id);
        moved = true;
      }
      if (moved) await wait(FALL_MS + 40);
    },
  };
}
