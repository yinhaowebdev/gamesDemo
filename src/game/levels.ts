export interface LevelDef {
  moves: number;
  target: number;
}

export const LEVELS: LevelDef[] = [
  { moves: 20, target: 1000 },
  { moves: 20, target: 1500 },
  { moves: 18, target: 2200 },
  { moves: 18, target: 3000 },
  { moves: 16, target: 3800 },
  { moves: 16, target: 4600 },
  { moves: 15, target: 5400 },
  { moves: 14, target: 6200 },
  { moves: 14, target: 7200 },
  { moves: 12, target: 8200 },
];

export function pointsFor(cleared: number, cascadeIndex: number): number {
  return cleared * 10 * (cascadeIndex + 1);
}
