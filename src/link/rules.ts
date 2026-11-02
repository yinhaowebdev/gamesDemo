export interface Cell {
  x: number;
  y: number;
  z: number;
}

export interface Tile {
  id: number;
  kind: number;
}

export interface Board {
  width: number;
  depth: number;
  layers: number;
  cells: (Tile | null)[][][];
}

export interface LayerSize {
  width: number;
  depth: number;
}

export interface LevelDef {
  width: number;
  depth: number;
  layers: LayerSize[];
  seconds: number;
}

export interface SpawnPose {
  id: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
}

export interface TrayTile {
  id: number;
  kind: number;
}

export interface TrayResult {
  slots: TrayTile[];
  cleared: TrayTile[];
  full: boolean;
}

export interface Rng {
  int(max: number): number;
}

export const TRAY_LIMIT = 7;
export const CUBE = 0.9;
export const GAP = 1;

const TABLE_PAD = 0.45;
const STACK_COLS = 5;
const STACK_ROWS = 4;
const STACK_GAP = 0.95;

export const KIND_COUNT = 12;

const PROP_SPAN: { minY: number; maxY: number }[] = [
  { minY: -0.26, maxY: 0.46 },
  { minY: -0.1, maxY: 0.1 },
  { minY: -0.22, maxY: 0.07 },
  { minY: -0.22, maxY: 0.24 },
  { minY: -0.25, maxY: 0.29 },
  { minY: -0.28, maxY: 0.36 },
  { minY: -0.2, maxY: 0.2 },
  { minY: -0.08, maxY: 0.1 },
  { minY: -0.08, maxY: 0.08 },
  { minY: -0.31, maxY: 0.51 },
  { minY: -0.07, maxY: 0.07 },
  { minY: -0.17, maxY: 0.17 },
];

export function propSpan(kind: number): { minY: number; maxY: number } {
  return PROP_SPAN[((kind % KIND_COUNT) + KIND_COUNT) % KIND_COUNT] ?? { minY: -0.2, maxY: 0.2 };
}

export const LEVELS: LevelDef[] = [
  {
    width: 12,
    depth: 8,
    layers: [
      { width: 12, depth: 8 },
      { width: 10, depth: 6 },
      { width: 10, depth: 3 },
      { width: 6, depth: 3 },
    ],
    seconds: 510,
  },
  {
    width: 12,
    depth: 10,
    layers: [
      { width: 12, depth: 10 },
      { width: 9, depth: 9 },
      { width: 8, depth: 6 },
      { width: 6, depth: 4 },
    ],
    seconds: 640,
  },
  {
    width: 16,
    depth: 12,
    layers: [
      { width: 16, depth: 12 },
      { width: 12, depth: 10 },
      { width: 10, depth: 6 },
      { width: 6, depth: 4 },
    ],
    seconds: 840,
  },
  {
    width: 16,
    depth: 14,
    layers: [
      { width: 16, depth: 14 },
      { width: 14, depth: 10 },
      { width: 10, depth: 8 },
      { width: 6, depth: 5 },
    ],
    seconds: 1000,
  },
];

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

export function emptyBoard(width: number, depth: number, layers: number): Board {
  return {
    width,
    depth,
    layers,
    cells: Array.from({ length: layers }, () =>
      Array.from({ length: depth }, () => Array.from({ length: width }, () => null)),
    ),
  };
}

export function listTiles(board: Board): { cell: Cell; tile: Tile }[] {
  const tiles: { cell: Cell; tile: Tile }[] = [];
  for (let y = 0; y < board.layers; y++) {
    for (let z = 0; z < board.depth; z++) {
      for (let x = 0; x < board.width; x++) {
        const tile = board.cells[y]?.[z]?.[x];
        if (tile) tiles.push({ cell: { x, y, z }, tile });
      }
    }
  }
  return tiles;
}

export function tableHalf(width: number, depth: number): { halfW: number; halfD: number } {
  return {
    halfW: ((width - 1) / 2) * GAP + CUBE / 2 + TABLE_PAD,
    halfD: ((depth - 1) / 2) * GAP + CUBE / 2 + TABLE_PAD,
  };
}

export function removeTile(board: Board, id: number): Tile | null {
  for (const entry of listTiles(board)) {
    if (entry.tile.id !== id) continue;
    board.cells[entry.cell.y][entry.cell.z][entry.cell.x] = null;
    return entry.tile;
  }
  return null;
}

function unit(rng: Rng): number {
  return rng.int(1_000_000) / 1_000_000;
}

export function scatterPoses(board: Board, rng: Rng): SpawnPose[] {
  const tiles = listTiles(board);
  const perLayer = STACK_COLS * STACK_ROWS;
  const order = tiles.map((_, index) => index);
  shuffle(order, rng);
  const columnTop = new Map<string, number>();
  return order.map((slot, index) => {
    const tile = tiles[slot];
    if (!tile) throw new Error("方块出生表越界");
    const place = index % perLayer;
    const col = place % STACK_COLS;
    const row = Math.floor(place / STACK_COLS);
    const key = `${col},${row}`;
    const span = propSpan(tile.tile.kind);
    const surface = columnTop.get(key) ?? 0;
    const y = surface - span.minY;
    columnTop.set(key, y + span.maxY);
    return {
      id: tile.tile.id,
      x: (col - (STACK_COLS - 1) / 2) * STACK_GAP,
      z: (row - (STACK_ROWS - 1) / 2) * STACK_GAP,
      y,
      yaw: unit(rng) * Math.PI * 2,
      pitch: 0,
      roll: 0,
    };
  });
}

export function placeInTray(slots: readonly TrayTile[], tile: TrayTile): TrayResult {
  const next = slots.slice();
  let insertAt = next.length;
  for (let i = next.length - 1; i >= 0; i--) {
    if (next[i]?.kind === tile.kind) {
      insertAt = i + 1;
      break;
    }
  }
  next.splice(insertAt, 0, tile);
  const cleared: TrayTile[] = [];
  const kept: TrayTile[] = [];
  let index = 0;
  while (index < next.length) {
    const kind = next[index]?.kind;
    let end = index + 1;
    while (end < next.length && next[end]?.kind === kind) end += 1;
    const run = next.slice(index, end);
    if (run.length >= 3) {
      cleared.push(...run.slice(0, 3));
      kept.push(...run.slice(3));
    } else {
      kept.push(...run);
    }
    index = end;
  }
  return { slots: kept, cleared, full: kept.length >= TRAY_LIMIT };
}

export function maskCells(level: LevelDef): Cell[] {
  const cells: Cell[] = [];
  level.layers.forEach((layer, y) => {
    const originX = Math.floor((level.width - layer.width) / 2);
    const originZ = Math.floor((level.depth - layer.depth) / 2);
    for (let z = 0; z < layer.depth; z++) {
      for (let x = 0; x < layer.width; x++) {
        cells.push({ x: originX + x, y, z: originZ + z });
      }
    }
  });
  return cells;
}

function shuffle<T>(items: T[], rng: Rng): void {
  for (let i = items.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const tmp = items[i];
    items[i] = items[j] as T;
    items[j] = tmp as T;
  }
}

function makeTiles(count: number): Tile[] {
  const triples = Math.floor(count / 3);
  const base = Math.floor(triples / KIND_COUNT);
  let extra = triples % KIND_COUNT;
  const tiles: Tile[] = [];
  let id = 1;
  for (let kind = 0; kind < KIND_COUNT; kind++) {
    const groups = base + (extra > 0 ? 1 : 0);
    if (extra > 0) extra -= 1;
    for (let n = 0; n < groups * 3; n++) tiles.push({ id: id++, kind });
  }
  return tiles;
}

export function createLevel(level: LevelDef, rng: Rng): Board {
  const board = emptyBoard(level.width, level.depth, level.layers.length);
  const cells = maskCells(level);
  const tiles = makeTiles(cells.length);
  shuffle(cells, rng);
  for (let i = 0; i < tiles.length; i++) {
    const cell = cells[i];
    const tile = tiles[i];
    if (!cell || !tile) continue;
    board.cells[cell.y][cell.z][cell.x] = tile;
  }
  return board;
}
