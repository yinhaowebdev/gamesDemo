import { Body, Box, ConvexPolyhedron, Vec3, World } from "cannon-es";
import * as THREE from "three";
import { describe, expect, it, vi } from "vitest";
import { convexPolyhedron } from "./hull.ts";
import { samplePoints } from "./scene.ts";

function shapeFrom(points: { x: number; y: number; z: number }[]): ConvexPolyhedron {
  const data = convexPolyhedron(points);
  const errors: unknown[][] = [];
  const spy = vi.spyOn(console, "error").mockImplementation((...args) => {
    errors.push(args);
  });
  const shape = new ConvexPolyhedron({
    vertices: data.vertices.map((point) => new Vec3(point.x, point.y, point.z)),
    faces: data.faces,
  });
  spy.mockRestore();
  expect(errors, JSON.stringify(errors)).toEqual([]);
  expect(data.faces.length).toBeGreaterThan(3);
  expect(shape.volume()).toBeGreaterThan(0);
  return shape;
}

function corners(hx: number, hy: number, hz: number): { x: number; y: number; z: number }[] {
  const points = [];
  for (const x of [-hx, hx]) {
    for (const y of [-hy, hy]) {
      for (const z of [-hz, hz]) points.push({ x, y, z });
    }
  }
  return points;
}

function toy(which: number): THREE.Group {
  const group = new THREE.Group();
  const material = new THREE.MeshBasicMaterial();
  const add = (geo: THREE.BufferGeometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sy = 1): void => {
    const mesh = new THREE.Mesh(geo, material);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rx, ry, rz);
    mesh.scale.y = sy;
    group.add(mesh);
  };
  if (which === 0) {
    add(new THREE.BoxGeometry(0.42, 0.36, 0.3), 0, -0.08, 0);
    add(new THREE.SphereGeometry(0.22, 8, 6), 0, 0.24, 0);
  } else if (which === 1) {
    add(new THREE.BoxGeometry(0.78, 0.2, 0.58));
  } else if (which === 2) {
    add(new THREE.BoxGeometry(0.84, 0.12, 0.34), 0, -0.16, 0);
    add(new THREE.BoxGeometry(0.46, 0.18, 0.3), 0, -0.02, -0.04);
    add(new THREE.SphereGeometry(0.15, 8, 6), 0, -0.08, 0.16, 0, 0, 0, 0.65);
  } else if (which === 3) {
    add(new THREE.BoxGeometry(0.78, 0.2, 0.36));
    add(new THREE.BoxGeometry(0.34, 0.16, 0.28), 0, 0.16, -0.02);
    for (const x of [-0.26, 0.26]) {
      for (const z of [-0.12, 0.12]) add(new THREE.CylinderGeometry(0.1, 0.1, 0.08, 8), x, -0.12, z, 0, 0, Math.PI / 2);
    }
  } else {
    add(new THREE.CylinderGeometry(0.26, 0.3, 0.14, 8), 0, -0.18, 0);
    add(new THREE.CylinderGeometry(0.1, 0.16, 0.2, 8));
    add(new THREE.SphereGeometry(0.13, 8, 6), 0, 0.16, 0);
    add(new THREE.CircleGeometry(0.16, 8), 0, 0.28, 0, -Math.PI / 2);
  }
  return group;
}

describe("prop hulls", () => {
  it("builds every toy without an inward face", () => {
    for (let which = 0; which < 5; which++) {
      shapeFrom(samplePoints(toy(which)));
    }
  });

  it("builds a cube whose faces point outward", () => {
    const shape = shapeFrom(corners(0.4, 0.4, 0.4));
    expect(shape.faces).toHaveLength(6);
  });

  it("builds a head-and-body hull and lets it rest", () => {
    const points = [...corners(0.21, 0.18, 0.15).map((point) => ({ ...point, y: point.y - 0.08 }))];
    const radius = 0.22;
    points.push({ x: 0, y: 0.24 + radius, z: 0 }, { x: 0, y: 0.24 - radius, z: 0 });
    for (let ring = 1; ring <= 3; ring++) {
      const phi = (Math.PI * ring) / 4;
      for (let step = 0; step < 8; step++) {
        const theta = (Math.PI * step) / 4;
        points.push({
          x: radius * Math.sin(phi) * Math.cos(theta),
          y: 0.24 + radius * Math.cos(phi),
          z: radius * Math.sin(phi) * Math.sin(theta),
        });
      }
    }
    const shape = shapeFrom(points);
    const world = new World({ gravity: new Vec3(0, -18, 0) });
    world.addBody(new Body({ mass: 0, shape: new Box(new Vec3(2, 0.25, 2)), position: new Vec3(0, -0.25, 0) }));
    const body = new Body({ mass: 1, shape, position: new Vec3(0.2, 1, 0.1) });
    body.quaternion.setFromEuler(0.4, 0.8, 0.2, "YXZ");
    world.addBody(body);
    for (let i = 0; i < 240; i++) world.step(1 / 60);
    expect(Number.isFinite(body.position.y)).toBe(true);
    expect(body.position.y).toBeGreaterThan(0);
    expect(body.position.y).toBeLessThan(0.7);
    expect(body.velocity.length()).toBeLessThan(0.3);
  });

  it("builds a thin tile and lets it rest on a table", () => {
    const shape = shapeFrom(corners(0.39, 0.1, 0.29));
    const world = new World({ gravity: new Vec3(0, -18, 0) });
    const table = new Body({ mass: 0, shape: new Box(new Vec3(2, 0.25, 2)), position: new Vec3(0, -0.25, 0) });
    const body = new Body({ mass: 1, shape, position: new Vec3(0, 0.8, 0) });
    world.addBody(table);
    world.addBody(body);
    for (let i = 0; i < 180; i++) world.step(1 / 60);
    expect(body.position.y).toBeGreaterThan(0.05);
    expect(body.position.y).toBeLessThan(0.45);
    expect(body.velocity.length()).toBeLessThan(0.2);
  });
});
