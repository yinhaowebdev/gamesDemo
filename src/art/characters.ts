const INK = "#2a3358";

export function paintCharacter(
  ctx: CanvasRenderingContext2D,
  kind: number,
  color: string,
  size: number,
): void {
  const scale = size / 256;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, 256, 256);
  ctx.fillStyle = "#fff6e8";
  ctx.fillRect(0, 0, 256, 256);
  const who = ((kind % 6) + 6) % 6;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.strokeStyle = INK;
  ctx.fillStyle = color;
  if (who === 0) chick(ctx);
  else if (who === 1) cat(ctx);
  else if (who === 2) frog(ctx);
  else if (who === 3) bear(ctx);
  else if (who === 4) rabbit(ctx);
  else fox(ctx);
  eyes(ctx, who === 2 ? 78 : 132);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function head(ctx: CanvasRenderingContext2D, y: number): void {
  ctx.beginPath();
  ctx.arc(128, y, 74, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 10;
  ctx.stroke();
}

function chick(ctx: CanvasRenderingContext2D): void {
  ctx.beginPath();
  ctx.moveTo(128, 52);
  ctx.lineTo(146, 78);
  ctx.lineTo(110, 78);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  head(ctx, 138);
  ctx.fillStyle = "#ff9f1c";
  ctx.beginPath();
  ctx.moveTo(128, 142);
  ctx.lineTo(168, 154);
  ctx.lineTo(128, 166);
  ctx.closePath();
  ctx.fill();
}

function cat(ctx: CanvasRenderingContext2D): void {
  ear(ctx, 78, 78);
  ear(ctx, 178, 78);
  head(ctx, 142);
}

function frog(ctx: CanvasRenderingContext2D): void {
  bump(ctx, 86);
  bump(ctx, 170);
  head(ctx, 150);
}

function bear(ctx: CanvasRenderingContext2D): void {
  disc(ctx, 72, 86, 28);
  disc(ctx, 184, 86, 28);
  head(ctx, 146);
  ctx.fillStyle = "#fff6e8";
  ctx.beginPath();
  ctx.ellipse(128, 162, 28, 20, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(128, 158, 6, 0, Math.PI * 2);
  ctx.fill();
}

function rabbit(ctx: CanvasRenderingContext2D): void {
  longEar(ctx, 96);
  longEar(ctx, 160);
  head(ctx, 156);
}

function fox(ctx: CanvasRenderingContext2D): void {
  ear(ctx, 74, 86);
  ear(ctx, 182, 86);
  head(ctx, 146);
  ctx.fillStyle = "#fff6e8";
  ctx.beginPath();
  ctx.ellipse(128, 168, 26, 18, 0, 0, Math.PI * 2);
  ctx.fill();
}

function ear(ctx: CanvasRenderingContext2D, x: number, y: number): void {
  ctx.beginPath();
  ctx.moveTo(x, y - 36);
  ctx.lineTo(x + 26, y + 18);
  ctx.lineTo(x - 26, y + 18);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = 10;
  ctx.stroke();
}

function longEar(ctx: CanvasRenderingContext2D, x: number): void {
  ctx.beginPath();
  ctx.roundRect(x - 14, 28, 28, 78, 14);
  ctx.fill();
  ctx.lineWidth = 10;
  ctx.stroke();
}

function bump(ctx: CanvasRenderingContext2D, x: number): void {
  ctx.beginPath();
  ctx.arc(x, 78, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 10;
  ctx.stroke();
}

function disc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 10;
  ctx.stroke();
}

function eyes(ctx: CanvasRenderingContext2D, y: number): void {
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(104, y, 14, 0, Math.PI * 2);
  ctx.arc(152, y, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(108, y + 2, 7, 0, Math.PI * 2);
  ctx.arc(156, y + 2, 7, 0, Math.PI * 2);
  ctx.fill();
}
