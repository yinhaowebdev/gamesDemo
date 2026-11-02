import { ConvexHull, type Face, type VertexNode } from "three/addons/math/ConvexHull.js";
import { Vector3 } from "three";

export interface Polyhedron {
  vertices: { x: number; y: number; z: number }[];
  faces: number[][];
}

export function convexPolyhedron(points: readonly { x: number; y: number; z: number }[]): Polyhedron {
  const hull = new ConvexHull().setFromPoints(points.map((point) => new Vector3(point.x, point.y, point.z)));
  const index = new Map<VertexNode, number>();
  const vertices = hull.vertices.map((node, i) => {
    index.set(node, i);
    return { x: node.point.x, y: node.point.y, z: node.point.z };
  });
  const triangles = hull.faces.flatMap((face) => {
    const loop = faceLoop(face, index);
    if (loop.length !== 3) return [];
    const [a, b, c] = loop;
    if (a === undefined || b === undefined || c === undefined) return [];
    return [{ verts: [a, b, c] as [number, number, number], normal: face.normal.clone() }];
  });
  return { vertices, faces: mergeCoplanar(triangles, vertices) };
}

function faceLoop(face: Face, index: Map<VertexNode, number>): number[] {
  const loop: number[] = [];
  let edge = face.edge;
  const start = edge;
  do {
    const id = index.get(edge.vertex);
    if (id === undefined) return [];
    loop.push(id);
    edge = edge.next;
  } while (edge !== start);
  return loop;
}

function mergeCoplanar(
  triangles: { verts: [number, number, number]; normal: Vector3 }[],
  vertices: { x: number; y: number; z: number }[],
): number[][] {
  const parent = triangles.map((_, i) => i);
  const find = (i: number): number => {
    let at = i;
    while (parent[at] !== at) {
      const next = parent[at];
      if (next === undefined) break;
      parent[at] = parent[next] ?? next;
      at = parent[at] ?? at;
    }
    return at;
  };
  const shared = new Map<string, number>();
  const consider = (a: number, b: number, tri: number): void => {
    const key = a < b ? `${a}:${b}` : `${b}:${a}`;
    const other = shared.get(key);
    if (other === undefined) {
      shared.set(key, tri);
      return;
    }
    const left = triangles[tri];
    const right = triangles[other];
    if (!left || !right || left.normal.dot(right.normal) <= 0.999) return;
    const ra = find(tri);
    const rb = find(other);
    if (ra !== rb) parent[rb] = ra;
  };
  triangles.forEach((tri, i) => {
    consider(tri.verts[0], tri.verts[1], i);
    consider(tri.verts[1], tri.verts[2], i);
    consider(tri.verts[2], tri.verts[0], i);
  });

  const groups = new Map<number, number[]>();
  triangles.forEach((_, i) => {
    const root = find(i);
    const list = groups.get(root) ?? [];
    list.push(i);
    groups.set(root, list);
  });

  const faces: number[][] = [];
  for (const ids of groups.values()) {
    const directed = new Map<string, [number, number]>();
    for (const id of ids) {
      const verts = triangles[id]?.verts;
      if (!verts) continue;
      for (let edge = 0; edge < 3; edge++) {
        const a = verts[edge];
        const b = verts[(edge + 1) % 3];
        if (a === undefined || b === undefined) continue;
        const reverse = `${b}:${a}`;
        if (directed.has(reverse)) directed.delete(reverse);
        else directed.set(`${a}:${b}`, [a, b]);
      }
    }
    const next = new Map<number, number>();
    for (const [a, b] of directed.values()) next.set(a, b);
    const start = next.keys().next().value;
    if (start === undefined) continue;
    const loop: number[] = [];
    let cursor = start;
    do {
      loop.push(cursor);
      const step = next.get(cursor);
      if (step === undefined) break;
      cursor = step;
    } while (cursor !== start && loop.length <= next.size);
    if (loop.length >= 3 && cursor === start) {
      const turned = startAtCorner(loop, vertices);
      if (turned) faces.push(turned);
    }
  }
  return faces;
}

function startAtCorner(loop: number[], vertices: { x: number; y: number; z: number }[]): number[] | null {
  const count = loop.length;
  for (let i = 0; i < count; i++) {
    const a = vertices[loop[i] ?? -1];
    const b = vertices[loop[(i + 1) % count] ?? -1];
    const c = vertices[loop[(i + 2) % count] ?? -1];
    if (!a || !b || !c) continue;
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abz = b.z - a.z;
    const bcx = c.x - b.x;
    const bcy = c.y - b.y;
    const bcz = c.z - b.z;
    const cx = aby * bcz - abz * bcy;
    const cy = abz * bcx - abx * bcz;
    const cz = abx * bcy - aby * bcx;
    if (cx * cx + cy * cy + cz * cz > 1e-10) return loop.slice(i).concat(loop.slice(0, i));
  }
  return null;
}
