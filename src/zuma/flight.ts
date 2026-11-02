import Matter, { type Body } from "matter-js";
import type { Side } from "./rules.ts";

const BASE_MS = 1000 / 60;

export interface TrackBall {
  key: string;
  x: number;
  y: number;
  radius: number;
}

export interface FlightHit {
  key: string;
  nx: number;
  ny: number;
}

export interface Flight {
  sync(balls: readonly TrackBall[]): void;
  launch(x: number, y: number, vx: number, vy: number, radius: number): void;
  position(): { x: number; y: number } | null;
  step(dt: number): void;
  takeHit(): FlightHit | null;
  pull(x: number, y: number): void;
  clearShot(): void;
  clear(): void;
}

/** 法线从被撞的球指向飞球，切线指向轨道终点。点积为正就插到前面。 */
export function sideFromContact(tx: number, ty: number, nx: number, ny: number): Side {
  return tx * nx + ty * ny >= 0 ? "before" : "after";
}

export function createFlight(): Flight {
  const engine = Matter.Engine.create({
    enableSleeping: false,
    gravity: { x: 0, y: 0, scale: 0 },
  });
  const tracks = new Map<string, Body>();
  let shot: Body | null = null;
  let pending: FlightHit | null = null;
  let pullTo: { x: number; y: number } | null = null;

  Matter.Events.on(engine, "collisionStart", (event) => {
    if (!shot || pending) return;
    for (const pair of event.pairs) {
      const other = pair.bodyA === shot ? pair.bodyB : pair.bodyB === shot ? pair.bodyA : null;
      if (!other || other.label === "shot") continue;
      const dx = shot.position.x - other.position.x;
      const dy = shot.position.y - other.position.y;
      let nx = pair.collision.normal.x;
      let ny = pair.collision.normal.y;
      if (nx * dx + ny * dy < 0) {
        nx = -nx;
        ny = -ny;
      }
      pending = { key: other.label, nx, ny };
      Matter.Body.setVelocity(shot, { x: 0, y: 0 });
      return;
    }
  });

  function remove(body: Body): void {
    Matter.Composite.remove(engine.world, body);
  }

  function clearShot(): void {
    pullTo = null;
    pending = null;
    if (!shot) return;
    remove(shot);
    shot = null;
  }

  function clearTracks(): void {
    for (const body of tracks.values()) remove(body);
    tracks.clear();
  }

  return {
    sync(balls) {
      const seen = new Set<string>();
      for (const ball of balls) {
        seen.add(ball.key);
        const existing = tracks.get(ball.key);
        if (existing && Math.abs((existing.circleRadius ?? 0) - ball.radius) <= 1) {
          Matter.Body.setPosition(existing, { x: ball.x, y: ball.y });
          continue;
        }
        if (existing) {
          remove(existing);
          tracks.delete(ball.key);
        }
        const body = Matter.Bodies.circle(ball.x, ball.y, ball.radius, {
          isStatic: true,
          label: ball.key,
          restitution: 0,
          friction: 0,
        });
        Matter.Composite.add(engine.world, body);
        tracks.set(ball.key, body);
      }
      for (const [key, body] of tracks) {
        if (seen.has(key)) continue;
        remove(body);
        tracks.delete(key);
      }
    },
    launch(x, y, vx, vy, radius) {
      clearShot();
      shot = Matter.Bodies.circle(x, y, radius, {
        label: "shot",
        restitution: 0,
        friction: 0,
        frictionAir: 0,
      });
      Matter.Body.setVelocity(shot, { x: vx / 60, y: vy / 60 });
      Matter.Composite.add(engine.world, shot);
    },
    position() {
      if (!shot) return null;
      return { x: shot.position.x, y: shot.position.y };
    },
    step(dt) {
      let left = Math.min(Math.max(dt, 0), 0.05);
      while (left > 0.0001) {
        const slice = Math.min(left, 1 / 60);
        if (shot && pullTo) {
          const dx = pullTo.x - shot.position.x;
          const dy = pullTo.y - shot.position.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 0.5) {
            Matter.Body.setPosition(shot, pullTo);
            Matter.Body.setVelocity(shot, { x: 0, y: 0 });
          } else {
            const move = Math.min(dist, 2200 * slice);
            const scale = BASE_MS / Math.max(slice * 1000, 1);
            Matter.Body.setVelocity(shot, {
              x: (dx / dist) * move * scale,
              y: (dy / dist) * move * scale,
            });
          }
        }
        Matter.Engine.update(engine, slice * 1000);
        left -= slice;
      }
    },
    takeHit() {
      const found = pending;
      if (!found) return null;
      pending = null;
      clearTracks();
      return found;
    },
    pull(x, y) {
      pullTo = { x, y };
    },
    clearShot,
    clear() {
      clearShot();
      clearTracks();
    },
  };
}
