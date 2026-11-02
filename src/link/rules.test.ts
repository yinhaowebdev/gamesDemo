import { describe, expect, it } from "vitest";
import {
  KIND_COUNT,
  LEVELS,
  TRAY_LIMIT,
  createLevel,
  listTiles,
  maskCells,
  mulberry32,
  placeInTray,
  propSpan,
  scatterPoses,
} from "./rules.ts";

describe("cube pile", () => {
  it("clears three of a kind from the tray", () => {
    let slots = placeInTray([], { id: 1, kind: 1 }).slots;
    slots = placeInTray(slots, { id: 2, kind: 2 }).slots;
    slots = placeInTray(slots, { id: 3, kind: 1 }).slots;
    const cleared = placeInTray(slots, { id: 4, kind: 1 });
    expect(cleared.cleared.map((tile) => tile.id)).toEqual([1, 3, 4]);
    expect(cleared.slots).toEqual([{ id: 2, kind: 2 }]);
    expect(cleared.full).toBe(false);
  });

  it("fails when the seventh tile does not complete a triple", () => {
    let slots: { id: number; kind: number }[] = [];
    for (let i = 0; i < TRAY_LIMIT - 1; i++) {
      slots = placeInTray(slots, { id: i + 1, kind: i }).slots;
    }
    const last = placeInTray(slots, { id: TRAY_LIMIT, kind: 99 });
    expect(last.cleared).toEqual([]);
    expect(last.slots).toHaveLength(TRAY_LIMIT);
    expect(last.full).toBe(true);
  });

  it("deals each level in groups of three", () => {
    for (const level of LEVELS) {
      const count = maskCells(level).length;
      expect(count % 3).toBe(0);
      const dealt = createLevel(level, mulberry32(3));
      const tiles = listTiles(dealt);
      expect(tiles).toHaveLength(count);
      const kinds = new Map<number, number>();
      for (const entry of tiles) kinds.set(entry.tile.kind, (kinds.get(entry.tile.kind) ?? 0) + 1);
      expect(kinds.size).toBe(KIND_COUNT);
      for (const amount of kinds.values()) {
        expect(amount % 3).toBe(0);
        expect(amount).toBeGreaterThanOrEqual(15);
      }
    }
  });

  it("stacks every tile tightly on a small footprint", () => {
    for (const level of LEVELS) {
      const dealt = createLevel(level, mulberry32(4));
      const tiles = listTiles(dealt);
      const poses = scatterPoses(dealt, mulberry32(8));
      expect(poses).toHaveLength(tiles.length);
      const kindOf = new Map(tiles.map((entry) => [entry.tile.id, entry.tile.kind]));
      const columns = new Map<string, typeof poses>();
      for (const pose of poses) {
        expect(Math.abs(pose.x)).toBeLessThan(3);
        expect(Math.abs(pose.z)).toBeLessThan(2.2);
        expect(pose.pitch).toBe(0);
        expect(pose.roll).toBe(0);
        const key = `${pose.x},${pose.z}`;
        const column = columns.get(key) ?? [];
        column.push(pose);
        columns.set(key, column);
      }
      expect(columns.size).toBe(20);
      for (const column of columns.values()) {
        expect(column.length).toBeGreaterThan(8);
        let top = 0;
        for (const pose of column.slice().sort((a, b) => a.y - b.y)) {
          const span = propSpan(kindOf.get(pose.id) ?? 0);
          expect(pose.y + span.minY).toBeCloseTo(top, 5);
          top = pose.y + span.maxY;
        }
      }
    }
  });
});
