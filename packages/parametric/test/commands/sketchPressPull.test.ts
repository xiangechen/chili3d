// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    BoundingBox,
    Matrix4,
    Result,
    ShapeTypes,
    type VisualShapeData,
    XYZ,
    type XYZLike,
} from "@chili3d/core";
import { createMockApplication, createMockShape, TestDocument } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { sketchPressPullOperation } from "../../src/commands/sketchPressPull";
import { ParametricBodyNode } from "../../src/parametricBodyNode";

const SKETCH_PLANE = 100;

/** A profile face in the z = 100 plane, one square-ish pick, seen from above. */
function profile(transform: Matrix4 = Matrix4.fromTranslation(0, 0, SKETCH_PLANE)): VisualShapeData {
    return {
        shape: {
            shapeType: ShapeTypes.face,
            boundingBox: () =>
                new BoundingBox(new XYZ({ x: -10, y: -10, z: 0 }), new XYZ({ x: 10, y: 10, z: 0 })),
        },
        owner: { node: {} },
        transform,
        indexes: [0],
    } as any;
}

/**
 * A body whose solid answers `inside` for local points, and whose box is `box` (local).
 * Its placement is identity unless one is given.
 */
function body(
    document: TestDocument,
    box: BoundingBox,
    inside: (point: XYZLike) => boolean,
    transform: Matrix4 = Matrix4.identity(),
): ParametricBodyNode {
    const node = new ParametricBodyNode({ document, features: [] });
    // The shape is installed directly rather than through the setter: the setter's change
    // detection reads the getter, which would evaluate an empty feature list through a
    // kernel factory no unit test installs. Marking the body evaluated keeps the getter's
    // own retry from firing later.
    (node as any)._evaluated = true;
    (node as any)._shape = Result.ok(
        createMockShape({
            boundingBox: () => box,
            containsPoint: rs.fn(inside),
            findSubShapes: () => [],
        }),
    );
    node.transform = transform;
    document.modelManager.addNode(node);
    return node;
}

describe("sketchPressPullOperation", () => {
    const down = XYZ.unitNZ;
    const origin = new XYZ({ x: 0, y: 0, z: SKETCH_PLANE });

    test("a drag ending inside a body cuts", () => {
        const document = new TestDocument({ application: createMockApplication() });
        // The box must hold the end (60): the classification is box-prechecked, and a box that
        // disagrees with the solid would be the mock's inconsistency, not a real doc's.
        body(
            document,
            new BoundingBox(new XYZ({ x: -5, y: -5, z: 50 }), new XYZ({ x: 5, y: 5, z: 100 })),
            () => true,
        );

        const operation = sketchPressPullOperation(document, [profile()], origin, down, 40);

        expect(operation).toBe("cut");
    });

    test("a drag ending outside, whose prism still meets a body, joins", () => {
        const document = new TestDocument({ application: createMockApplication() });
        // z ∈ [50, 100]: the prism from 60 to 100 reaches it, the end at 60 is not inside.
        body(
            document,
            new BoundingBox(new XYZ({ x: -5, y: -5, z: 50 }), new XYZ({ x: 5, y: 5, z: 100 })),
            () => false,
        );

        const operation = sketchPressPullOperation(document, [profile()], origin, down, 40);

        expect(operation).toBe("join");
    });

    test("a drag whose prism meets nothing is a body of its own", () => {
        const document = new TestDocument({ application: createMockApplication() });
        body(
            document,
            new BoundingBox(new XYZ({ x: 200, y: 200, z: 200 }), new XYZ({ x: 300, y: 300, z: 300 })),
            () => false,
        );

        const operation = sketchPressPullOperation(document, [profile()], origin, down, 40);

        expect(operation).toBe("new");
    });

    test("the end is classified in the body's own space, not in world space", () => {
        const document = new TestDocument({ application: createMockApplication() });
        // The solid's local box is around the origin; the body sits 60 mm above it, so the
        // world end at z = 60 lands on local z = 0 — inside. A world-space reading would
        // have missed it.
        const node = body(
            document,
            new BoundingBox(new XYZ({ x: -5, y: -5, z: -5 }), new XYZ({ x: 5, y: 5, z: 5 })),
            (point) => Math.abs(point.x) <= 5 && Math.abs(point.y) <= 5 && Math.abs(point.z) <= 5,
            Matrix4.fromTranslation(0, 0, 60),
        );

        const operation = sketchPressPullOperation(document, [profile()], origin, down, 40);

        expect(node.shape.isOk).toBe(true);
        expect(operation).toBe("cut");
    });

    test("a positive drag sweeps away from the sketch and reads the far box", () => {
        const document = new TestDocument({ application: createMockApplication() });
        // z ∈ [140, 160]: out of reach for a negative drag, in reach for the positive one.
        body(
            document,
            new BoundingBox(new XYZ({ x: -5, y: -5, z: 140 }), new XYZ({ x: 5, y: 5, z: 160 })),
            () => false,
        );

        expect(sketchPressPullOperation(document, [profile()], origin, XYZ.unitZ, 40)).toBe("join");
        expect(sketchPressPullOperation(document, [profile()], origin, down, 40)).toBe("new");
    });

    test("every picked profile counts as part of the prism", () => {
        const document = new TestDocument({ application: createMockApplication() });
        // Only the SECOND profile's world box reaches this body; the first one is far left.
        body(
            document,
            new BoundingBox(new XYZ({ x: 100, y: -5, z: 60 }), new XYZ({ x: 110, y: 5, z: 100 })),
            () => false,
        );
        const first = profile();
        const second = profile(Matrix4.fromTranslation(100, 0, SKETCH_PLANE));

        expect(sketchPressPullOperation(document, [first], origin, down, 40)).toBe("new");
        expect(sketchPressPullOperation(document, [first, second], origin, down, 40)).toBe("join");
    });

    test("an invalid pick box skips the join reading rather than inventing one", () => {
        const document = new TestDocument({ application: createMockApplication() });
        body(document, BoundingBox.zero, () => false);
        const broken = profile();
        (broken.shape as any).boundingBox = () =>
            new BoundingBox(new XYZ({ x: 10, y: 10, z: 10 }), new XYZ({ x: -10, y: -10, z: -10 }));

        expect(sketchPressPullOperation(document, [broken], origin, down, 40)).toBe("new");
    });
});
