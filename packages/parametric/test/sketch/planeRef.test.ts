// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    EditableShapeNode,
    type IFace,
    type IShape,
    Plane,
    Result,
    Serializer,
    ShapeTypes,
    XYZ,
} from "@chili3d/core";
import { createMockApplication, TestDocument } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { ParametricBodyNode } from "../../src/parametricBodyNode";
import { captureFaceRef, type PlaneFaceRef, resolveFacePlane } from "../../src/sketch/planeRef";
import { SketchNode } from "../../src/sketch/sketchNode";

function planarFace(point: XYZ, normal: XYZ): IFace {
    return {
        shapeType: ShapeTypes.face,
        normal: () => [point, normal],
        surface: () => ({ isPlanar: () => true }),
        transformedMul: () => planarFace(point, normal),
        isEqual: () => false,
        dispose: rs.fn(),
    } as unknown as IFace;
}

function solidWith(...faces: IFace[]): IShape {
    return {
        shapeType: ShapeTypes.solid,
        findSubShapes: (type: number) => (type === ShapeTypes.face ? faces : []),
        isEqual: () => false,
        dispose: rs.fn(),
    } as unknown as IShape;
}

function setup(shape: IShape) {
    const doc = new TestDocument({ application: createMockApplication() });
    const source = new EditableShapeNode({ document: doc, name: "src", shape: Result.ok(shape) });
    doc.modelManager.addNode(source);
    return { doc, source };
}

describe("resolveFacePlane", () => {
    test("re-resolves the face moved by a rebuild", () => {
        const top = planarFace(new XYZ({ x: 0, y: 0, z: 5 }), XYZ.unitZ);
        const { doc, source } = setup(solidWith(top));
        const ref = captureFaceRef(source.id, top);
        expect(ref.offset).toBe(5);

        source.shape = Result.ok(solidWith(planarFace(new XYZ({ x: 0, y: 0, z: 10 }), XYZ.unitZ)));

        const plane = resolveFacePlane(doc, ref);
        expect(plane?.origin.z).toBe(10);
        expect(plane?.normal.isEqualTo(XYZ.unitZ)).toBe(true);
    });

    test("picks the closest offset among co-directional faces", () => {
        const { doc, source } = setup(
            solidWith(
                planarFace(new XYZ({ x: 0, y: 0, z: 10 }), XYZ.unitZ),
                planarFace(new XYZ({ x: 0, y: 0, z: 20 }), XYZ.unitZ),
            ),
        );
        const ref = { nodeId: source.id, normal: { x: 0, y: 0, z: 1 }, offset: 6 };

        expect(resolveFacePlane(doc, ref)?.origin.z).toBe(10);
    });

    test("returns undefined when no face matches the captured normal", () => {
        const { doc, source } = setup(solidWith(planarFace(XYZ.zero, XYZ.unitX)));
        const ref = { nodeId: source.id, normal: { x: 0, y: 0, z: 1 }, offset: 5 };

        expect(resolveFacePlane(doc, ref)).toBeUndefined();
    });

    test("returns undefined when the referenced node is gone", () => {
        const { doc } = setup(solidWith(planarFace(XYZ.zero, XYZ.unitZ)));
        const ref = { nodeId: "missing", normal: { x: 0, y: 0, z: 1 }, offset: 5 };

        expect(resolveFacePlane(doc, ref)).toBeUndefined();
    });

    describe("faceId on a parametric body", () => {
        function bodyWithFaces(faceIds: string[], ...faces: IFace[]) {
            const doc = new TestDocument({ application: createMockApplication() });
            const body = new ParametricBodyNode({ document: doc });
            doc.modelManager.addNode(body);
            const shape = solidWith(...faces);
            (body as any)._shape = Result.ok(shape);
            (body as any)._cache = [{ json: "", input: undefined, refs: new Map(), shape, faceIds }];
            return { doc, body };
        }

        test("a hit whose normal still matches resolves exactly, not by nearest offset", () => {
            const { doc, body } = bodyWithFaces(
                ["f1:0", "f1:1"],
                planarFace(new XYZ({ x: 0, y: 0, z: 20 }), XYZ.unitZ),
                planarFace(new XYZ({ x: 0, y: 0, z: 8 }), XYZ.unitZ),
            );
            // captured at z=5 from the face that has since moved to z=20; the other
            // co-directional face at z=8 is closer to the captured offset
            const ref: PlaneFaceRef = {
                nodeId: body.id,
                normal: { x: 0, y: 0, z: 1 },
                offset: 5,
                faceId: "f1:0",
            };

            expect(resolveFacePlane(doc, ref)?.origin.z).toBe(20);
        });

        test("a hit whose normal mismatched falls back to the fingerprint", () => {
            const { doc, body } = bodyWithFaces(
                ["f1:0", "f1:1"],
                planarFace(new XYZ({ x: 3, y: 0, z: 0 }), XYZ.unitX),
                planarFace(new XYZ({ x: 0, y: 0, z: 5 }), XYZ.unitZ),
            );
            // the id now indexes a +X face — a rebuild reordered the faces
            const ref: PlaneFaceRef = {
                nodeId: body.id,
                normal: { x: 0, y: 0, z: 1 },
                offset: 5,
                faceId: "f1:0",
            };

            const plane = resolveFacePlane(doc, ref);
            expect(plane?.normal.isEqualTo(XYZ.unitZ)).toBe(true);
            expect(plane?.origin.z).toBe(5);
        });

        test("a hit whose normal rotated is tracked by its id when no fingerprint matches", () => {
            const { doc, body } = bodyWithFaces(
                ["f1:0"],
                planarFace(new XYZ({ x: 0, y: 0, z: 5 }), XYZ.unitX),
            );
            // captured when the face was +Z; it has since rotated to +X (a side face
            // tilting when a crossing diagonal moves), and no face now carries the
            // captured +Z normal — only the stable id identifies it.
            const ref: PlaneFaceRef = {
                nodeId: body.id,
                normal: { x: 0, y: 0, z: 1 },
                offset: 5,
                faceId: "f1:0",
            };

            expect(resolveFacePlane(doc, ref)?.normal.isEqualTo(XYZ.unitX)).toBe(true);
        });
    });
});

describe("SketchNode plane follow", () => {
    function mockCombine() {
        const previous = Object.getOwnPropertyDescriptor(globalThis, "shapeFactory");
        Object.defineProperty(globalThis, "shapeFactory", {
            value: { combine: rs.fn(() => Result.ok({ isEqual: () => false, dispose: rs.fn() })) },
            writable: true,
            configurable: true,
        });
        return () => {
            if (previous) {
                Object.defineProperty(globalThis, "shapeFactory", previous);
            } else {
                delete (globalThis as any).shapeFactory;
            }
        };
    }

    function sketchOn(doc: TestDocument, sourceId: string, z: number): SketchNode {
        const sketch = new SketchNode({
            document: doc,
            plane: Plane.XY.translateTo(new XYZ({ x: 0, y: 0, z })),
            planeRef: { nodeId: sourceId, normal: { x: 0, y: 0, z: 1 }, offset: z },
        });
        doc.modelManager.addNode(sketch);
        // Lazy first generation installs the watch.
        expect(sketch.shape.isOk).toBe(true);
        return sketch;
    }

    test("moves the plane with the referenced face on source rebuild", () => {
        const restore = mockCombine();
        try {
            const { doc, source } = setup(solidWith(planarFace(new XYZ({ x: 0, y: 0, z: 5 }), XYZ.unitZ)));
            const sketch = sketchOn(doc, source.id, 5);

            source.shape = Result.ok(solidWith(planarFace(new XYZ({ x: 0, y: 0, z: 10 }), XYZ.unitZ)));

            expect(sketch.plane.origin.z).toBe(10);
        } finally {
            restore();
        }
    });

    test("keeps the last plane when the referenced face disappears", () => {
        const restore = mockCombine();
        try {
            const { doc, source } = setup(solidWith(planarFace(new XYZ({ x: 0, y: 0, z: 5 }), XYZ.unitZ)));
            const sketch = sketchOn(doc, source.id, 5);

            source.shape = Result.ok(solidWith(planarFace(XYZ.zero, XYZ.unitX)));

            expect(sketch.plane.origin.z).toBe(5);
        } finally {
            restore();
        }
    });

    test("Serializer round-trips the plane reference", () => {
        const restore = mockCombine();
        try {
            const { doc, source } = setup(solidWith(planarFace(new XYZ({ x: 0, y: 0, z: 5 }), XYZ.unitZ)));
            const sketch = sketchOn(doc, source.id, 5);

            const serialized = Serializer.serializeObject(sketch);
            expect(serialized["planeRefJson"]).toBe(JSON.stringify(sketch.planeRef));

            const restored = Serializer.deserializeObject(doc, serialized) as SketchNode;
            expect(restored.planeRef).toEqual({
                nodeId: source.id,
                normal: { x: 0, y: 0, z: 1 },
                offset: 5,
            });
        } finally {
            restore();
        }
    });
});
