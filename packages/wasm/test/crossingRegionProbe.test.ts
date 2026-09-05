// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Probe: pin down the kernel's behavior for crossing sketches, which the parametric
// seed-id layer depends on — (1) a region's edge enumeration (and thus the side-face
// ids `sketch:<id>:<index>:e<edgeIndex>`) is stable when a split moves, (2) every
// region of two intersecting circles is bounded by the same two entities, so the
// entity-id set is not a unique region identity, and (3) the region order is not stable
// when the circles swap sides, so the index is not a stable identity either.

import { BoundingBox, type IEdge, Plane, ShapeTypes, XYZ } from "@chili3d/core";
import type { ShapeFactory } from "../src/factory";
import { createTestFactory, unwrapOk } from "./helpers";
import "./setup";

let factory: ShapeFactory;

beforeEach(() => {
    factory = createTestFactory();
});

/** Four rectangle edges (0,0)-(10,10) plus a diagonal crossing them mid-span. */
function rectangleWithDiagonal(diag: IEdge): IEdge[] {
    return [
        unwrapOk(factory.line(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 10, y: 0, z: 0 }))),
        unwrapOk(factory.line(new XYZ({ x: 10, y: 0, z: 0 }), new XYZ({ x: 10, y: 10, z: 0 }))),
        unwrapOk(factory.line(new XYZ({ x: 10, y: 10, z: 0 }), new XYZ({ x: 0, y: 10, z: 0 }))),
        unwrapOk(factory.line(new XYZ({ x: 0, y: 10, z: 0 }), new XYZ({ x: 0, y: 0, z: 0 }))),
        diag,
    ];
}

/** The index of the diagonal edge (the one neither horizontal nor vertical) per region. */
function diagonalIndexes(diag: IEdge): number[] {
    const regions = unwrapOk(factory.facesFromEdges(rectangleWithDiagonal(diag), Plane.XY));
    return regions.faces.map((face) => {
        const edges = face.findSubShapes(ShapeTypes.edge) as IEdge[];
        return edges.findIndex((edge) => {
            const s = edge.startPoint();
            const e = edge.endPoint();
            return Math.abs(s.x - e.x) > 1e-6 && Math.abs(s.y - e.y) > 1e-6;
        });
    });
}

/** The index of the lens region (its center sits at the midpoint of the two circles). */
function lensIndex(dx: number): number {
    const c1 = unwrapOk(factory.circle(XYZ.unitZ, XYZ.zero, 5));
    const c2 = unwrapOk(factory.circle(XYZ.unitZ, new XYZ({ x: dx, y: 0, z: 0 }), 5));
    const regions = unwrapOk(factory.facesFromEdges([c1, c2], Plane.XY));
    let best = 0;
    let bestDistance = Infinity;
    for (const [i, face] of regions.faces.entries()) {
        const center = BoundingBox.center(face.boundingBox());
        const distance = Math.abs(center.x - dx / 2);
        if (distance < bestDistance) {
            best = i;
            bestDistance = distance;
        }
    }
    return best;
}

describe("crossing region probe", () => {
    test("the diagonal edge's index is stable when the split moves", () => {
        const diagA = unwrapOk(factory.line(new XYZ({ x: 2, y: -1, z: 0 }), new XYZ({ x: 8, y: 11, z: 0 })));
        const diagB = unwrapOk(factory.line(new XYZ({ x: 3, y: -1, z: 0 }), new XYZ({ x: 7, y: 11, z: 0 })));

        expect(diagonalIndexes(diagA)).toEqual(diagonalIndexes(diagB));
    });

    test("every region of two intersecting circles is bounded by the same two entities", () => {
        const c1 = unwrapOk(factory.circle(XYZ.unitZ, XYZ.zero, 5));
        const c2 = unwrapOk(factory.circle(XYZ.unitZ, new XYZ({ x: 3, y: 0, z: 0 }), 5));
        const regions = unwrapOk(factory.facesFromEdges([c1, c2], Plane.XY));

        expect(regions.faces.length).toBe(3);
        for (const sources of regions.sources) {
            expect(sources).toEqual([0, 1]);
        }
    });

    test("the region order is not stable when the circles swap sides", () => {
        // The lens keeps its identity but its enumeration index changes with the
        // circles' relative side — index 0 when the second circle is right, 1 when left.
        expect(lensIndex(3)).toBe(0);
        expect(lensIndex(-3)).toBe(1);
    });
});
