// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type BoundingBox, type IEdge, type IShape, Matrix4, ShapeTypes, XYZ } from "@chili3d/core";
import type { ShapeFactory } from "../src/factory";
import { basisCurveOfEdge, createBox, createTestFactory, unwrapOk } from "./helpers";
import "./setup";

let factory: ShapeFactory;

beforeEach(() => {
    factory = createTestFactory();
});

/**
 * The box's own frame is an axis-aligned (0,0,0)–(dx,dy,dz) block, so a diagonal matrix maps
 * its bounding box corner for corner.
 */
function expectBoxMapped(shape: IShape, local: BoundingBox, matrix: Matrix4) {
    const boxed = shape.boundingBox()!;
    expect(new XYZ(boxed.min).distanceTo(matrix.ofPoint(local.min))).toBeCloseTo(0);
    expect(new XYZ(boxed.max).distanceTo(matrix.ofPoint(local.max))).toBeCloseTo(0);
}

function roundEdgeTypes(shape: IShape) {
    return (shape.findSubShapes(ShapeTypes.edge) as IEdge[])
        .map((edge) => basisCurveOfEdge(edge as never).curveType)
        .filter((type) => type !== "line");
}

describe("OccShape transforms", () => {
    /**
     * `gp_Trsf` — the transform behind a placement — is a similarity, so a non-uniform scale
     * used to be silently dropped. The general affine path rebuilds the body instead.
     */
    test("transformedMul applies a non-uniform scale", () => {
        const box = createBox(factory, 10, 20, 30);
        const matrix = Matrix4.fromScale(1, 1, 2.5).multiply(Matrix4.fromTranslation(0, 0, 100));

        expectBoxMapped(box.transformedMul(matrix), box.boundingBox()!, matrix);
    });

    test("transformed applies a non-uniform scale too", () => {
        const box = createBox(factory, 10, 20, 30);
        const matrix = Matrix4.fromScale(1, 1, 2.5);

        expectBoxMapped(box.transformed(matrix), box.boundingBox()!, matrix);
    });

    test("a similarity keeps the same geometry", () => {
        const box = createBox(factory, 10, 20, 30);
        const matrix = Matrix4.fromScale(2, 2, 2).multiply(Matrix4.fromTranslation(5, 0, 0));

        expectBoxMapped(box.transformedMul(matrix), box.boundingBox()!, matrix);
    });

    test("rebuilds a curved body's geometry, not just its placement", () => {
        const cylinder = unwrapOk(factory.cylinder(XYZ.unitZ, XYZ.zero, 5, 10));
        expect(roundEdgeTypes(cylinder)).toEqual(["circle", "circle"]);

        const scaled = cylinder.transformedMul(Matrix4.fromScale(1, 1, 3));

        // GTransform rebuilds every curve through the map (a circle becomes its ellipse, drawn
        // by OCCT as a b-spline), so the rims are no longer reported as circles.
        expect(roundEdgeTypes(scaled).every((type) => type !== "circle")).toBe(true);
        expect(roundEdgeTypes(scaled).length).toBeGreaterThanOrEqual(2);
        // the body is three times as tall, its footprint untouched by a z-only scale
        const boxed = scaled.boundingBox()!;
        expect(new XYZ(boxed.max).z).toBeCloseTo(30);
        expect(new XYZ(boxed.max).x).toBeCloseTo(5);
        expect(new XYZ(boxed.min).x).toBeCloseTo(-5);
    });
});
