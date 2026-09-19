// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    EditableShapeNode,
    type IFace,
    type INodeVisual,
    type IShape,
    Matrix4,
    Plane,
    Result,
    Serializer,
    ShapeTypes,
    XYZ,
} from "@chili3d/core";
import { createMockApplication, TestDocument } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import type { FeatureData } from "../../src/features/feature";
import { ParametricBodyNode } from "../../src/parametricBodyNode";
import { captureFaceRef, type PlaneFaceRef, planeOfFace, resolveFacePlane } from "../../src/sketch/planeRef";
import { SketchNode } from "../../src/sketch/sketchNode";

function planarFace(point: XYZ, normal: XYZ): IFace {
    return {
        shapeType: ShapeTypes.face,
        normal: () => [point, normal],
        surface: () => ({ isPlanar: () => true }),
        transformedMul: (transform: Matrix4) =>
            planarFace(transform.ofPoint(point), transform.ofVector(normal)),
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

describe("planeOfFace", () => {
    test("keeps the face's (0, 0) parameter point as the origin (the press-pull anchor)", () => {
        const plane = planeOfFace(planarFace(new XYZ({ x: 1, y: 2, z: 5 }), XYZ.unitZ));

        expect(plane.origin.isEqualTo(new XYZ({ x: 1, y: 2, z: 5 }))).toBe(true);
        expect(plane.normal.isEqualTo(XYZ.unitZ)).toBe(true);
        expect(plane.xvec.isEqualTo(XYZ.unitX)).toBe(true);
    });
});

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
            (body as any)._timeline.commit(
                [{ json: "", input: undefined, refs: new Map(), shape, faceIds }],
                [],
            );
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

    test("moves the plane with the referenced node's transform", () => {
        const restore = mockCombine();
        try {
            const { doc, source } = setup(solidWith(planarFace(new XYZ({ x: 0, y: 0, z: 5 }), XYZ.unitZ)));
            const sketch = sketchOn(doc, source.id, 5);
            // the face itself is unchanged — only the node's placement moves it
            const moved = Matrix4.fromTranslation(0, 0, 4);
            const visual = { worldTransform: () => moved } as unknown as INodeVisual;
            doc.visual.context.getVisual = () => visual;

            source.transform = moved;

            expect(sketch.plane.origin.z).toBe(9);
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

    describe("session rollback", () => {
        function bodyShowing(shape: IShape, featureCount: number) {
            const doc = new TestDocument({ application: createMockApplication() });
            const features: FeatureData[] = Array.from({ length: featureCount }, (_, index) => ({
                id: `f${index}`,
                type: "boolean" as const,
                operation: "fuse" as const,
                toolIds: [],
            }));
            const body = new ParametricBodyNode({ document: doc, features });
            doc.modelManager.addNode(body);
            (body as any)._shape = Result.ok(shape);
            return { doc, body };
        }

        function sketchAnchoredTo(doc: TestDocument, body: ParametricBodyNode, z: number, anchor?: number) {
            const sketch = new SketchNode({
                document: doc,
                plane: Plane.XY.translateTo(new XYZ({ x: 0, y: 0, z })),
                planeRef: { nodeId: body.id, normal: { x: 0, y: 0, z: 1 }, offset: z },
                data: {
                    entities: [],
                    constraints: [],
                    ...(anchor === undefined ? {} : { refPositions: { [body.id]: anchor } }),
                },
            });
            doc.modelManager.addNode(sketch);
            // Lazy first generation installs the watch.
            expect(sketch.shape.isOk).toBe(true);
            return sketch;
        }

        /** Mirrors setRollbackIndex's ordering: the flag flips first, then the shape change notifies. */
        function showPreview(body: ParametricBodyNode, index: number | undefined, shape: IShape) {
            (body as any)._rollbackIndex = index;
            body.shape = Result.ok(shape);
        }

        test("the session owner's plane freezes while the rollback undercuts its anchor", () => {
            const restore = mockCombine();
            try {
                const { doc, body } = bodyShowing(
                    solidWith(planarFace(new XYZ({ x: 0, y: 0, z: 5 }), XYZ.unitZ)),
                    3,
                );
                const sketch = sketchAnchoredTo(doc, body, 5, 2);
                sketch.setEditingSession(true);

                // The preview at index 1 hides the captured face — the only same-normal
                // face left sits at z=10, so resolving would hop the plane there.
                showPreview(body, 1, solidWith(planarFace(new XYZ({ x: 0, y: 0, z: 10 }), XYZ.unitZ)));
                expect(sketch.plane.origin.z).toBe(5);

                // The restore re-resolves against the full chain (flag already cleared).
                showPreview(body, undefined, solidWith(planarFace(new XYZ({ x: 0, y: 0, z: 5 }), XYZ.unitZ)));
                expect(sketch.plane.origin.z).toBe(5);

                // The watch is not wedged: a later rebuild carries the plane again.
                sketch.setEditingSession(false);
                body.shape = Result.ok(solidWith(planarFace(new XYZ({ x: 0, y: 0, z: 8 }), XYZ.unitZ)));
                expect(sketch.plane.origin.z).toBe(8);
            } finally {
                restore();
            }
        });

        test("a session owner without an anchor freezes on any rollback of the source", () => {
            const restore = mockCombine();
            try {
                const { doc, body } = bodyShowing(
                    solidWith(planarFace(new XYZ({ x: 0, y: 0, z: 5 }), XYZ.unitZ)),
                    3,
                );
                const sketch = sketchAnchoredTo(doc, body, 5);
                sketch.setEditingSession(true);

                showPreview(body, 0, solidWith(planarFace(new XYZ({ x: 0, y: 0, z: 10 }), XYZ.unitZ)));
                expect(sketch.plane.origin.z).toBe(5);
            } finally {
                restore();
            }
        });

        test("the session owner's plane follows a rollback that reaches its anchor", () => {
            const restore = mockCombine();
            try {
                const { doc, body } = bodyShowing(
                    solidWith(planarFace(new XYZ({ x: 0, y: 0, z: 5 }), XYZ.unitZ)),
                    3,
                );
                const sketch = sketchAnchoredTo(doc, body, 5, 2);
                // A later parameter edit moved the face and the plane followed.
                body.shape = Result.ok(solidWith(planarFace(new XYZ({ x: 0, y: 0, z: 7 }), XYZ.unitZ)));
                expect(sketch.plane.origin.z).toBe(7);

                sketch.setEditingSession(true);
                // The preview at the anchor IS the capture-time geometry: the plane
                // must follow it back, not freeze on the edited position.
                showPreview(body, 2, solidWith(planarFace(new XYZ({ x: 0, y: 0, z: 5 }), XYZ.unitZ)));
                expect(sketch.plane.origin.z).toBe(5);
            } finally {
                restore();
            }
        });

        test("an anchor at the feature count hides nothing — rebuilds carry the plane mid-session", () => {
            const restore = mockCombine();
            try {
                const { doc, body } = bodyShowing(
                    solidWith(planarFace(new XYZ({ x: 0, y: 0, z: 5 }), XYZ.unitZ)),
                    2,
                );
                const sketch = sketchAnchoredTo(doc, body, 5, 2);
                sketch.setEditingSession(true);

                body.shape = Result.ok(solidWith(planarFace(new XYZ({ x: 0, y: 0, z: 9 }), XYZ.unitZ)));
                expect(sketch.plane.origin.z).toBe(9);
            } finally {
                restore();
            }
        });
    });
});
