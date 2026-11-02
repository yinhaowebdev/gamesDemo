import { describe, expect, it } from "vitest";
import {
  type Board,
  createBoard,
  findRuns,
  hasAnyMove,
  hasMatch,
  makeGem,
  mulberry32,
  playSwap,
  resetIds,
  settle,
} from "./board.ts";

function quiet(): Board {
  resetIds();
  const board: Board = [];
  for (let r = 0; r < 8; r++) {
    const row = [];
    for (let c = 0; c < 8; c++) {
      row.push(makeGem((c % 2) + (r % 2) * 2));
    }
    board.push(row);
  }
  return board;
}

describe("board", () => {
  it("finds a horizontal three-match", () => {
    const board = quiet();
    board[4][2] = makeGem(4);
    board[4][3] = makeGem(4);
    board[4][4] = makeGem(4);
    const runs = findRuns(board);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.axis).toBe("h");
    expect(runs[0]?.cells).toHaveLength(3);
  });

  it("rejects a swap that creates no match", () => {
    const board = quiet();
    const result = playSwap(board, { r: 0, c: 0 }, { r: 0, c: 1 }, mulberry32(1));
    expect(result.valid).toBe(false);
    expect(result.steps).toHaveLength(0);
    expect(result.board).toBe(board);
  });

  it("turns a four-match into a row stripe at the swap focus", () => {
    const board = quiet();
    board[4][0] = makeGem(4);
    board[4][1] = makeGem(4);
    board[4][2] = makeGem(4);
    board[4][3] = makeGem(4);
    const result = settle(board, mulberry32(2), { r: 4, c: 1 });
    const spawned = result.steps[0]?.clear.spawned ?? [];
    expect(spawned).toHaveLength(1);
    expect(spawned[0]?.gem.special).toBe("row");
    expect(spawned[0]?.pos).toEqual({ r: 4, c: 1 });
  });

  it("turns a straight five into a color bomb", () => {
    const board = quiet();
    for (let c = 0; c < 5; c++) board[3][c] = makeGem(5);
    const result = settle(board, mulberry32(3), { r: 3, c: 2 });
    expect(result.steps[0]?.clear.spawned[0]?.gem.special).toBe("bomb");
  });

  it("turns an L of five into a wrapped gem", () => {
    const board = quiet();
    for (const [r, c] of [
      [4, 2],
      [4, 3],
      [4, 4],
      [5, 2],
      [6, 2],
    ] as const) {
      board[r][c] = makeGem(4);
    }
    const result = settle(board, mulberry32(4), null);
    const spawned = result.steps[0]?.clear.spawned[0];
    expect(spawned?.gem.special).toBe("wrapped");
    expect(spawned?.pos).toEqual({ r: 4, c: 2 });
  });

  it("drops gems and resolves the cascade they create", () => {
    const board = quiet();
    const column = [4, 5, 5, 5, 4, 4, 5, 5];
    for (let r = 0; r < column.length; r++) board[r][2] = makeGem(column[r]);
    expect(findRuns(board)).toHaveLength(1);
    const result = settle(board, mulberry32(5), null);
    expect(result.steps[0]?.clearedCount).toBe(3);
    expect(result.steps[0]?.births).toHaveLength(3);
    expect(result.steps.length).toBeGreaterThanOrEqual(2);
  });

  it("clears a full row when a row stripe is part of a match", () => {
    const board = quiet();
    board[2][0] = makeGem(4, "row");
    board[2][1] = makeGem(4);
    board[2][2] = makeGem(4);
    const result = settle(board, mulberry32(9), null);
    const cleared = result.steps[0]?.clear.cleared ?? [];
    expect(cleared.filter((pos) => pos.r === 2)).toHaveLength(8);
  });

  it("clears the swapped color when a color bomb is swapped", () => {
    const board = quiet();
    board[3][3] = makeGem(0, "bomb");
    board[3][4] = makeGem(4);
    board[0][0] = makeGem(4);
    board[6][6] = makeGem(4);
    const result = playSwap(board, { r: 3, c: 3 }, { r: 3, c: 4 }, mulberry32(8));
    expect(result.valid).toBe(true);
    const cleared = result.steps[0]?.clear.cleared ?? [];
    expect(cleared).toEqual(expect.arrayContaining([
      { r: 0, c: 0 },
      { r: 6, c: 6 },
      { r: 3, c: 3 },
      { r: 3, c: 4 },
    ]));
  });

  it("starts with no match and at least one move", () => {
    for (const seed of [1, 2, 7, 99, 12345]) {
      resetIds();
      const board = createBoard(mulberry32(seed));
      expect(hasMatch(board)).toBe(false);
      expect(hasAnyMove(board)).toBe(true);
      expect(board.flat().every((gem) => gem && gem.special === "none")).toBe(true);
    }
  });
});
