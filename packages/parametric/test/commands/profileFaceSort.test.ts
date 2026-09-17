// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Plane, ShapeTypes, XYZ } from "@chili3d/core";
import { TestDocument } from "@chili3d/core/test-utils";
import { describe, expect, test } from "@rstest/core";
import { prioritizeSketchFaces } from "../../src/commands/profileFaceSort";
import { ParametricBodyNode } from "../../src/parametricBodyNode";
import { SketchNode } from "../../src/sketch/sketchNode";

function faceOf(node: unknown, index: number) {
    return { shape: { shapeType: ShapeTypes.face }, owner: { node }, indexes: [index] } as any;
}

describe("prioritizeSketchFaces", () => {
    const doc = new TestDocument();
    const sketch = new SketchNode({
        document: doc,
        plane: Plane.XY,
        data: { entities: [], constraints: [] },
    });
    const body = new ParametricBodyNode({ document: doc, features: [] });
    const otherSketch = new SketchNode({
        document: doc,
        plane: new Plane({ origin: XYZ.zero, normal: XYZ.unitX, xvec: XYZ.unitY }),
        data: { entities: [], constraints: [] },
    });

    test("moves sketch faces ahead of the rest, keeping their own order", () => {
        const bodyA = faceOf(body, 0);
        const sketchA = faceOf(sketch, 1);
        const sketchB = faceOf(otherSketch, 2);

        expect(prioritizeSketchFaces([bodyA, sketchA, sketchB])).toEqual([sketchA, sketchB, bodyA]);
    });

    test("keeps the detection order when there is no sketch face", () => {
        const bodyA = faceOf(body, 0);
        const bodyB = faceOf(body, 1);

        expect(prioritizeSketchFaces([bodyA, bodyB])).toEqual([bodyA, bodyB]);
    });

    test("keeps the detection order when every face is a sketch's", () => {
        const sketchA = faceOf(sketch, 0);
        const sketchB = faceOf(otherSketch, 1);

        expect(prioritizeSketchFaces([sketchA, sketchB])).toEqual([sketchA, sketchB]);
    });
});
