// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Matrix4, Plane, XYZ } from "@chili3d/core";

export type Vec3 = { x: number; y: number; z: number };

export const VEC3_SCHEMA = {
    type: "object",
    properties: {
        x: { type: "number" },
        y: { type: "number" },
        z: { type: "number" },
    },
    required: ["x", "y", "z"],
};

function asVec3(value: unknown, label: string): Vec3 | string {
    if (typeof value !== "object" || value === null) return `${label} must be an object {x, y, z}`;
    const { x, y, z } = value as Record<string, unknown>;
    if (![x, y, z].every((n) => typeof n === "number" && Number.isFinite(n))) {
        return `${label} must have finite numeric x, y, z`;
    }
    return { x: x as number, y: y as number, z: z as number };
}

type MatrixStep = (matrix: Matrix4, value: unknown) => Matrix4 | string;

function applyMirror(matrix: Matrix4, mirror: unknown): Matrix4 | string {
    const args = mirror as Record<string, unknown>;
    const origin = asVec3(args?.["origin"], "mirror.origin");
    if (typeof origin === "string") return origin;
    const normal = asVec3(args?.["normal"], "mirror.normal");
    if (typeof normal === "string") return normal;
    const n = new XYZ(normal).normalize();
    if (n === undefined) return "mirror.normal must be a non-zero vector";
    const xvec = Math.abs(n.x) < 0.9 ? XYZ.unitX : XYZ.unitY;
    return matrix.multiply(
        Matrix4.createMirrorWithPlane(new Plane({ origin: new XYZ(origin), normal: n, xvec })),
    );
}

function applyScale(matrix: Matrix4, scale: unknown): Matrix4 | string {
    let vec: Vec3;
    if (typeof scale === "number") {
        vec = { x: scale, y: scale, z: scale };
    } else {
        const parsed = asVec3(scale, "scale");
        if (typeof parsed === "string") return parsed;
        vec = parsed;
    }
    if (![vec.x, vec.y, vec.z].every((n) => Number.isFinite(n) && n !== 0)) {
        return "scale must be finite and non-zero";
    }
    return matrix.multiply(Matrix4.fromScale(vec.x, vec.y, vec.z));
}

function applyRotate(matrix: Matrix4, rotate: unknown): Matrix4 | string {
    const args = rotate as Record<string, unknown>;
    const axis = asVec3(args?.["axis"], "rotate.axis");
    if (typeof axis === "string") return axis;
    const angle = args?.["angle"];
    if (typeof angle !== "number" || !Number.isFinite(angle)) {
        return "rotate.angle must be a finite number in degrees";
    }
    if (new XYZ(axis).normalize() === undefined) return "rotate.axis must be a non-zero vector";
    let center: Vec3 = { x: 0, y: 0, z: 0 };
    if (args["center"] !== undefined) {
        const parsed = asVec3(args["center"], "rotate.center");
        if (typeof parsed === "string") return parsed;
        center = parsed;
    }
    return matrix.multiply(Matrix4.fromAxisRad(center, axis, (angle * Math.PI) / 180));
}

function applyTranslate(matrix: Matrix4, translate: unknown): Matrix4 | string {
    const vec = asVec3(translate, "translate");
    if (typeof vec === "string") return vec;
    return matrix.multiply(Matrix4.fromTranslation(vec.x, vec.y, vec.z));
}

/**
 * Compose a Matrix4 from the shared transform encoding used by transform_node and the
 * transformedMul op: any of translate/rotate/scale/mirror, composed in
 * mirror → scale → rotate → translate order. Returns an error string on invalid input.
 */
export function buildTransformMatrix(args: Record<string, unknown>): Matrix4 | string {
    const steps: [string, MatrixStep][] = [
        ["mirror", applyMirror],
        ["scale", applyScale],
        ["rotate", applyRotate],
        ["translate", applyTranslate],
    ];

    let matrix = Matrix4.identity();
    let hasOp = false;
    for (const [key, step] of steps) {
        if (args[key] === undefined) continue;
        const result = step(matrix, args[key]);
        if (typeof result === "string") return result;
        matrix = result;
        hasOp = true;
    }

    if (!hasOp) return "provide at least one of translate, rotate, scale, mirror";
    return matrix;
}
