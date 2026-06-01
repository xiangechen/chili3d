// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { z } from "zod";

// A 3D point/vector.
export const Vec3 = z.object({ x: z.number(), y: z.number(), z: z.number() });

// A reference to the output shape of a previous op (by its id).
export const ShapeRef = z.object({ ref: z.string().min(1) });

const id = z.string().min(1).describe("unique id of this op; referenced by later ops");

// --- Primitives: become editable parametric nodes (BoxNode, SphereNode, ...) ---
const boxOp = z.object({
    op: z.literal("box"),
    id,
    dx: z.number().positive(),
    dy: z.number().positive(),
    dz: z.number().positive(),
    at: Vec3.optional(),
});
const sphereOp = z.object({
    op: z.literal("sphere"),
    id,
    radius: z.number().positive(),
    at: Vec3.optional(),
});
const cylinderOp = z.object({
    op: z.literal("cylinder"),
    id,
    radius: z.number().positive(),
    height: z.number().positive(),
    at: Vec3.optional(),
    axis: Vec3.optional(),
});
const coneOp = z.object({
    op: z.literal("cone"),
    id,
    radius: z.number().positive(),
    height: z.number().positive(),
    at: Vec3.optional(),
    axis: Vec3.optional(),
});
const pyramidOp = z.object({
    op: z.literal("pyramid"),
    id,
    dx: z.number().positive(),
    dy: z.number().positive(),
    dz: z.number().positive(),
    at: Vec3.optional(),
});

// --- Sketches: construction faces consumed by extrude/revolve (no standalone node unless terminal) ---
const rectOp = z.object({
    op: z.literal("rect"),
    id,
    dx: z.number().positive(),
    dy: z.number().positive(),
    at: Vec3.optional(),
});
const circleOp = z.object({
    op: z.literal("circle"),
    id,
    radius: z.number().positive(),
    at: Vec3.optional(),
});
const polygonOp = z.object({ op: z.literal("polygon"), id, points: z.array(Vec3).min(3) });

// --- Operations ---
const extrudeOp = z.object({ op: z.literal("extrude"), id, section: ShapeRef, length: z.number() });
const revolveOp = z.object({
    op: z.literal("revolve"),
    id,
    profile: ShapeRef,
    angle: z.number().default(360),
    axisOrigin: Vec3.optional(),
    axisDirection: Vec3.optional(),
});
const booleanOp = z.object({
    op: z.literal("boolean"),
    id,
    kind: z.enum(["fuse", "cut", "common"]),
    a: ShapeRef,
    b: ShapeRef,
});

// --- Curves / wires: edges & wires usable as sweep/pipe paths or profiles ---
const lineOp = z.object({ op: z.literal("line"), id, start: Vec3, end: Vec3 });
const arcOp = z.object({
    op: z.literal("arc"),
    id,
    center: Vec3,
    start: Vec3,
    angle: z.number(),
    normal: Vec3.optional(),
});
const polylineOp = z.object({
    op: z.literal("polyline"),
    id,
    points: z.array(Vec3).min(2),
    closed: z.boolean().default(false),
});

// --- Create from a path/profile ---
const sweepOp = z.object({
    op: z.literal("sweep"),
    id,
    profile: ShapeRef,
    path: ShapeRef,
    round: z.boolean().default(false),
});
const pipeOp = z.object({
    op: z.literal("pipe"),
    id,
    path: ShapeRef,
    radius: z.number().positive(),
    thickness: z.number().optional(),
});

// --- Transforms: bake a matrix into a new shape (so it chains into boolean/export) ---
const moveOp = z.object({
    op: z.literal("move"),
    id,
    input: ShapeRef,
    dx: z.number().default(0),
    dy: z.number().default(0),
    dz: z.number().default(0),
});
const rotateOp = z.object({
    op: z.literal("rotate"),
    id,
    input: ShapeRef,
    angle: z.number().describe("degrees"),
    axis: Vec3.optional(),
    center: Vec3.optional(),
});
const mirrorOp = z.object({
    op: z.literal("mirror"),
    id,
    input: ShapeRef,
    planeNormal: Vec3,
    planeOrigin: Vec3.optional(),
});
const arrayOp = z.object({
    op: z.literal("array"),
    id,
    input: ShapeRef,
    mode: z.enum(["linear", "circular"]).default("linear"),
    count: z.number().int().min(2).default(3),
    spacing: Vec3.optional(), // linear
    center: Vec3.optional(), // circular
    axis: Vec3.optional(), // circular
    angle: z.number().default(360), // circular, total degrees
});

// --- More create/convert ops ---
const loftOp = z.object({
    op: z.literal("loft"),
    id,
    sections: z.array(ShapeRef).min(2).describe("2+ wire/edge sections (e.g. closed polylines)"),
    isSolid: z.boolean().default(true),
    isRuled: z.boolean().default(false),
    continuity: z.enum(["c0", "g1", "c1", "g2", "c2", "c3", "cn"]).default("g1"),
});
// Make a planar face from a wire (e.g. a polyline/line/arc loop) — usable as an
// extrude/revolve section so arbitrary 2D profiles (with arcs) become solids.
const toFaceOp = z.object({ op: z.literal("to_face"), id, input: ShapeRef });
// Hollow a solid to a thin shell of the given wall thickness (negative = inward).
const shellOp = z.object({ op: z.literal("shell"), id, input: ShapeRef, thickness: z.number() });
// Round / bevel ALL edges of a solid by a radius/distance (no manual edge picking).
const filletOp = z.object({ op: z.literal("fillet"), id, input: ShapeRef, radius: z.number().positive() });
const chamferOp = z.object({
    op: z.literal("chamfer"),
    id,
    input: ShapeRef,
    distance: z.number().positive(),
});

export const OpSchema = z.discriminatedUnion("op", [
    boxOp,
    sphereOp,
    cylinderOp,
    coneOp,
    pyramidOp,
    rectOp,
    circleOp,
    polygonOp,
    lineOp,
    arcOp,
    polylineOp,
    extrudeOp,
    revolveOp,
    booleanOp,
    sweepOp,
    pipeOp,
    moveOp,
    rotateOp,
    mirrorOp,
    arrayOp,
    loftOp,
    toFaceOp,
    shellOp,
    filletOp,
    chamferOp,
]);

export const ProgramSchema = z.object({
    ops: z.array(OpSchema).min(1),
});

export type Op = z.infer<typeof OpSchema>;
export type Program = z.infer<typeof ProgramSchema>;
export type Vec3 = z.infer<typeof Vec3>;
