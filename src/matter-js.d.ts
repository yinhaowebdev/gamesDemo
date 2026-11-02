declare module "matter-js" {
  export interface Vector {
    x: number;
    y: number;
  }

  export interface Body {
    label: string;
    position: Vector;
    circleRadius?: number;
  }

  export interface Engine {
    world: object;
  }

  interface CollisionPair {
    bodyA: Body;
    bodyB: Body;
    collision: { normal: Vector };
  }

  const Matter: {
    Engine: {
      create(options?: {
        gravity?: { x: number; y: number; scale?: number };
        enableSleeping?: boolean;
      }): Engine;
      update(engine: Engine, delta?: number): void;
    };
    Bodies: {
      circle(
        x: number,
        y: number,
        radius: number,
        options?: {
          isStatic?: boolean;
          label?: string;
          restitution?: number;
          friction?: number;
          frictionAir?: number;
        },
      ): Body;
    };
    Body: {
      setVelocity(body: Body, velocity: Vector): void;
      setPosition(body: Body, position: Vector): void;
    };
    Events: {
      on(
        target: Engine,
        name: "collisionStart",
        handler: (event: { pairs: CollisionPair[] }) => void,
      ): void;
    };
    Composite: {
      add(world: object, body: Body): void;
      remove(world: object, body: Body): void;
    };
  };

  export default Matter;
}
