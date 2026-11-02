import { paintCharacter } from "../art/characters.ts";

const COLORS = ["#ff5d8f", "#ffd166", "#7bdff2", "#c8f7a0"];

export function paintFace(canvas: HTMLCanvasElement, kind: number): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const color = COLORS[Math.floor(kind / 6) % COLORS.length] ?? COLORS[0];
  paintCharacter(ctx, kind, color ?? "#fff", canvas.width);
}
