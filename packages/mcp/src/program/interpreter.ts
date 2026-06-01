// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Deep imports keep this headless-safe (the @chili3d/app barrel pulls in DOM-bound
// web components). Each of these node modules only depends on @chili3d/core.
import { BoxNode } from "@chili3d/app/src/bodys/box";
import { ConeNode } from "@chili3d/app/src/bodys/cone";
import { CylinderNode } from "@chili3d/app/src/bodys/cylinder";
import { ExtrudeNode } from "@chili3d/app/src/bodys/extrude";
import { PipeNode } from "@chili3d/app/src/bodys/pipe";
import { PyramidNode } from "@chili3d/app/src/bodys/pyramid";
import { RevolvedNode } from "@chili3d/app/src/bodys/revolve";
import { SphereNode } from "@chili3d/app/src/bodys/sphere";
import { SweepedNode } from "@chili3d/app/src/bodys/sweep";
import {
    EditableShapeNode,
    type IDocument,
    type INode,
    type IShape,
    type IShapeFactory,
    type ISubEdgeShape,
    Line,
    Matrix4,
    Plane,
    type Result,
    Transaction,
    XYZ,
} from "@chili3d/core";
import type { Op, Program, Vec3 } from "./schema";

interface OpResult {
    shape: IShape;
    node?: INode;
}

function toXYZ(v: Vec3 | undefined, fallback: XYZ = XYZ.zero): XYZ {
    return v ? new XYZ({ x: v.x, y: v.y, z: v.z }) : fallback;
}

function unwrap<T>(result: Result<T>, context: string): T {
    if (!result.isOk) {
        throw new Error(`${context} failed: ${result.error}`);
    }
    return result.value;
}

/** Wrap a baked (non-parametric) shape — boolean/transform results — as a node. */
function bakeNode(document: IDocument, name: string, shape: IShape): OpResult {
    return { node: new EditableShapeNode({ document, name, shape }), shape };
}

/** A mirror plane from a normal + origin; derives a valid in-plane x axis. */
function mirrorPlane(normal: XYZ, origin: XYZ): Plane {
    const reference = Math.abs(normal.z) > 0.9 ? XYZ.unitX : XYZ.unitZ;
    return new Plane({ origin, normal, xvec: normal.cross(reference) });
}

/** Indices of every edge of a shape (from the lazily-built mesh) — for fillet/chamfer. */
function allEdgeIndices(shape: IShape): number[] {
    return (shape.mesh.edges?.range ?? []).map((range) => (range.shape as ISubEdgeShape).index);
}

/** Ids whose output shape is consumed as input by a later op (so not a standalone node). */
export function collectConsumed(ops: Op[]): Set<string> {
    const consumed = new Set<string>();
    for (const op of ops) {
        if (op.op === "extrude") consumed.add(op.section.ref);
        else if (op.op === "revolve") consumed.add(op.profile.ref);
        else if (op.op === "boolean") {
            consumed.add(op.a.ref);
            consumed.add(op.b.ref);
        } else if (op.op === "sweep") {
            consumed.add(op.profile.ref);
            consumed.add(op.path.ref);
        } else if (op.op === "pipe") {
            consumed.add(op.path.ref);
        } else if (op.op === "move" || op.op === "rotate" || op.op === "mirror" || op.op === "array") {
            consumed.add(op.input.ref);
        } else if (op.op === "to_face" || op.op === "shell" || op.op === "fillet" || op.op === "chamfer") {
            consumed.add(op.input.ref);
        } else if (op.op === "loft") {
            for (const section of op.sections) consumed.add(section.ref);
        }
    }
    return consumed;
}

function resolve(idMap: Map<string, OpResult>, ref: { ref: string }, context: string): IShape {
    const result = idMap.get(ref.ref);
    if (!result) {
        throw new Error(`${context}: unknown ref "${ref.ref}" (must reference an earlier op id)`);
    }
    return result.shape;
}

function buildOp(
    document: IDocument,
    factory: IShapeFactory,
    op: Op,
    idMap: Map<string, OpResult>,
): OpResult {
    switch (op.op) {
        case "box": {
            const node = new BoxNode({
                document,
                plane: Plane.XY.translateTo(toXYZ(op.at)),
                dx: op.dx,
                dy: op.dy,
                dz: op.dz,
            });
            return { node, shape: unwrap(node.shape, "box") };
        }
        case "sphere": {
            const node = new SphereNode({ document, center: toXYZ(op.at), radius: op.radius });
            return { node, shape: unwrap(node.shape, "sphere") };
        }
        case "cylinder": {
            const node = new CylinderNode({
                document,
                normal: toXYZ(op.axis, XYZ.unitZ),
                center: toXYZ(op.at),
                radius: op.radius,
                dz: op.height,
            });
            return { node, shape: unwrap(node.shape, "cylinder") };
        }
        case "cone": {
            const node = new ConeNode({
                document,
                normal: toXYZ(op.axis, XYZ.unitZ),
                center: toXYZ(op.at),
                radius: op.radius,
                dz: op.height,
            });
            return { node, shape: unwrap(node.shape, "cone") };
        }
        case "pyramid": {
            const node = new PyramidNode({
                document,
                plane: Plane.XY.translateTo(toXYZ(op.at)),
                dx: op.dx,
                dy: op.dy,
                dz: op.dz,
            });
            return { node, shape: unwrap(node.shape, "pyramid") };
        }
        case "rect": {
            const plane = Plane.XY.translateTo(toXYZ(op.at));
            return { shape: unwrap(factory.rect(plane, op.dx, op.dy), "rect") };
        }
        case "circle": {
            const edge = unwrap(factory.circle(XYZ.unitZ, toXYZ(op.at), op.radius), "circle");
            const wire = unwrap(factory.wire([edge]), "circle wire");
            return { shape: unwrap(factory.face([wire]), "circle face") };
        }
        case "polygon": {
            const wire = unwrap(factory.polygon(op.points.map((p) => toXYZ(p))), "polygon");
            return { shape: unwrap(factory.face([wire]), "polygon face") };
        }
        case "extrude": {
            const section = resolve(idMap, op.section, "extrude");
            const node = new ExtrudeNode({ document, section, length: op.length });
            return { node, shape: unwrap(node.shape, "extrude") };
        }
        case "revolve": {
            const profile = resolve(idMap, op.profile, "revolve");
            const axis = new Line({
                point: toXYZ(op.axisOrigin),
                direction: toXYZ(op.axisDirection, XYZ.unitZ),
            });
            const node = new RevolvedNode({ document, profile, axis, angle: op.angle ?? 360 });
            return { node, shape: unwrap(node.shape, "revolve") };
        }
        case "boolean": {
            const a = resolve(idMap, op.a, "boolean.a");
            const b = resolve(idMap, op.b, "boolean.b");
            const result =
                op.kind === "fuse"
                    ? factory.booleanFuse([a], [b], false)
                    : op.kind === "cut"
                      ? factory.booleanCut([a], [b])
                      : factory.booleanCommon([a], [b]);
            const shape = unwrap(result, `boolean ${op.kind}`);
            // Booleans bake their inputs — the result is a non-parametric EditableShapeNode.
            const node = new EditableShapeNode({ document, name: `boolean_${op.kind}`, shape });
            return { node, shape };
        }
        case "line": {
            return { shape: unwrap(factory.line(toXYZ(op.start), toXYZ(op.end)), "line") };
        }
        case "arc": {
            const edge = factory.arc(
                toXYZ(op.normal, XYZ.unitZ),
                toXYZ(op.center),
                toXYZ(op.start),
                op.angle,
            );
            return { shape: unwrap(edge, "arc") };
        }
        case "polyline": {
            const points = op.points.map((p) => toXYZ(p));
            const edges: IShape[] = [];
            for (let i = 0; i < points.length - 1; i++) {
                edges.push(unwrap(factory.line(points[i], points[i + 1]), "polyline segment"));
            }
            if (op.closed && points.length > 2) {
                edges.push(unwrap(factory.line(points[points.length - 1], points[0]), "polyline close"));
            }
            return { shape: unwrap(factory.wire(edges as never), "polyline wire") };
        }
        case "sweep": {
            const profile = resolve(idMap, op.profile, "sweep.profile");
            const path = resolve(idMap, op.path, "sweep.path");
            const node = new SweepedNode({
                document,
                profile: [profile] as never,
                path: path as never,
                round: op.round ?? false,
            });
            return { node, shape: unwrap(node.shape, "sweep") };
        }
        case "pipe": {
            const path = resolve(idMap, op.path, "pipe.path");
            const node = new PipeNode({
                document,
                radius: op.radius,
                path: path as never,
                thickness: op.thickness,
            });
            return { node, shape: unwrap(node.shape, "pipe") };
        }
        case "move": {
            const input = resolve(idMap, op.input, "move.input");
            const matrix = Matrix4.fromTranslation(op.dx ?? 0, op.dy ?? 0, op.dz ?? 0);
            return bakeNode(document, "move", input.transformedMul(matrix));
        }
        case "rotate": {
            const input = resolve(idMap, op.input, "rotate.input");
            const matrix = Matrix4.fromAxisRad(
                toXYZ(op.center),
                toXYZ(op.axis, XYZ.unitZ),
                (op.angle * Math.PI) / 180,
            );
            return bakeNode(document, "rotate", input.transformedMul(matrix));
        }
        case "mirror": {
            const input = resolve(idMap, op.input, "mirror.input");
            const plane = mirrorPlane(toXYZ(op.planeNormal, XYZ.unitZ), toXYZ(op.planeOrigin));
            return bakeNode(document, "mirror", input.transformedMul(Matrix4.createMirrorWithPlane(plane)));
        }
        case "array": {
            const input = resolve(idMap, op.input, "array.input");
            const count = op.count ?? 3;
            const copies: IShape[] = [];
            if (op.mode === "circular") {
                const center = toXYZ(op.center);
                const axis = toXYZ(op.axis, XYZ.unitZ);
                const step = ((op.angle ?? 360) * Math.PI) / 180 / count;
                for (let i = 0; i < count; i++) {
                    copies.push(input.transformedMul(Matrix4.fromAxisRad(center, axis, step * i)));
                }
            } else {
                const spacing = toXYZ(op.spacing, new XYZ({ x: 10, y: 0, z: 0 }));
                for (let i = 0; i < count; i++) {
                    copies.push(
                        input.transformedMul(
                            Matrix4.fromTranslation(spacing.x * i, spacing.y * i, spacing.z * i),
                        ),
                    );
                }
            }
            const combined = unwrap(factory.combine(copies), "array combine");
            return bakeNode(document, `array_${op.mode}`, combined);
        }
        case "to_face": {
            const wire = resolve(idMap, op.input, "to_face");
            return { shape: unwrap(factory.face([wire] as never), "to_face") };
        }
        case "shell": {
            const input = resolve(idMap, op.input, "shell");
            // Hollow the solid: makeThickSolidByJoin offsets the walls inward/outward.
            // (makeThickSolidBySimple thickens a single face, which is a different op.)
            const hollow = factory.makeThickSolidByJoin(input, [], op.thickness);
            return bakeNode(document, "shell", unwrap(hollow, "shell"));
        }
        case "loft": {
            const sections = op.sections.map((ref, i) => resolve(idMap, ref, `loft.sections[${i}]`));
            const shape = unwrap(
                factory.loft(
                    sections as never,
                    op.isSolid ?? true,
                    op.isRuled ?? false,
                    (op.continuity ?? "g1") as never,
                ),
                "loft",
            );
            return bakeNode(document, "loft", shape);
        }
        case "fillet": {
            const input = resolve(idMap, op.input, "fillet.input");
            const edges = allEdgeIndices(input);
            if (edges.length === 0) throw new Error("fillet: shape has no edges");
            return bakeNode(document, "fillet", unwrap(factory.fillet(input, edges, op.radius), "fillet"));
        }
        case "chamfer": {
            const input = resolve(idMap, op.input, "chamfer.input");
            const edges = allEdgeIndices(input);
            if (edges.length === 0) throw new Error("chamfer: shape has no edges");
            return bakeNode(
                document,
                "chamfer",
                unwrap(factory.chamfer(input, edges, op.distance), "chamfer"),
            );
        }
    }
}

export interface RunResult {
    /** Op ids that became standalone document nodes (terminal results). */
    addedNodeIds: string[];
}

/**
 * Execute a CAD program against a document, building a parametric node tree. Ops
 * run in order; `{ ref }` inputs resolve to the output shape of an earlier op.
 * Consumed shapes (extrude sections, boolean inputs) do not become standalone
 * nodes — only terminal results are added, so the document matches intent.
 */
export function runProgram(document: IDocument, program: Program): RunResult {
    const factory = document.application.shapeFactory;
    const idMap = new Map<string, OpResult>();
    const consumed = collectConsumed(program.ops);
    const addedNodeIds: string[] = [];

    Transaction.execute(document, "run cad program", () => {
        for (const op of program.ops) {
            if (idMap.has(op.id)) {
                throw new Error(`duplicate op id "${op.id}"`);
            }
            const result = buildOp(document, factory, op, idMap);
            idMap.set(op.id, result);
            if (result.node && !consumed.has(op.id)) {
                document.modelManager.addNode(result.node);
                addedNodeIds.push(op.id);
            }
        }
    });

    return { addedNodeIds };
}
