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
const LEAN = (35 * Math.PI) / 180;
const VERTICAL = CUBE + 0.35;

export const LEVELS: LevelDef[] = [
  { width: 6, depth: 6, layers: [{ width: 6, depth: 6 }, { width: 5, depth: 3 }, { width: 3, depth: 3 }], seconds: 150 },
  { width: 8, depth: 6, layers: [{ width: 8, depth: 6 }, { width: 6, depth: 5 }, { width: 4, depth: 3 }], seconds: 210 },
  {
    width: 8,
    depth: 8,
    layers: [
      { width: 8, depth: 8 },
      { width: 6, depth: 6 },
      { width: 5, depth: 4 },
      { width: 3, depth: 2 },
    ],
    seconds: 270,
  },
  {
    width: 10,
    depth: 8,
    layers: [
      { width: 10, depth: 8 },
      { width: 7, depth: 6 },
      { width: 5, depth: 5 },
      { width: 3, depth: 3 },
    ],
    seconds: 330,
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

function signed(rng: Rng, limit: number): number {
  return (unit(rng) * 2 - 1) * limit;
}

export function scatterPoses(board: Board, rng: Rng): SpawnPose[] {
  const tiles = listTiles(board);
  const { halfW, halfD } = tableHalf(board.width, board.depth);
  const inset = CUBE / 2 + 0.04;
  const xLimit = Math.max(0, halfW - inset);
  const zLimit = Math.max(0, halfD - inset);
  const reach = CUBE * (Math.abs(Math.cos(LEAN)) + Math.abs(Math.sin(LEAN))) + 0.08;
  const cols = Math.max(1, Math.floor((xLimit * 2) / reach));
  const rows = Math.max(1, Math.floor((zLimit * 2) / reach));
  const perLayer = cols * rows;
  const order = tiles.map((_, index) => index);
  shuffle(order, rng);
  return order.map((slot, index) => {
    const tile = tiles[slot];
    if (!tile) throw new Error("方块出生表越界");
    const layer = Math.floor(index / perLayer);
    const place = index % perLayer;
    const col = place % cols;
    const row = Math.floor(place / cols);
    const x0 = -xLimit + (col + 0.5) * ((xLimit * 2) / cols);
    const z0 = -zLimit + (row + 0.5) * ((zLimit * 2) / rows);
    return {
      id: tile.tile.id,
      x: x0 + signed(rng, 0.03),
      z: z0 + signed(rng, 0.03),
      y: CUBE / 2 + 0.55 + layer * VERTICAL,
      yaw: unit(rng) * Math.PI * 2,
      pitch: signed(rng, LEAN),
      roll: signed(rng, LEAN),
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
  const tiles: Tile[] = [];
  let id = 1;
  let kind = 0;
  for (let i = 0; i < count; i += 3) {
    for (let n = 0; n < 3 && i + n < count; n++) tiles.push({ id: id++, kind });
    kind += 1;
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
