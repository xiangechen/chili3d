// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Reproduction for "fillet/chamfer applies to the wrong edge": captures an edge
// fingerprint from a mesher-range sub-edge (what the picker returns) and re-matches
// it against a freshly rebuilt prism (what the parametric rebuild does).

import { type IEdge, type IShape, Plane, ShapeTypes, XYZ } from "@chili3d/core";
import { captureEdgeRef, matchEdgeIndexes } from "../../parametric/src/features/edgeRef";
import { createTestFactory, unwrapOk } from "./helpers";
import "./setup";

function pointOf(xyz: XYZ) {
    return [xyz.x, xyz.y, xyz.z].map((v) => Math.round(v * 1e4) / 1e4);
}

function edgeGeometry(edge: IEdge) {
    return { start: pointOf(edge.startPoint()), end: pointOf(edge.endPoint()), length: edge.length() };
}

function buildPrism(height = 5): IShape {
    const factory = createTestFactory();
    const corners: [number, number][] = [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
    ];
    const edges = corners.map((p, i) => {
        const q = corners[(i + 1) % corners.length];
        return unwrapOk(
            factory.line(new XYZ({ x: p[0], y: p[1], z: 0 }), new XYZ({ x: q[0], y: q[1], z: 0 })),
        );
    });
    const wire = unwrapOk(factory.wire(edges));
    const face = unwrapOk(wire.toFace());
    return unwrapOk(factory.prism(face, new XYZ({ x: 0, y: 0, z: height })));
}

describe("edge fingerprint matching with real OCCT shapes", () => {
    test("every picked (mesher-order) edge re-matches to the same geometry after rebuild", () => {
        const pickedFrom = buildPrism();
        const rebuilt = buildPrism();

        const picked = pickedFrom.mesh.edges!.range.map((r) => r.shape as unknown as IEdge);
        expect(picked.length).toBe(12);

        const rebuiltEdges = rebuilt.findSubShapes(ShapeTypes.edge) as (IEdge & { index?: number })[];

        for (const edge of picked) {
            const ref = captureEdgeRef(edge);
            const matched = matchEdgeIndexes(rebuilt, [ref]);
            expect(matched.isOk).toBe(true);
            const index = matched.unchecked()![0];
            expect(edgeGeometry(rebuiltEdges[index])).toEqual(edgeGeometry(edge));
        }
    });

    test("every edge re-matches after the extrude length changes", () => {
        const pickedFrom = buildPrism(5);
        const same = buildPrism(5);
        const taller = buildPrism(8);

        const picked = pickedFrom.mesh.edges!.range.map((r) => r.shape as unknown as IEdge);
        expect(picked.length).toBe(12);

        for (const edge of picked) {
            const ref = captureEdgeRef(edge);
            // OCCT rebuilds deterministically, so the corresponding edge keeps its position.
            const expected = matchEdgeIndexes(same, [ref]).unchecked()![0];
            const moved = matchEdgeIndexes(taller, [ref]);
            expect(moved.isOk).toBe(true);
            expect(moved.unchecked()![0]).toBe(expected);
        }
    });
});
