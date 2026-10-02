// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { BoundingBox, Matrix4, Result, ShapeTypes, XYZ } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { findIntersectingBodies } from "../../src/commands/intersectingBody";
import { ParametricBodyNode } from "../../src/parametricBodyNode";

/** A 10×10×10 box from `min`. */
const boxAt = (x: number, y: number, z: number) =>
    new BoundingBox(new XYZ({ x, y, z }), new XYZ({ x: x + 10, y: y + 10, z: z + 10 }));

/** A body whose LOCAL shape is a 10-cube at the origin — its transform does the placing. */
function scenario(transform = Matrix4.identity(), id = "b1") {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    const body = new ParametricBodyNode({ document: doc, id, features: [] });
    (body as any)._shape = Result.ok({
        shapeType: ShapeTypes.solid,
        isEqual: () => false,
        dispose: () => {},
        findSubShapes: () => [],
        boundingBox: () => boxAt(0, 0, 0),
    });
    // Straight to the private value: the `transform` setter re-solves the body, which for a
    // feature-less body means `shapeFactory.combine([])` — machinery this test does not need.
    (body as any).setPrivateValue("transform", transform);
    doc.modelManager.addNode(body);
    return { doc, body };
}

describe("findIntersectingBodies", () => {
    test("finds an untransformed body the tool overlaps", () => {
        const { doc, body } = scenario();

        expect(findIntersectingBodies(doc, boxAt(5, 5, 5))).toEqual([body]);
        expect(findIntersectingBodies(doc, boxAt(50, 50, 50))).toEqual([]);
    });

    test("every body the tool meets is reported, in tree order", () => {
        const { doc, body } = scenario();
        // A second body overlapping the same tool, moved clear of the third.
        const second = scenario(Matrix4.fromTranslation(5, 0, 0), "b2").body;
        doc.modelManager.addNode(second);
        const far = scenario(Matrix4.fromTranslation(100, 0, 0), "b3").body;
        doc.modelManager.addNode(far);

        expect(findIntersectingBodies(doc, boxAt(6, 0, 0))).toEqual([body, second]);
    });

    test("a moved body is measured where it is displayed, not where its shape was built", () => {
        const { doc, body } = scenario(Matrix4.fromTranslation(100, 0, 0));

        // The body now occupies world x ∈ [100,110]: a tool at the origin no longer
        // touches it, and one over its new position does.
        expect(findIntersectingBodies(doc, boxAt(0, 0, 0))).toEqual([]);
        expect(findIntersectingBodies(doc, boxAt(95, 0, 0))).toEqual([body]);
    });

    test("a rotated body's box is refitted around its transformed corners", () => {
        // A quarter turn about Z maps the local 10-cube to a 10-cube 10 further out in X.
        const { doc, body } = scenario(Matrix4.fromAxisRad(XYZ.zero, XYZ.unitZ, Math.PI / 2));

        // The box now spans world x ∈ [-10,0], y ∈ [0,10]: a probe near the origin's +X
        // side would only touch it if the probe compared against the untransformed shape.
        expect(findIntersectingBodies(doc, boxAt(5, 0, 0))).toEqual([]);
        expect(findIntersectingBodies(doc, boxAt(-5, 0, 0))).toEqual([body]);
    });

    test("ignores bodies without a usable shape", () => {
        const { doc, body } = scenario();
        (body as any)._shape = Result.err("no shape");
        // The `shape` getter retries generation while `_evaluated` is false; the point here
        // is the already-attempted-and-failed state, not the retry.
        (body as any)._evaluated = true;

        expect(findIntersectingBodies(doc, boxAt(0, 0, 0))).toEqual([]);
    });
});
