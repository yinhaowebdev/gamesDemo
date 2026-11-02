import { describe, expect, it } from "vitest";
import {
  LEVELS,
  advance,
  createLevel,
  insertBall,
  isLost,
  isWon,
  mulberry32,
  pathLength,
  resolveContacts,
} from "./rules.ts";

describe("zuma", () => {
  it("clears three of a kind after an insert", () => {
    const segments = [
      {
        head: 10,
        balls: [
          { id: 1, color: 1 },
          { id: 2, color: 1 },
          { id: 3, color: 2 },
          { id: 4, color: 2 },
        ],
      },
    ];
    const next = insertBall(segments, 0, 1, "after", { id: 9, color: 1 });
    expect(next).toEqual([{ head: 7, balls: [{ id: 3, color: 2 }, { id: 4, color: 2 }] }]);
    expect(segments[0]?.balls).toHaveLength(4);
  });

  it("clears again when a gap closes onto the same color", () => {
    const next = resolveContacts([
      {
        head: 20,
        balls: [
          { id: 1, color: 1 },
          { id: 2, color: 1 },
        ],
      },
      {
        head: 18,
        balls: [
          { id: 3, color: 1 },
          { id: 4, color: 3 },
        ],
      },
    ]);
    expect(next).toEqual([{ head: 17, balls: [{ id: 4, color: 3 }] }]);
  });

  it("pulls the whole front chain back when a gap has matching colors", () => {
    const segments = [
      { head: 30, balls: [{ id: 9, color: 2 }] },
      {
        head: 20,
        balls: [
          { id: 1, color: 1 },
          { id: 2, color: 1 },
        ],
      },
      { head: 12, balls: [{ id: 3, color: 1 }] },
    ];
    const once = advance(segments, 1, 100);
    const leader = once.segments.find((segment) => segment.balls.some((ball) => ball.id === 9));
    const middle = once.segments.find((segment) => segment.balls.some((ball) => ball.id === 1));
    expect(leader?.head).toBeLessThan(30);
    expect(middle?.head).toBeLessThan(20);
    let chain = segments;
    for (let i = 0; i < 30; i++) chain = advance(chain, 1, 100).segments;
    const colors = chain.flatMap((segment) => segment.balls.map((ball) => ball.color));
    expect(colors).not.toContain(1);
    expect(colors).toContain(2);
  });

  it("lets a different color catch up without pulling the front back", () => {
    const once = advance(
      [
        { head: 20, balls: [{ id: 1, color: 1 }] },
        { head: 10, balls: [{ id: 2, color: 2 }] },
      ],
      1,
      100,
    );
    expect(once.segments.map((segment) => segment.head)).toEqual([21, 13]);
  });

  it("loses when the front ball reaches the end", () => {
    const moved = advance([{ head: 99, balls: [{ id: 1, color: 1 }] }], 2, 100);
    expect(moved.lost).toBe(true);
    expect(moved.won).toBe(false);
    expect(isLost(moved.segments, 100)).toBe(true);
  });

  it("wins when the chain is gone", () => {
    const next = insertBall(
      [{ head: 5, balls: [{ id: 1, color: 0 }, { id: 2, color: 0 }] }],
      0,
      1,
      "after",
      { id: 3, color: 0 },
    );
    expect(next).toEqual([]);
    expect(isWon(next)).toBe(true);
    expect(advance(next, 1, pathLength(LEVELS[0]!)).won).toBe(true);
  });

  it("deals a chain without three in a row", () => {
    for (const level of LEVELS) {
      const [segment] = createLevel(level, mulberry32(5));
      expect(segment?.balls).toHaveLength(level.count);
      const balls = segment?.balls ?? [];
      for (const ball of balls) expect(ball.color).toBeGreaterThanOrEqual(0);
      for (const ball of balls) expect(ball.color).toBeLessThan(level.colors);
      for (let i = 2; i < balls.length; i++) {
        const same = balls[i]?.color === balls[i - 1]?.color && balls[i]?.color === balls[i - 2]?.color;
        expect(same).toBe(false);
      }
    }
  });
});
