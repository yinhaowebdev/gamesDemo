import { describe, expect, it } from "vitest";
import {
  CUBE,
  LEVELS,
  TRAY_LIMIT,
  createLevel,
  listTiles,
  maskCells,
  mulberry32,
  placeInTray,
  scatterPoses,
  tableHalf,
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
      for (const amount of kinds.values()) expect(amount).toBe(3);
    }
  });

  it("scatters cubes onto the table at different angles", () => {
    for (const level of LEVELS) {
      const dealt = createLevel(level, mulberry32(4));
      const poses = scatterPoses(dealt, mulberry32(8));
      expect(poses).toHaveLength(listTiles(dealt).length);
      const yaws = new Set(poses.map((pose) => pose.yaw));
      expect(yaws.size).toBeGreaterThan(1);
      const pitches = poses.map((pose) => pose.pitch);
      expect(Math.max(...pitches) - Math.min(...pitches)).toBeGreaterThan(0.2);
      const heights = [...new Set(poses.map((pose) => pose.y))].sort((a, b) => a - b);
      for (let i = 1; i < heights.length; i++) {
        const lower = heights[i - 1] ?? 0;
        const upper = heights[i] ?? 0;
        expect(upper - lower).toBeGreaterThan(CUBE);
      }
      const { halfW, halfD } = tableHalf(dealt.width, dealt.depth);
      for (let i = 0; i < poses.length; i++) {
        const pose = poses[i];
        if (!pose) continue;
        expect(Math.abs(pose.x)).toBeLessThanOrEqual(halfW - CUBE / 2);
        expect(Math.abs(pose.z)).toBeLessThanOrEqual(halfD - CUBE / 2);
        for (let j = i + 1; j < poses.length; j++) {
          const other = poses[j];
          if (!other || pose.y !== other.y) continue;
          expect(Math.hypot(pose.x - other.x, pose.z - other.z)).toBeGreaterThan(CUBE);
        }
      }
    }
  });
});
