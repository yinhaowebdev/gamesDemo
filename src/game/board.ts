export const ROWS = 8;
export const COLS = 8;
export const KIND_COUNT = 6;

export type Special = "none" | "row" | "col" | "wrapped" | "bomb";

export interface Gem {
  id: number;
  kind: number;
  special: Special;
}

export interface Pos {
  r: number;
  c: number;
}

export type Board = (Gem | null)[][];

export interface Rng {
  int(max: number): number;
}

export interface Run {
  axis: "h" | "v";
  kind: number;
  cells: Pos[];
}

export interface Spawned {
  pos: Pos;
  gem: Gem;
}

export interface FallMove {
  id: number;
  from: Pos;
  to: Pos;
}

export interface Birth {
  gem: Gem;
  to: Pos;
  fromRow: number;
}

export interface CascadeStep {
  clear: {
    cleared: Pos[];
    spawned: Spawned[];
  };
  falls: FallMove[];
  births: Birth[];
  clearedCount: number;
}

export interface TurnResult {
  valid: boolean;
  board: Board;
  steps: CascadeStep[];
  shuffled: boolean;
}

interface Shape {
  kind: number;
  runs: Run[];
  cells: Pos[];
}

interface Spawn {
  pos: Pos;
  special: Special;
  kind: number;
}

const SPECIAL_RANK: Record<Special, number> = {
  none: 0,
  row: 1,
  col: 1,
  wrapped: 2,
  bomb: 3,
};

let nextId = 1;

export function resetIds(start = 1): void {
  nextId = start;
}

export function makeGem(kind: number, special: Special = "none"): Gem {
  const gem = { id: nextId, kind, special };
  nextId += 1;
  return gem;
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

export function adjacent(a: Pos, b: Pos): boolean {
  return Math.abs(a.r - b.r) + Math.abs(a.c - b.c) === 1;
}

function key(pos: Pos): string {
  return `${pos.r},${pos.c}`;
}

function parseKey(value: string): Pos {
  const [r, c] = value.split(",").map(Number);
  return { r, c };
}

function cloneBoard(board: Board): Board {
  return board.map((row) => row.map((cell) => (cell ? { ...cell } : null)));
}

function emptyBoard(): Board {
  return Array.from({ length: ROWS }, () => Array<Gem | null>(COLS).fill(null));
}

export function findRuns(board: Board): Run[] {
  const runs: Run[] = [];
  for (let r = 0; r < ROWS; r++) {
    let c = 0;
    while (c < COLS) {
      const start = c;
      const gem = board[r][c];
      if (!gem || gem.special === "bomb") {
        c += 1;
        continue;
      }
      c += 1;
      while (c < COLS) {
        const next = board[r][c];
        if (!next || next.special === "bomb" || next.kind !== gem.kind) break;
        c += 1;
      }
      if (c - start >= 3) {
        const cells: Pos[] = [];
        for (let i = start; i < c; i++) cells.push({ r, c: i });
        runs.push({ axis: "h", kind: gem.kind, cells });
      }
    }
  }
  for (let c = 0; c < COLS; c++) {
    let r = 0;
    while (r < ROWS) {
      const start = r;
      const gem = board[r][c];
      if (!gem || gem.special === "bomb") {
        r += 1;
        continue;
      }
      r += 1;
      while (r < ROWS) {
        const next = board[r][c];
        if (!next || next.special === "bomb" || next.kind !== gem.kind) break;
        r += 1;
      }
      if (r - start >= 3) {
        const cells: Pos[] = [];
        for (let i = start; i < r; i++) cells.push({ r: i, c });
        runs.push({ axis: "v", kind: gem.kind, cells });
      }
    }
  }
  return runs;
}

export function hasMatch(board: Board): boolean {
  return findRuns(board).length > 0;
}

function sharesCell(a: Run, b: Run): boolean {
  const cells = new Set(a.cells.map(key));
  return b.cells.some((pos) => cells.has(key(pos)));
}

function groupRuns(runs: Run[]): Shape[] {
  const parent = runs.map((_, index) => index);
  const find = (index: number): number => {
    let root = index;
    while (parent[root] !== root) root = parent[root];
    let cursor = index;
    while (parent[cursor] !== root) {
      const next = parent[cursor];
      parent[cursor] = root;
      cursor = next;
    }
    return root;
  };
  const unite = (a: number, b: number) => {
    const pa = find(a);
    const pb = find(b);
    if (pa !== pb) parent[pa] = pb;
  };
  for (let i = 0; i < runs.length; i++) {
    for (let j = i + 1; j < runs.length; j++) {
      if (runs[i].kind !== runs[j].kind) continue;
      if (sharesCell(runs[i], runs[j])) unite(i, j);
    }
  }
  const groups = new Map<number, Run[]>();
  for (let i = 0; i < runs.length; i++) {
    const root = find(i);
    const list = groups.get(root);
    if (list) list.push(runs[i]);
    else groups.set(root, [runs[i]]);
  }
  const shapes: Shape[] = [];
  for (const shapeRuns of groups.values()) {
    const seen = new Set<string>();
    const cells: Pos[] = [];
    for (const run of shapeRuns) {
      for (const pos of run.cells) {
        const id = key(pos);
        if (seen.has(id)) continue;
        seen.add(id);
        cells.push(pos);
      }
    }
    shapes.push({ kind: shapeRuns[0].kind, runs: shapeRuns, cells });
  }
  return shapes;
}

function contains(cells: Pos[], pos: Pos): boolean {
  return cells.some((cell) => cell.r === pos.r && cell.c === pos.c);
}

function intersection(shape: Shape): Pos {
  const horizontal = new Set<string>();
  for (const run of shape.runs) {
    if (run.axis !== "h") continue;
    for (const pos of run.cells) horizontal.add(key(pos));
  }
  for (const run of shape.runs) {
    if (run.axis !== "v") continue;
    for (const pos of run.cells) {
      if (horizontal.has(key(pos))) return pos;
    }
  }
  return shape.cells[0];
}

function specialForShape(shape: Shape, focus: Pos | null): Spawn | null {
  const horizontal = shape.runs.some((run) => run.axis === "h");
  const vertical = shape.runs.some((run) => run.axis === "v");
  const longest = shape.runs.reduce((max, run) => Math.max(max, run.cells.length), 0);
  let special: Special | null = null;
  if (horizontal && vertical && shape.cells.length >= 5) special = "wrapped";
  else if (longest >= 5) special = "bomb";
  else if (longest >= 4) {
    const run = shape.runs.find((item) => item.cells.length >= 4);
    if (!run) return null;
    special = run.axis === "h" ? "row" : "col";
  }
  if (!special) return null;
  let pos: Pos;
  if (focus && contains(shape.cells, focus)) pos = focus;
  else if (special === "wrapped") pos = intersection(shape);
  else {
    const run = [...shape.runs].sort((a, b) => b.cells.length - a.cells.length)[0];
    pos = run.cells[Math.floor(run.cells.length / 2)];
  }
  return { pos, special, kind: shape.kind };
}

function cellsForSpecial(special: Special, pos: Pos): Pos[] {
  const cells: Pos[] = [];
  if (special === "row") {
    for (let c = 0; c < COLS; c++) cells.push({ r: pos.r, c });
  } else if (special === "col") {
    for (let r = 0; r < ROWS; r++) cells.push({ r, c: pos.c });
  } else if (special === "wrapped") {
    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const r = pos.r + dr;
        const c = pos.c + dc;
        if (r < 0 || c < 0 || r >= ROWS || c >= COLS) continue;
        cells.push({ r, c });
      }
    }
  }
  return cells;
}

function expandSpecials(board: Board, clear: Set<string>): void {
  const activated = new Set<string>();
  let pending = true;
  while (pending) {
    pending = false;
    for (const id of [...clear]) {
      if (activated.has(id)) continue;
      activated.add(id);
      const pos = parseKey(id);
      const gem = board[pos.r][pos.c];
      if (!gem || gem.special === "none" || gem.special === "bomb") continue;
      for (const extra of cellsForSpecial(gem.special, pos)) {
        const extraId = key(extra);
        if (clear.has(extraId)) continue;
        clear.add(extraId);
        pending = true;
      }
    }
  }
}

function addKind(board: Board, kind: number, clear: Set<string>): void {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const gem = board[r][c];
      if (gem && gem.kind === kind) clear.add(key({ r, c }));
    }
  }
}

function collectMatches(board: Board, focus: Pos | null): { clear: Set<string>; spawns: Spawn[] } | null {
  const runs = findRuns(board);
  if (runs.length === 0) return null;
  const clear = new Set<string>();
  const spawns = new Map<string, Spawn>();
  for (const shape of groupRuns(runs)) {
    for (const pos of shape.cells) clear.add(key(pos));
    const spawn = specialForShape(shape, focus);
    if (!spawn) continue;
    const id = key(spawn.pos);
    const previous = spawns.get(id);
    if (!previous || SPECIAL_RANK[spawn.special] > SPECIAL_RANK[previous.special]) {
      spawns.set(id, spawn);
    }
  }
  expandSpecials(board, clear);
  return { clear, spawns: [...spawns.values()] };
}

function collapse(board: Board, rng: Rng): { board: Board; falls: FallMove[]; births: Birth[] } {
  const next = emptyBoard();
  const falls: FallMove[] = [];
  const births: Birth[] = [];
  for (let c = 0; c < COLS; c++) {
    const stack: { gem: Gem; from: Pos }[] = [];
    for (let r = ROWS - 1; r >= 0; r--) {
      const gem = board[r][c];
      if (gem) stack.push({ gem, from: { r, c } });
    }
    let write = ROWS - 1;
    for (const item of stack) {
      next[write][c] = item.gem;
      if (item.from.r !== write) {
        falls.push({ id: item.gem.id, from: item.from, to: { r: write, c } });
      }
      write -= 1;
    }
    let fromRow = -1;
    while (write >= 0) {
      const gem = makeGem(rng.int(KIND_COUNT));
      next[write][c] = gem;
      births.push({ gem, to: { r: write, c }, fromRow });
      fromRow -= 1;
      write -= 1;
    }
  }
  return { board: next, falls, births };
}

function commit(
  board: Board,
  clear: Set<string>,
  spawns: Spawn[],
  rng: Rng,
  steps: CascadeStep[],
): Board {
  const cleared = [...clear].map(parseKey);
  const next = cloneBoard(board);
  for (const pos of cleared) next[pos.r][pos.c] = null;
  const spawned: Spawned[] = [];
  for (const spawn of spawns) {
    if (!clear.has(key(spawn.pos))) continue;
    const gem = makeGem(spawn.kind, spawn.special);
    next[spawn.pos.r][spawn.pos.c] = gem;
    spawned.push({ pos: spawn.pos, gem });
  }
  const fallen = collapse(next, rng);
  steps.push({
    clear: { cleared, spawned },
    falls: fallen.falls,
    births: fallen.births,
    clearedCount: cleared.length,
  });
  return fallen.board;
}

function swapGems(board: Board, a: Pos, b: Pos): Board {
  const next = cloneBoard(board);
  const tmp = next[a.r][a.c];
  next[a.r][a.c] = next[b.r][b.c];
  next[b.r][b.c] = tmp;
  return next;
}

export function isLegalSwap(board: Board, a: Pos, b: Pos): boolean {
  if (!adjacent(a, b)) return false;
  const from = board[a.r][a.c];
  const to = board[b.r][b.c];
  if (!from || !to) return false;
  if (from.special === "bomb" || to.special === "bomb") return true;
  return findRuns(swapGems(board, a, b)).length > 0;
}

export function hasAnyMove(board: Board): boolean {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (c + 1 < COLS && isLegalSwap(board, { r, c }, { r, c: c + 1 })) return true;
      if (r + 1 < ROWS && isLegalSwap(board, { r, c }, { r: r + 1, c })) return true;
    }
  }
  return false;
}

function fillBoard(rng: Rng): Board {
  const board = emptyBoard();
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const banned = new Set<number>();
      if (c >= 2) {
        const left = board[r][c - 1];
        const further = board[r][c - 2];
        if (left && further && left.kind === further.kind) banned.add(left.kind);
      }
      if (r >= 2) {
        const up = board[r - 1][c];
        const further = board[r - 2][c];
        if (up && further && up.kind === further.kind) banned.add(up.kind);
      }
      const choices: number[] = [];
      for (let kind = 0; kind < KIND_COUNT; kind++) {
        if (!banned.has(kind)) choices.push(kind);
      }
      const kind = choices.length > 0 ? choices[rng.int(choices.length)] : rng.int(KIND_COUNT);
      board[r][c] = makeGem(kind);
    }
  }
  return board;
}

export function createBoard(rng: Rng): Board {
  for (let attempt = 0; attempt < 40; attempt++) {
    const board = fillBoard(rng);
    if (!hasMatch(board) && hasAnyMove(board)) return board;
  }
  return fillBoard(rng);
}

function placeAll(gems: Gem[]): Board {
  const board = emptyBoard();
  let index = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      board[r][c] = gems[index];
      index += 1;
    }
  }
  return board;
}

export function shuffleUntilPlayable(board: Board, rng: Rng): Board {
  const gems = board.flat().filter((gem): gem is Gem => gem !== null);
  if (gems.length !== ROWS * COLS) return createBoard(rng);
  for (let attempt = 0; attempt < 80; attempt++) {
    const bag = gems.map((gem) => ({ ...gem }));
    for (let i = bag.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      const tmp = bag[i];
      bag[i] = bag[j];
      bag[j] = tmp;
    }
    const next = placeAll(bag);
    if (!hasMatch(next) && hasAnyMove(next)) return next;
  }
  return createBoard(rng);
}

function detonate(board: Board, bombPos: Pos, victimPos: Pos): Set<string> {
  const clear = new Set<string>();
  const victim = board[victimPos.r][victimPos.c];
  const bomb = board[bombPos.r][bombPos.c];
  if (victim) addKind(board, victim.kind, clear);
  if (bomb?.special === "bomb" && victim?.special === "bomb") addKind(board, bomb.kind, clear);
  clear.add(key(bombPos));
  clear.add(key(victimPos));
  expandSpecials(board, clear);
  return clear;
}

export function settle(board: Board, rng: Rng, focus: Pos | null = null): TurnResult {
  let current = board;
  const steps: CascadeStep[] = [];
  for (let guard = 0; guard < 40; guard++) {
    const matched = collectMatches(current, focus);
    focus = null;
    if (!matched) break;
    current = commit(current, matched.clear, matched.spawns, rng, steps);
  }
  let shuffled = false;
  if (!hasAnyMove(current)) {
    current = shuffleUntilPlayable(current, rng);
    shuffled = true;
  }
  return { valid: true, board: current, steps, shuffled };
}

export function playSwap(board: Board, from: Pos, to: Pos, rng: Rng): TurnResult {
  if (!isLegalSwap(board, from, to)) {
    return { valid: false, board, steps: [], shuffled: false };
  }
  const moving = board[from.r][from.c];
  const other = board[to.r][to.c];
  if (!moving || !other) {
    return { valid: false, board, steps: [], shuffled: false };
  }
  let current = swapGems(board, from, to);
  const steps: CascadeStep[] = [];
  let focus: Pos | null = to;
  if (moving.special === "bomb" || other.special === "bomb") {
    const bombPos = moving.special === "bomb" ? to : from;
    const victimPos = moving.special === "bomb" ? from : to;
    current = commit(current, detonate(current, bombPos, victimPos), [], rng, steps);
    focus = null;
  }
  const settled = settle(current, rng, focus);
  return {
    valid: true,
    board: settled.board,
    steps: [...steps, ...settled.steps],
    shuffled: settled.shuffled,
  };
}
