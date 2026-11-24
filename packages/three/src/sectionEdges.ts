// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IShape, Matrix4, XYZ } from "@chili3d/core";
import { type BufferGeometry, type Mesh, type Plane, Vector3 } from "three";
import { ThreeHelper } from "./threeHelper";

const EPSILON = 1e-7;
const KEY_PRECISION = 1e5;

function distanceKey(point: Vector3): string {
    return `${Math.round(point.x * KEY_PRECISION)},${Math.round(point.y * KEY_PRECISION)},${Math.round(
        point.z * KEY_PRECISION,
    )}`;
}

function segmentKey(a: Vector3, b: Vector3): string {
    const first = distanceKey(a);
    const second = distanceKey(b);
    return first < second ? `${first}|${second}` : `${second}|${first}`;
}

function pushUnique(points: Vector3[], point: Vector3): void {
    if (!points.some((existing) => existing.distanceToSquared(point) < EPSILON * EPSILON)) {
        points.push(point.clone());
    }
}

function addTriangleIntersections(triangle: Vector3[], distances: number[], points: Vector3[]): void {
    if (distances.every((distance) => Math.abs(distance) <= EPSILON)) return;
    for (let i = 0; i < 3; i++) {
        const next = (i + 1) % 3;
        const startDistance = distances[i];
        const endDistance = distances[next];
        if (Math.abs(startDistance) <= EPSILON) pushUnique(points, triangle[i]);
        const crosses =
            (startDistance < -EPSILON && endDistance > EPSILON) ||
            (startDistance > EPSILON && endDistance < -EPSILON);
        if (!crosses) continue;
        const amount = startDistance / (startDistance - endDistance);
        pushUnique(points, triangle[i].clone().lerp(triangle[next], amount));
    }
}

function farthestPair(points: Vector3[]): [Vector3, Vector3] | undefined {
    if (points.length < 2) return undefined;
    let result: [Vector3, Vector3] = [points[0], points[1]];
    let longest = result[0].distanceToSquared(result[1]);
    for (let i = 0; i < points.length - 1; i++) {
        for (let j = i + 1; j < points.length; j++) {
            const distance = points[i].distanceToSquared(points[j]);
            if (distance > longest) {
                longest = distance;
                result = [points[i], points[j]];
            }
        }
    }
    return result;
}

function triangleIndexes(geometry: BufferGeometry, triangle: number): [number, number, number] {
    if (geometry.index) {
        return [
            geometry.index.getX(triangle * 3),
            geometry.index.getX(triangle * 3 + 1),
            geometry.index.getX(triangle * 3 + 2),
        ];
    }
    return [triangle * 3, triangle * 3 + 1, triangle * 3 + 2];
}

class VisibleCenter {
    private readonly sum = new Vector3();
    private count = 0;

    constructor(private readonly planes: Plane[]) {}

    add(point: Vector3): void {
        if (this.planes.some((plane) => plane.distanceToPoint(point) < 0)) return;
        this.sum.add(point);
        this.count++;
    }

    addSegment(start: Vector3, end: Vector3): void {
        for (const plane of this.planes) {
            const startDistance = plane.distanceToPoint(start);
            const endDistance = plane.distanceToPoint(end);
            if (startDistance * endDistance < 0) {
                this.add(start.clone().lerp(end, startDistance / (startDistance - endDistance)));
            }
        }
    }

    value(): XYZ | undefined {
        return this.count > 0 ? ThreeHelper.toXYZ(this.sum.multiplyScalar(1 / this.count)) : undefined;
    }
}

function meshPoint(position: Float32Array, index: number, transform: Matrix4): Vector3 {
    return ThreeHelper.fromXYZ(
        transform.ofPoint({ x: position[index * 3], y: position[index * 3 + 1], z: position[index * 3 + 2] }),
    );
}

function addVisiblePositions(center: VisibleCenter, position: Float32Array, transform: Matrix4): void {
    for (let i = 0; i < position.length / 3; i++) center.add(meshPoint(position, i, transform));
}

export function visibleShapeCenter(shape: IShape, transform: Matrix4, planes: Plane[]): XYZ | undefined {
    const center = new VisibleCenter(planes);
    const { faces, edges, vertexs } = shape.mesh;
    if (vertexs) addVisiblePositions(center, vertexs.position, transform);
    if (edges) {
        addVisiblePositions(center, edges.position, transform);
        for (let i = 0; i < edges.position.length / 3; i += 2) {
            center.addSegment(
                meshPoint(edges.position, i, transform),
                meshPoint(edges.position, i + 1, transform),
            );
        }
    }
    if (faces) {
        addVisiblePositions(center, faces.position, transform);
        const index = (i: number) => (faces.index.length > 0 ? faces.index[i] : i);
        const indexCount = faces.index.length > 0 ? faces.index.length : faces.position.length / 3;
        for (let i = 0; i < indexCount; i += 3) {
            const triangle = [index(i), index(i + 1), index(i + 2)].map((at) =>
                meshPoint(faces.position, at, transform),
            );
            for (let edge = 0; edge < 3; edge++) center.addSegment(triangle[edge], triangle[(edge + 1) % 3]);
        }
    }
    return center.value();
}

export function coplanarFacePositions(meshes: Mesh[], plane: Plane, tolerance = 1e-4): Float32Array {
    const positions: number[] = [];
    for (const mesh of meshes) {
        const position = mesh.geometry.attributes["position"];
        if (!position) continue;
        const triangleCount = (mesh.geometry.index?.count ?? position.count) / 3;
        for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex++) {
            const indexes = triangleIndexes(mesh.geometry, triangleIndex);
            const triangle = indexes.map((index) =>
                new Vector3().fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld),
            );
            const coplanar = triangle.every((point) => Math.abs(plane.distanceToPoint(point)) <= tolerance);
            if (coplanar) positions.push(...triangle.flatMap((point) => point.toArray()));
        }
    }
    return new Float32Array(positions);
}

/** World-space segments where a mesh's triangles cross the section plane. */
export function sectionEdgePositions(meshes: Mesh[], plane: Plane, normalOffset = 0): Float32Array {
    const positions: number[] = [];
    const added = new Set<string>();
    const offset = plane.normal.clone().multiplyScalar(normalOffset);

    for (const mesh of meshes) {
        const position = mesh.geometry.attributes["position"];
        if (!position) continue;
        const triangleCount = (mesh.geometry.index?.count ?? position.count) / 3;
        for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex++) {
            const indexes = triangleIndexes(mesh.geometry, triangleIndex);
            const triangle = indexes.map((index) =>
                new Vector3().fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld),
            );
            const distances = triangle.map((point) => plane.distanceToPoint(point));
            const intersections: Vector3[] = [];
            addTriangleIntersections(triangle, distances, intersections);
            const pair = farthestPair(intersections);
            if (!pair || pair[0].distanceToSquared(pair[1]) < EPSILON * EPSILON) continue;
            const key = segmentKey(pair[0], pair[1]);
            if (added.has(key)) continue;
            added.add(key);
            positions.push(...pair[0].add(offset).toArray(), ...pair[1].add(offset).toArray());
        }
    }
    return new Float32Array(positions);
}
