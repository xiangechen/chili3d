// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IEdge, type IFace, type IShape, Precision, Result, ShapeTypes } from "@chili3d/core";
import type { SketchNode } from "../sketch/sketchNode";

/**
 * Closed planar profiles of a sketch as faces — one face per connected closed loop.
 * Sketch entities are combined into a compound (they may be disjoint), so edges are
 * first grouped by endpoint connectivity; the wire factory chains each group in place.
 */
export function sketchFaces(sketch: SketchNode): Result<IFace[]> {
    const shape = sketch.shape;
    if (!shape.isOk) return Result.err(shape.error);

    const edges = collectEdges(shape.value);
    if (edges.length === 0) return Result.err("Sketch has no entities");

    const faces: IFace[] = [];
    for (const group of groupConnected(edges)) {
        const wire = shapeFactory.wire(group);
        if (!wire.isOk) return Result.err(wire.error);
        if (!wire.value.isClosed()) return Result.err("Sketch profile is not closed");
        const face = wire.value.toFace();
        if (!face.isOk) return Result.err(face.error);
        faces.push(face.value);
    }
    return Result.ok(faces);
}

/**
 * Applies a profile operation to every closed face of the sketch and combines the
 * results — shared by profile features (extrude, revolve).
 */
export function sketchShapeEach(sketch: SketchNode, op: (face: IFace) => Result<IShape>): Result<IShape> {
    const faces = sketchFaces(sketch);
    if (!faces.isOk) return Result.err(faces.error);

    const shapes: IShape[] = [];
    for (const face of faces.value) {
        const shape = op(face);
        if (!shape.isOk) return Result.err(shape.error);
        shapes.push(shape.value);
    }
    return shapes.length === 1 ? Result.ok(shapes[0]) : shapeFactory.combine(shapes);
}

function collectEdges(shape: IShape): IEdge[] {
    if (shape.shapeType === ShapeTypes.edge) return [shape as IEdge];
    return shape.findSubShapes(ShapeTypes.edge) as IEdge[];
}

function groupConnected(edges: IEdge[]): IEdge[][] {
    const remaining = [...edges];
    const groups: IEdge[][] = [];
    while (remaining.length > 0) {
        const group = [remaining.pop()!];
        let grew = true;
        while (grew) {
            grew = false;
            for (let i = remaining.length - 1; i >= 0; i--) {
                if (touches(group, remaining[i])) {
                    group.push(remaining.splice(i, 1)[0]);
                    grew = true;
                }
            }
        }
        groups.push(group);
    }
    return groups;
}

function touches(group: IEdge[], edge: IEdge): boolean {
    return group.some((x) => endpoints(x).some((a) => endpoints(edge).some((b) => coincides(a, b))));
}

function endpoints(edge: IEdge) {
    return [edge.startPoint(), edge.endPoint()];
}

function coincides(a: ReturnType<IEdge["startPoint"]>, b: ReturnType<IEdge["startPoint"]>): boolean {
    return a.distanceTo(b) < Precision.Distance;
}
