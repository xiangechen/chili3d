// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    AUTO_TARGETS,
    BoundingBox,
    CancelableCommand,
    type I18nKeys,
    type IShape,
    type IStep,
    Matrix4,
    Plane,
    PropertyUtils,
    PubSub,
    Result,
    SELECTED_FACE_STATE,
    type ShapeType,
    ShapeTypes,
    type TargetSelection,
    VisualStates,
    XYZ,
    type XYZLike,
} from "@chili3d/core";
import {
    createHandlerMockView,
    createMockApplication,
    createMockSelection,
    createMockVisualWithDocument,
    nearestOnSegment,
    TestDocument,
} from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { ExtrudeEndTargetStep, ExtrudeFeatureCommand } from "../../src/commands/extrudeCommand";
import { dragPlaneOf, ExtrudeDragHandler } from "../../src/commands/extrudeDragStep";
import type { ExtrudeFeatureData } from "../../src/features/feature";
import { ParametricBodyNode } from "../../src/parametricBodyNode";
import type { SketchData } from "../../src/sketch/sketchModel";
import { SketchNode } from "../../src/sketch/sketchNode";

function faceData(node: unknown) {
    return { shape: { shapeType: ShapeTypes.face }, owner: { node }, indexes: [0] } as any;
}

function mockShapeFactory(methods: Record<string, (...args: any[]) => any>) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "shapeFactory");
    Object.defineProperty(globalThis, "shapeFactory", {
        value: methods,
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

/**
 * The sketch-profile shapes the preview/detection tests need: real line/wire/face geometry
 * whose boxes follow their coordinates, and a prism that records the vector it swept. The
 * prism carries a face mesh so the no-operation preview can draw it.
 */
function mockProfileFactory(prismVecs: XYZ[]) {
    return mockShapeFactory({
        line: (start: XYZ, end: XYZ) =>
            Result.ok({
                shapeType: ShapeTypes.edge,
                curve: { nearestFromPoint: (point: XYZ) => nearestOnSegment(start, end, point) },
                startPoint: () => start,
                endPoint: () => end,
                firstParameter: () => 0,
                lastParameter: () => 1,
                pointAt: (t: number) => start.add(end.sub(start).multiply(t)),
                intersect: () => [],
                boundingBox: () =>
                    new BoundingBox(
                        {
                            x: Math.min(start.x, end.x),
                            y: Math.min(start.y, end.y),
                            z: Math.min(start.z, end.z),
                        },
                        {
                            x: Math.max(start.x, end.x),
                            y: Math.max(start.y, end.y),
                            z: Math.max(start.z, end.z),
                        },
                    ),
                isEqual: () => false,
            }),
        combine: (edges: any[]) =>
            Result.ok({
                shapeType: ShapeTypes.compound,
                isEqual: () => false,
                dispose: () => {},
                findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? edges : []),
            }),
        wire: (edges: any[]) => Result.ok({ isClosed: () => edges.length > 1, edges }),
        face: (wires: any[]) => {
            const edges = wires.flatMap((w: any) => w.edges);
            const zs = edges.flatMap((e: any) => [e.startPoint().z, e.endPoint().z]);
            return Result.ok({
                shapeType: ShapeTypes.face,
                isEqual: () => false,
                dispose: () => {},
                findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? edges : []),
                area: () => 1,
                boundingBox: () =>
                    new BoundingBox({ x: 0, y: 0, z: Math.min(...zs) }, { x: 1, y: 1, z: Math.max(...zs) }),
            });
        },
        prism: (face: any, vec: XYZ) => {
            prismVecs.push(vec);
            const fb = face.boundingBox();
            return Result.ok({
                shapeType: ShapeTypes.solid,
                isEqual: () => false,
                dispose: () => {},
                findSubShapes: () => [],
                boundingBox: () =>
                    new BoundingBox(
                        { x: fb.min.x, y: fb.min.y, z: Math.min(fb.min.z, fb.min.z + vec.z) },
                        { x: fb.max.x, y: fb.max.y, z: Math.max(fb.max.z, fb.max.z + vec.z) },
                    ),
                mesh: { faces: { range: [] }, edges: undefined },
            });
        },
        booleanCut: () =>
            Result.ok({
                shapeType: ShapeTypes.solid,
                isEqual: () => false,
                dispose: () => {},
                findSubShapes: () => [],
                boundingBox: () => new BoundingBox({ x: 0, y: 0, z: 19 }, { x: 1, y: 1, z: 21 }),
            }),
    });
}

/** A world face the extrude sweeps, as the drag step's placeholder carries it. */
function sweptProfile(sketch: SketchNode) {
    return {
        shape: {
            shapeType: ShapeTypes.face,
            boundingBox: () => new BoundingBox({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }),
        },
        owner: { node: sketch },
        transform: Matrix4.identity(),
        indexes: [0],
    } as any;
}

/** The aimed up-to target: a planar face parallel to the profile plane at `z`. */
function targetFaceAt(sketch: SketchNode, z: number) {
    return {
        shape: {
            shapeType: ShapeTypes.face,
            normal: () => [new XYZ({ x: 0, y: 0, z }), XYZ.unitZ],
            surface: () => ({ isPlanar: () => true }),
            findSubShapes: () => [],
            boundingBox: () => new BoundingBox({ x: 0, y: 0, z }, { x: 1, y: 1, z }),
        },
        owner: { node: sketch },
        transform: Matrix4.identity(),
        indexes: [0],
    } as any;
}

describe("ExtrudeFeatureCommand profile step", () => {
    let doc: TestDocument;
    let sketch: SketchNode;
    let other: SketchNode;

    beforeEach(() => {
        doc = new TestDocument({ application: createMockApplication() });
        sketch = new SketchNode({ document: doc, plane: Plane.XY, data: { entities: [], constraints: [] } });
        other = new SketchNode({ document: doc, plane: Plane.XY, data: { entities: [], constraints: [] } });
    });

    function profileStep(): IStep {
        return (new ExtrudeFeatureCommand() as any).getSteps()[0];
    }

    function mockSelection(shapes: any[], nodes: any[]) {
        doc.selection = {
            getSelectedShapes: () => shapes,
            getSelectedNodes: () => nodes,
            clearSelection: () => {},
        } as any;
    }

    test("uses preselected sketch faces and skips the picker", async () => {
        const faces = [faceData(sketch), faceData(sketch)];
        mockSelection(faces, []);
        const pickShape = rs.fn();
        doc.picker = { pickShape } as any;
        const controller = new AsyncController();

        const result = await profileStep().execute(doc, controller);

        expect(controller.result?.status).toBe("success");
        expect(pickShape).not.toHaveBeenCalled();
        expect(result!.nodes![0]).toBe(sketch);
        expect(result!.shapes).toEqual(faces);
    });

    test("keeps only the first sketch's faces when several sketches are selected", async () => {
        const mine = faceData(sketch);
        const foreign = faceData(other);
        mockSelection([mine, foreign], []);
        doc.picker = { pickShape: rs.fn() } as any;

        const result = await profileStep().execute(doc, new AsyncController());

        expect(result!.nodes![0]).toBe(sketch);
        expect(result!.shapes).toEqual([mine]);
    });

    test("a preselected sketch node without profiles extrudes the whole sketch", async () => {
        const restoreFactory = mockShapeFactory({
            combine: () => Result.ok({ shapeType: ShapeTypes.compound, findSubShapes: () => [] }),
        });
        try {
            mockSelection([], [sketch, other]);
            const pickShape = rs.fn();
            doc.picker = { pickShape } as any;
            const controller = new AsyncController();

            const result = await profileStep().execute(doc, controller);

            expect(controller.result?.status).toBe("success");
            expect(pickShape).not.toHaveBeenCalled();
            expect(result!.nodes![0]).toBe(sketch);
            expect(result!.shapes).toEqual([]);
        } finally {
            restoreFactory();
        }
    });

    test("a preselected sketch node selects all outer profiles", async () => {
        const restoreFactory = mockShapeFactory({
            line: (start: XYZ, end: XYZ) =>
                Result.ok({
                    shapeType: ShapeTypes.edge,
                    curve: { nearestFromPoint: (point: XYZ) => nearestOnSegment(start, end, point) },
                    startPoint: () => start,
                    endPoint: () => end,
                    firstParameter: () => 0,
                    lastParameter: () => 1,
                    pointAt: (t: number) => start.add(end.sub(start).multiply(t)),
                    intersect: () => [],
                    boundingBox: () =>
                        new BoundingBox(
                            {
                                x: Math.min(start.x, end.x),
                                y: Math.min(start.y, end.y),
                                z: Math.min(start.z, end.z),
                            },
                            {
                                x: Math.max(start.x, end.x),
                                y: Math.max(start.y, end.y),
                                z: Math.max(start.z, end.z),
                            },
                        ),
                    isEqual: () => false,
                }),
            combine: (edges: any[]) =>
                Result.ok({
                    shapeType: ShapeTypes.compound,
                    matrix: Matrix4.identity(),
                    mesh: { faces: undefined, edges: undefined },
                    isEqual: () => false,
                    dispose: () => {},
                    findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? edges : []),
                }),
            wire: (edges: any[]) => Result.ok({ isClosed: () => edges.length > 1, edges }),
            face: (wires: any[]) => {
                const face: any = {
                    shapeType: ShapeTypes.face,
                    matrix: Matrix4.identity(),
                    boundingBox: () => new BoundingBox({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }),
                    isEqual: () => false,
                    dispose: () => {},
                    findSubShapes: (type: ShapeType) =>
                        type === ShapeTypes.edge ? wires.flatMap((w: any) => w.edges) : [],
                };
                face.mesh = {
                    faces: {
                        range: [{ start: 0, count: 3, shape: face }],
                        index: new Uint32Array([0, 1, 2]),
                        position: new Float32Array(9),
                        normal: new Float32Array(9),
                        uv: new Float32Array(6),
                    },
                    edges: undefined,
                };
                return Result.ok(face);
            },
        });
        try {
            const square: SketchData = {
                entities: [
                    { id: 1, type: "line", params: [0, 0, 1, 0] },
                    { id: 2, type: "line", params: [1, 0, 1, 1] },
                    { id: 3, type: "line", params: [1, 1, 0, 1] },
                    { id: 4, type: "line", params: [0, 1, 0, 0] },
                ],
                constraints: [],
            };
            const squareSketch = new SketchNode({ document: doc, plane: Plane.XY, data: square });
            doc.modelManager.addNode(squareSketch);
            const owner = { node: squareSketch, worldTransform: () => Matrix4.identity() };
            doc.visual = {
                context: { getVisual: (node: unknown) => (node === squareSketch ? owner : undefined) },
            } as any;
            const setSelectedShapes = rs.fn();
            doc.selection = {
                getSelectedShapes: () => [],
                getSelectedNodes: () => [squareSketch],
                setSelectedShapes,
                clearSelection: () => {},
            } as any;

            const result = await profileStep().execute(doc, new AsyncController());

            expect(result!.nodes![0]).toBe(squareSketch);
            expect(result!.shapes!.length).toBe(1);
            const face = result!.shapes![0];
            expect(face.owner).toBe(owner as any);
            expect(face.indexes).toEqual([0]);
            expect(face.point).toEqual(new XYZ({ x: 0.5, y: 0.5, z: 0 }));
            expect(setSelectedShapes).toHaveBeenCalledTimes(1);
            expect(setSelectedShapes.mock.calls[0][0]).toEqual(result!.shapes);
            expect(setSelectedShapes.mock.calls[0][1]).toBe(SELECTED_FACE_STATE);
        } finally {
            restoreFactory();
        }
    });

    test("a preselected planar body face is used, curved faces are ignored", async () => {
        const body = new ParametricBodyNode({ document: doc, features: [] });
        const curved = faceData(body);
        curved.shape.surface = () => ({ isPlanar: () => false });
        const planar = faceData(body);
        planar.shape.surface = () => ({ isPlanar: () => true });
        mockSelection([curved, planar], []);
        const pickShape = rs.fn();
        doc.picker = { pickShape } as any;
        const controller = new AsyncController();

        const result = await profileStep().execute(doc, controller);

        expect(controller.result?.status).toBe("success");
        expect(pickShape).not.toHaveBeenCalled();
        expect(result!.nodes![0]).toBe(body);
        expect(result!.shapes).toEqual([planar]);
    });

    test("picks faces interactively when nothing usable is selected", async () => {
        mockSelection([], []);
        const picked = [faceData(sketch)];
        const pickShape = rs.fn((_prompt: any, _controller: any, _options?: any) => Promise.resolve(picked));
        doc.picker = { pickShape } as any;

        const result = await profileStep().execute(doc, new AsyncController());

        expect(pickShape).toHaveBeenCalledTimes(1);
        const options = pickShape.mock.calls[0][2] as any;
        expect(options.shapeType).toBe(ShapeTypes.face);
        expect(options.multi).toBe(false);
        // Only planar faces are pickable — solid press-pull needs a plane.
        const planar = { surface: () => ({ isPlanar: () => true }) };
        const curved = { surface: () => ({ isPlanar: () => false }) };
        expect(options.shapeFilter.allow(planar, Matrix4.identity())).toBe(true);
        expect(options.shapeFilter.allow(curved, Matrix4.identity())).toBe(false);
        expect(result!.nodes![0]).toBe(sketch);
        expect(result!.shapes).toBe(picked);
        // A sketch drawn on a solid face is coplanar with it, so the viewport reports the
        // two in an order that flips as the pointer moves: the sketch has to lead.
        const bodyFace = faceData(new ParametricBodyNode({ document: doc, features: [] }));
        const sketchFace = faceData(sketch);
        expect(options.sortDetected([bodyFace, sketchFace])).toEqual([sketchFace, bodyFace]);
    });

    test("the interactive filter allows sketches and parametric bodies", async () => {
        mockSelection([], []);
        const pickShape = rs.fn((_prompt: any, _controller: any, _options?: any) => Promise.resolve([]));
        doc.picker = { pickShape } as any;

        await profileStep().execute(doc, new AsyncController());

        const allow = (pickShape.mock.calls[0][2] as any).nodeFilter.allow;
        expect(allow(sketch)).toBe(true);
        expect(allow(other)).toBe(true);
        expect(allow(new ParametricBodyNode({ document: doc, features: [] }))).toBe(true);
        expect(allow({})).toBe(false);
    });

    test("an empty interactive pick cancels the command", async () => {
        mockSelection([], []);
        doc.picker = { pickShape: rs.fn(() => Promise.resolve([])) } as any;

        const result = await profileStep().execute(doc, new AsyncController());

        expect(result).toBeUndefined();
    });
});

describe("ExtrudeFeatureCommand depth drag", () => {
    /**
     * Whether the drag step stands down. It is the one thing between a hand-off and a second drag:
     * Press Pull's gesture IS the depth, and asking for it again is the same gesture twice.
     */
    const dragStandsDown = (cmd: ExtrudeFeatureCommand) => {
        const steps = (cmd as any).getSteps() as IStep[];
        return (steps[1] as any).shouldSkip() as boolean;
    };

    test("a settled hand-off that brought a depth is not dragged again", () => {
        const cmd = new ExtrudeFeatureCommand();
        cmd.pickSettled = true;
        cmd.depth = 5;

        expect(dragStandsDown(cmd)).toBe(true);
    });

    test("a settled hand-off with no depth still drags — a whole sketch node measured none", () => {
        const cmd = new ExtrudeFeatureCommand();
        cmd.pickSettled = true;

        expect(cmd.depth).toBe(0);
        expect(dragStandsDown(cmd)).toBe(false);
    });

    test("a launch of its own drags even with a depth remembered from the last one", () => {
        const cmd = new ExtrudeFeatureCommand();
        cmd.depth = 5;

        expect(dragStandsDown(cmd)).toBe(false);
    });
});

describe("ExtrudeFeatureCommand consumption", () => {
    const previewSketch = () =>
        new SketchNode({
            document: new TestDocument(),
            plane: Plane.XY,
            data: { entities: [], constraints: [] },
        });

    test("the drag preview meshes the prism's solid faces and outline edges", () => {
        const faceMesh = {
            range: [],
            index: new Uint32Array(),
            position: new Float32Array(),
            normal: new Float32Array(),
            uv: new Float32Array(),
        };
        const edgeMesh = { range: [], lineType: "solid", position: new Float32Array() };
        const prism = { dispose: rs.fn(), mesh: { faces: faceMesh, edges: edgeMesh } };
        const prismFn = rs.fn(() => Result.ok(prism));
        const restoreFactory = mockShapeFactory({ prism: prismFn });
        try {
            const cmd = new ExtrudeFeatureCommand();
            const face = { shapeType: ShapeTypes.face };
            const state = {
                dist: 5,
                normal: XYZ.unitZ,
                faces: [{ shape: face, transform: Matrix4.identity() }],
                node: previewSketch(),
            };

            const meshes = (cmd as any).buildPreview(state);

            expect(meshes.meshes).toEqual([faceMesh, edgeMesh]);
            // No operation: nothing to stand in for, so nothing is hidden.
            expect(meshes.hide).toBeUndefined();
            expect(prismFn).toHaveBeenCalledWith(face, new XYZ({ x: 0, y: 0, z: 5 }));
            expect(prism.dispose).toHaveBeenCalled();
        } finally {
            restoreFactory();
        }
    });

    test("a draft angle tapers the preview's side faces", () => {
        const faceMesh = {
            range: [],
            index: new Uint32Array(),
            position: new Float32Array(),
            normal: new Float32Array(),
            uv: new Float32Array(),
        };
        const profile = {
            shapeType: ShapeTypes.face,
            normal: () => [new XYZ({ x: 0, y: 0, z: 0 }), XYZ.unitZ],
            dispose: () => {},
        };
        // A side spans both end planes; a cap would have all its vertices on one.
        const side = {
            shapeType: ShapeTypes.face,
            findSubShapes: () => [
                { point: () => new XYZ({ x: 0, y: 0, z: 0 }) },
                { point: () => new XYZ({ x: 0, y: 0, z: 5 }) },
            ],
        };
        const prism = {
            dispose: rs.fn(),
            findSubShapes: (type: ShapeType) => (type === ShapeTypes.face ? [side] : []),
        };
        const tapered = { dispose: rs.fn(), mesh: { faces: faceMesh, edges: undefined } };
        const draftFn = rs.fn(() => Result.ok(tapered));
        const restoreFactory = mockShapeFactory({
            prism: () => Result.ok(prism),
            draft: draftFn,
        });
        try {
            const cmd = new ExtrudeFeatureCommand();
            cmd.draftAngle = 5;

            const preview = (cmd as any).buildPreview({
                dist: 5,
                normal: XYZ.unitZ,
                faces: [{ shape: profile, transform: Matrix4.identity() }],
                node: previewSketch(),
            });

            expect(draftFn).toHaveBeenCalledTimes(1);
            const [shape, sides, pull, angle] = draftFn.mock.calls[0] as any[];
            expect(shape).toBe(prism);
            expect(sides).toEqual([side]);
            expect((pull as XYZ).isEqualTo(XYZ.unitZ)).toBe(true);
            expect(angle).toBe(5);
            expect(prism.dispose).toHaveBeenCalled();
            expect(preview.meshes).toEqual([faceMesh]);
        } finally {
            restoreFactory();
        }
    });

    test("an out-of-range draft previews straight sides instead of throwing", () => {
        const faceMesh = {
            range: [],
            index: new Uint32Array(),
            position: new Float32Array(),
            normal: new Float32Array(),
            uv: new Float32Array(),
        };
        const prism = { dispose: rs.fn(), mesh: { faces: faceMesh, edges: undefined } };
        // The feature rejects |angle| ≥ 90 with a report; the kernel would raise instead.
        const draftFn = rs.fn(() => Result.err("kernel refuses the angle"));
        const restoreFactory = mockShapeFactory({ prism: () => Result.ok(prism), draft: draftFn });
        try {
            const cmd = new ExtrudeFeatureCommand();
            cmd.draftAngle = 95;

            const preview = (cmd as any).buildPreview({
                dist: 5,
                normal: XYZ.unitZ,
                faces: [{ shape: { shapeType: ShapeTypes.face }, transform: Matrix4.identity() }],
                node: previewSketch(),
            });

            expect(draftFn).not.toHaveBeenCalled();
            expect(preview.meshes).toEqual([faceMesh]);
        } finally {
            restoreFactory();
        }
    });

    test("the drag preview fuses touching profiles into one solid", () => {
        const fusedMesh = {
            range: [],
            index: new Uint32Array(),
            position: new Float32Array(),
            normal: new Float32Array(),
            uv: new Float32Array(),
        };
        const touchingBox = () => new BoundingBox({ x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 2 });
        const prismA = { dispose: rs.fn(), boundingBox: touchingBox };
        const prismB = { dispose: rs.fn(), boundingBox: touchingBox };
        const prisms = [prismA, prismB];
        const fused = { dispose: rs.fn(), mesh: { faces: fusedMesh, edges: undefined } };
        const fuseFn = rs.fn(() => Result.ok(fused));
        const restoreFactory = mockShapeFactory({
            prism: rs.fn(() => Result.ok(prisms.shift())),
            booleanFuse: fuseFn,
        });
        try {
            const cmd = new ExtrudeFeatureCommand();
            const state = {
                dist: 5,
                normal: XYZ.unitZ,
                faces: [
                    { shape: { shapeType: ShapeTypes.face }, transform: Matrix4.identity() },
                    { shape: { shapeType: ShapeTypes.face }, transform: Matrix4.identity() },
                ],
                node: previewSketch(),
            };

            const meshes = (cmd as any).buildPreview(state);

            expect(fuseFn).toHaveBeenCalledTimes(1);
            // the fuse disposes the inputs; the merged shape is disposed after meshing
            expect(prismA.dispose).toHaveBeenCalled();
            expect(prismB.dispose).toHaveBeenCalled();
            expect(fused.dispose).toHaveBeenCalled();
            expect(meshes.meshes).toEqual([fusedMesh]);
        } finally {
            restoreFactory();
        }
    });

    test("a symmetric preview sweeps both directions", () => {
        const fusedMesh = {
            range: [],
            index: new Uint32Array(),
            position: new Float32Array(),
            normal: new Float32Array(),
            uv: new Float32Array(),
        };
        const touchingBox = () => new BoundingBox({ x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 2 });
        const prisms = [
            { dispose: rs.fn(), boundingBox: touchingBox },
            { dispose: rs.fn(), boundingBox: touchingBox },
        ];
        const fused = { dispose: rs.fn(), mesh: { faces: fusedMesh, edges: undefined } };
        const prismFn = rs.fn((_face: any, _vec: XYZ) => Result.ok(prisms.shift()));
        const restoreFactory = mockShapeFactory({
            prism: prismFn,
            booleanFuse: rs.fn(() => Result.ok(fused)),
        });
        try {
            const cmd = new ExtrudeFeatureCommand();
            cmd.symmetric = true;
            const state = {
                dist: 5,
                normal: XYZ.unitZ,
                faces: [{ shape: { shapeType: ShapeTypes.face }, transform: Matrix4.identity() }],
                node: previewSketch(),
            };

            const meshes = (cmd as any).buildPreview(state);

            expect(prismFn).toHaveBeenCalledTimes(2);
            expect((prismFn.mock.calls[0][1] as XYZ).z).toBeCloseTo(5);
            expect((prismFn.mock.calls[1][1] as XYZ).z).toBeCloseTo(-5);
            expect(meshes.meshes).toEqual([fusedMesh]);
        } finally {
            restoreFactory();
        }
    });

    test("a join operation previews the boolean result against the target body", () => {
        const faceMesh = {
            range: [],
            index: new Uint32Array(),
            position: new Float32Array(),
            normal: new Float32Array(),
            uv: new Float32Array(),
        };
        const touchingBox = () => new BoundingBox({ x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 2 });
        const prism = { dispose: rs.fn(), boundingBox: touchingBox };
        const booleanResult = { dispose: rs.fn(), mesh: { faces: faceMesh, edges: undefined } };
        const fuseFn = rs.fn(() => Result.ok(booleanResult));
        const restoreFactory = mockShapeFactory({
            prism: rs.fn(() => Result.ok(prism)),
            booleanFuse: fuseFn,
        });
        try {
            const app = createMockApplication();
            const doc = new TestDocument({ application: app });
            (app as any).activeView = { document: doc };
            const target = new ParametricBodyNode({ document: doc, features: [] });
            (target as any)._shape = Result.ok({
                shapeType: ShapeTypes.solid,
                isEqual: () => false,
                boundingBox: touchingBox,
            });
            doc.modelManager.addNode(target);

            const cmd = new ExtrudeFeatureCommand();
            (cmd as any)._application = app;
            cmd.operation = "option.command.operation.join";
            const state = {
                dist: 5,
                normal: XYZ.unitZ,
                faces: [{ shape: { shapeType: ShapeTypes.face }, transform: Matrix4.identity() }],
                node: new SketchNode({
                    document: doc,
                    plane: Plane.XY,
                    data: { entities: [], constraints: [] },
                }),
            };

            const preview = (cmd as any).buildPreview(state);

            expect(fuseFn).toHaveBeenCalledTimes(1);
            // The result stands in for the body it was built from: the drag step hides
            // that node, so the preview is not drawn over geometry it duplicates.
            expect(preview.hide).toEqual([target]);
            expect(preview.meshes).toEqual([faceMesh]);
            expect(prism.dispose).toHaveBeenCalled();
            expect(booleanResult.dispose).toHaveBeenCalled();
        } finally {
            restoreFactory();
        }
    });

    test("a cut previews the result and ghosts the removed tool in red", () => {
        const faceMesh = {
            range: [],
            index: new Uint32Array(),
            position: new Float32Array(),
            normal: new Float32Array(),
            uv: new Float32Array(),
        };
        const toolFaces = { range: [], color: 0 };
        const toolEdges = { range: [], lineType: "solid", position: new Float32Array(), color: 0 };
        const touchingBox = () => new BoundingBox({ x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 2 });
        const prism = {
            dispose: rs.fn(),
            boundingBox: touchingBox,
            mesh: { faces: toolFaces, edges: toolEdges },
        };
        const booleanResult = { dispose: rs.fn(), mesh: { faces: faceMesh, edges: undefined } };
        const cutFn = rs.fn(() => Result.ok(booleanResult));
        const restoreFactory = mockShapeFactory({
            prism: rs.fn(() => Result.ok(prism)),
            booleanCut: cutFn,
        });
        try {
            const app = createMockApplication();
            const doc = new TestDocument({ application: app });
            (app as any).activeView = { document: doc };
            const target = new ParametricBodyNode({ document: doc, features: [] });
            (target as any)._shape = Result.ok({
                shapeType: ShapeTypes.solid,
                isEqual: () => false,
                boundingBox: touchingBox,
            });
            doc.modelManager.addNode(target);

            const cmd = new ExtrudeFeatureCommand();
            (cmd as any)._application = app;
            cmd.operation = "option.command.operation.cut";
            const state = {
                dist: 5,
                normal: XYZ.unitZ,
                faces: [{ shape: { shapeType: ShapeTypes.face }, transform: Matrix4.identity() }],
                node: new SketchNode({
                    document: doc,
                    plane: Plane.XY,
                    data: { entities: [], constraints: [] },
                }),
            };

            const preview = (cmd as any).buildPreview(state);

            expect(cutFn).toHaveBeenCalledTimes(1);
            expect(preview.meshes).toEqual([faceMesh]);
            expect(preview.hide).toEqual([target]);
            // The removed volume is empty space in the result, so the tool is ghosted
            // over it — red, the "this goes away" colour.
            expect(preview.overlays).toEqual([toolFaces, toolEdges]);
            expect(toolFaces.color).toBe(0xff4d4d);
            expect(toolEdges.color).toBe(0xff4d4d);
        } finally {
            restoreFactory();
        }
    });

    test("a join previews a moved target where the body is, not at its own origin", () => {
        const faceMesh = {
            range: [],
            index: new Uint32Array(),
            position: new Float32Array(),
            normal: new Float32Array(),
            uv: new Float32Array(),
        };
        const movedBox = () => new BoundingBox({ x: 100, y: 0, z: 0 }, { x: 102, y: 2, z: 2 });
        // The prism sits where the moved body is, so the auto-detection pairs the two.
        const prism = { dispose: rs.fn(), boundingBox: movedBox };
        const booleanResult = { dispose: rs.fn(), mesh: { faces: faceMesh, edges: undefined } };
        const fuseFn = rs.fn((_targets: IShape[], _tools: IShape[]) => Result.ok(booleanResult));
        const restoreFactory = mockShapeFactory({
            prism: rs.fn(() => Result.ok(prism)),
            booleanFuse: fuseFn,
        });
        try {
            const app = createMockApplication();
            const doc = new TestDocument({ application: app });
            (app as any).activeView = { document: doc };
            const target = new ParametricBodyNode({ document: doc, features: [] });
            const local = {
                shapeType: ShapeTypes.solid,
                isEqual: () => false,
                boundingBox: () => new BoundingBox({ x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 2 }),
                dispose: rs.fn(),
            };
            const world = {
                shapeType: ShapeTypes.solid,
                isEqual: () => false,
                boundingBox: movedBox,
                dispose: rs.fn(),
            };
            (local as any).transformedMul = rs.fn(() => world);
            (target as any)._shape = Result.ok(local);
            target.transform = Matrix4.fromTranslation(100, 0, 0);
            doc.modelManager.addNode(target);

            const cmd = new ExtrudeFeatureCommand();
            (cmd as any)._application = app;
            cmd.operation = "option.command.operation.join";
            const state = {
                dist: 5,
                normal: XYZ.unitZ,
                faces: [{ shape: { shapeType: ShapeTypes.face }, transform: Matrix4.identity() }],
                node: new SketchNode({
                    document: doc,
                    plane: Plane.XY,
                    data: { entities: [], constraints: [] },
                }),
            };

            (cmd as any).buildPreview(state);

            // The prism is world-space (see `previewFaces`), so the body it is booleaned
            // against has to be moved out there too — the commit runs the same boolean in
            // the body's own space instead, and a rigid transform commutes with it.
            expect((local as any).transformedMul).toHaveBeenCalledWith(target.transform);
            expect(fuseFn.mock.calls[0][0]).toEqual([world]);
            // The moved copy is the preview's, freed once the kernel has read it.
            expect(world.dispose).toHaveBeenCalled();
        } finally {
            restoreFactory();
        }
    });

    /**
     * Sketch/prism/boolean mocks where every prism carries a bounding box from
     * `boxAt(callIndex)`, so intersection auto-detection can be steered per call.
     */
    function joinScenario(boxAt: (call: number) => BoundingBox) {
        let prismCalls = 0;
        const fusedShape = {
            shapeType: ShapeTypes.solid,
            isEqual: () => false,
            dispose: rs.fn(),
            findSubShapes: () => [],
            mesh: { edges: { range: [] } },
        };
        const restoreFactory = mockShapeFactory({
            line: (start: XYZ, end: XYZ) =>
                Result.ok({
                    shapeType: ShapeTypes.edge,
                    curve: { nearestFromPoint: (point: XYZ) => nearestOnSegment(start, end, point) },
                    startPoint: () => start,
                    endPoint: () => end,
                    firstParameter: () => 0,
                    lastParameter: () => 1,
                    pointAt: (t: number) => start.add(end.sub(start).multiply(t)),
                    intersect: () => [],
                    boundingBox: () =>
                        new BoundingBox(
                            {
                                x: Math.min(start.x, end.x),
                                y: Math.min(start.y, end.y),
                                z: Math.min(start.z, end.z),
                            },
                            {
                                x: Math.max(start.x, end.x),
                                y: Math.max(start.y, end.y),
                                z: Math.max(start.z, end.z),
                            },
                        ),
                    isEqual: () => false,
                }),
            combine: (edges: any[]) =>
                Result.ok({
                    shapeType: ShapeTypes.compound,
                    isEqual: () => false,
                    dispose: () => {},
                    findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? edges : []),
                }),
            wire: (edges: any[]) => Result.ok({ isClosed: () => edges.length > 1, edges }),
            face: (wires: any[]) =>
                Result.ok({
                    shapeType: ShapeTypes.face,
                    isEqual: () => false,
                    findSubShapes: (type: ShapeType) =>
                        type === ShapeTypes.edge ? wires.flatMap((w: any) => w.edges) : [],
                    area: () => 0,
                    boundingBox: () => BoundingBox.zero,
                }),
            prism: () => {
                const box = boxAt(prismCalls++);
                return Result.ok({
                    shapeType: ShapeTypes.solid,
                    isEqual: () => false,
                    dispose: () => {},
                    findSubShapes: () => [],
                    boundingBox: () => box,
                    mesh: { edges: { range: [] } },
                });
            },
            booleanFuse: () => Result.ok(fusedShape),
        });
        const app = createMockApplication();
        const doc = new TestDocument({ application: app });
        (app as any).activeView = { document: doc };
        const square: SketchData = {
            entities: [
                { id: 1, type: "line", params: [0, 0, 1, 0] },
                { id: 2, type: "line", params: [1, 0, 1, 1] },
                { id: 3, type: "line", params: [1, 1, 0, 1] },
                { id: 4, type: "line", params: [0, 1, 0, 0] },
            ],
            constraints: [],
        };
        const sketch = new SketchNode({ document: doc, plane: Plane.XY, data: square });
        doc.modelManager.addNode(sketch);
        const targetSketch = new SketchNode({ document: doc, plane: Plane.XY, data: square });
        doc.modelManager.addNode(targetSketch);
        const target = new ParametricBodyNode({
            document: doc,
            features: [{ id: "t1", type: "extrude", sketchId: targetSketch.id, depth: 2 }],
        });
        doc.modelManager.addNode(target);

        const cmd = new ExtrudeFeatureCommand();
        (cmd as any)._application = app;
        cmd.operation = "option.command.operation.join";
        cmd.depth = 5;
        (cmd as any).stepDatas = [
            { shapes: [], nodes: [sketch], type: "shape" },
            {
                shapes: [],
                nodes: [sketch],
                point: new XYZ({ x: 0, y: 0, z: 5 }),
                plane: Plane.XY,
                type: "input",
            },
        ];
        return { restoreFactory, doc, sketch, target, cmd };
    }

    test("join appends the extrude feature to the intersecting body instead of creating one", () => {
        const near = new BoundingBox({ x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 2 });
        const { restoreFactory, doc, sketch, target, cmd } = joinScenario(() => near);
        try {
            const addNode = rs.spyOn(doc.modelManager, "addNode");

            (cmd as any).executeMainTask();

            // No new body: the feature grows on the intersecting target, fused with its shape.
            expect(addNode).not.toHaveBeenCalled();
            expect(target.features.length).toBe(2);
            expect(target.features[1]).toMatchObject({
                type: "extrude",
                sketchId: sketch.id,
                depth: 5,
                operation: "fuse",
            });
            expect(sketch.visible).toBe(false);
            expect(target.shape.isOk).toBe(true);

            doc.history.undo();
            expect(target.features.length).toBe(1);
            expect(sketch.visible).toBe(true);
        } finally {
            restoreFactory();
        }
    });

    /** A second body sitting exactly where the first one does, so a tool meets both. */
    function secondTarget(doc: TestDocument, box: BoundingBox) {
        const body = new ParametricBodyNode({ document: doc, features: [] });
        (body as any)._shape = Result.ok({
            shapeType: ShapeTypes.solid,
            isEqual: () => false,
            dispose: () => {},
            findSubShapes: () => [],
            boundingBox: () => box,
        });
        doc.modelManager.addNode(body);
        return body;
    }

    test("every run starts on auto-detection, whatever the last one left behind", () => {
        const near = new BoundingBox({ x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 2 });
        const { restoreFactory, cmd } = joinScenario(() => near);
        try {
            cmd.targets = { auto: false, ids: ["stale"] };
            const seen: TargetSelection[] = [];
            cmd.onPropertyChanged((property) => {
                if (property === "targets") seen.push(cmd.targets);
            });

            (cmd as any).beforeExecute();

            // The option cache restores this command's own last run too, so a set left
            // over from it must not decide this one. The write goes out as a change,
            // which is what repaints the panel's list.
            expect(cmd.targets).toEqual(AUTO_TARGETS);
            expect(seen).toEqual([AUTO_TARGETS]);
        } finally {
            restoreFactory();
        }
    });

    test("join appends the feature to every body the tool meets", () => {
        const near = new BoundingBox({ x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 2 });
        const { restoreFactory, doc, target, cmd } = joinScenario(() => near);
        const second = secondTarget(doc, near);
        try {
            (cmd as any).executeMainTask();

            // Both bodies were in the way, so both get the feature and both combine with it.
            expect(target.features).toHaveLength(2);
            expect(second.features).toHaveLength(1);
            expect(second.features[0]).toMatchObject({ type: "extrude", operation: "fuse" });
        } finally {
            restoreFactory();
        }
    });

    test("a chosen target replaces what the detection would have picked", () => {
        const near = new BoundingBox({ x: 0, y: 0, z: 0 }, { x: 2, y: 2, z: 2 });
        const far = new BoundingBox({ x: 50, y: 0, z: 0 }, { x: 52, y: 2, z: 2 });
        const { restoreFactory, doc, target, cmd } = joinScenario(() => near);
        // Out of the tool's way — only the user naming it can bring it in.
        const named = secondTarget(doc, far);
        cmd.targets = { auto: false, ids: [named.id] };
        try {
            (cmd as any).executeMainTask();

            expect(named.features).toHaveLength(1);
            expect(named.features[0]).toMatchObject({ operation: "fuse" });
            // The detecting body is left alone: the choice is the user's.
            expect(target.features).toHaveLength(1);
        } finally {
            restoreFactory();
        }
    });

    test("join without an intersecting body creates a standalone body", () => {
        const near = new BoundingBox({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 1 });
        const far = new BoundingBox({ x: 100, y: 100, z: 100 }, { x: 101, y: 101, z: 101 });
        // The first prism builds the target body; the command's own prisms are far away.
        const { restoreFactory, doc, sketch, target, cmd } = joinScenario((call) =>
            call === 0 ? near : far,
        );
        try {
            (cmd as any).executeMainTask();

            expect(target.features.length).toBe(1);
            const created = doc.modelManager.findNode(
                (node) => node instanceof ParametricBodyNode && node !== target,
            ) as ParametricBodyNode;
            expect(created).not.toBeUndefined();
            expect((created.features[0] as ExtrudeFeatureData).operation).toBeUndefined();
            expect(sketch.visible).toBe(false);
        } finally {
            restoreFactory();
        }
    });

    test("creating the body hides the consumed sketch and undo restores it", () => {
        const restoreFactory = mockShapeFactory({
            line: (start: XYZ, end: XYZ) =>
                Result.ok({
                    shapeType: ShapeTypes.edge,
                    curve: { nearestFromPoint: (point: XYZ) => nearestOnSegment(start, end, point) },
                    startPoint: () => start,
                    endPoint: () => end,
                    firstParameter: () => 0,
                    lastParameter: () => 1,
                    pointAt: (t: number) => start.add(end.sub(start).multiply(t)),
                    intersect: () => [],
                    boundingBox: () =>
                        new BoundingBox(
                            {
                                x: Math.min(start.x, end.x),
                                y: Math.min(start.y, end.y),
                                z: Math.min(start.z, end.z),
                            },
                            {
                                x: Math.max(start.x, end.x),
                                y: Math.max(start.y, end.y),
                                z: Math.max(start.z, end.z),
                            },
                        ),
                    isEqual: () => false,
                }),
            combine: (edges: any[]) =>
                Result.ok({
                    shapeType: ShapeTypes.compound,
                    isEqual: () => false,
                    dispose: () => {},
                    findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? edges : []),
                }),
            wire: (edges: any[]) => Result.ok({ isClosed: () => edges.length > 1, edges }),
            face: (wires: any[]) =>
                Result.ok({
                    shapeType: ShapeTypes.face,
                    isEqual: () => false,
                    findSubShapes: (type: ShapeType) =>
                        type === ShapeTypes.edge ? wires.flatMap((w: any) => w.edges) : [],
                    area: () => 0,
                    boundingBox: () => BoundingBox.zero,
                }),
            prism: () =>
                Result.ok({
                    shapeType: ShapeTypes.solid,
                    isEqual: () => false,
                    dispose: () => {},
                    findSubShapes: () => [],
                    mesh: { edges: { range: [] } },
                }),
        });
        try {
            const app = createMockApplication();
            const doc = new TestDocument({ application: app });
            (app as any).activeView = { document: doc };
            const square: SketchData = {
                entities: [
                    { id: 1, type: "line", params: [0, 0, 1, 0] },
                    { id: 2, type: "line", params: [1, 0, 1, 1] },
                    { id: 3, type: "line", params: [1, 1, 0, 1] },
                    { id: 4, type: "line", params: [0, 1, 0, 0] },
                ],
                constraints: [],
            };
            const sketch = new SketchNode({ document: doc, plane: Plane.XY, data: square });
            doc.modelManager.addNode(sketch);

            const cmd = new ExtrudeFeatureCommand();
            (cmd as any)._application = app;
            cmd.depth = 5;
            (cmd as any).stepDatas = [
                { shapes: [], nodes: [sketch], type: "shape" },
                {
                    shapes: [],
                    nodes: [sketch],
                    point: new XYZ({ x: 0, y: 0, z: 5 }),
                    plane: Plane.XY,
                    type: "input",
                },
            ];

            (cmd as any).executeMainTask();

            expect(sketch.visible).toBe(false);

            doc.history.undo();
            expect(sketch.visible).toBe(true);
        } finally {
            restoreFactory();
        }
    });

    /**
     * A parametric body whose mocked shape exposes one planar top face (unit square at
     * height z=2), plus the face pick data as the viewport would report it.
     */
    function bodyFaceScenario() {
        const edgeOf = (start: XYZ, end: XYZ) => ({
            shapeType: ShapeTypes.edge,
            curve: { basisCurve: { direction: end.sub(start).normalize() } },
            startPoint: () => start,
            endPoint: () => end,
            isEqual: () => false,
        });
        const edges = [
            edgeOf(new XYZ({ x: 0, y: 0, z: 2 }), new XYZ({ x: 1, y: 0, z: 2 })),
            edgeOf(new XYZ({ x: 1, y: 0, z: 2 }), new XYZ({ x: 1, y: 1, z: 2 })),
            edgeOf(new XYZ({ x: 1, y: 1, z: 2 }), new XYZ({ x: 0, y: 1, z: 2 })),
            edgeOf(new XYZ({ x: 0, y: 1, z: 2 }), new XYZ({ x: 0, y: 0, z: 2 })),
        ];
        const topFace = {
            shapeType: ShapeTypes.face,
            isEqual: () => false,
            dispose: rs.fn(),
            normal: () => [new XYZ({ x: 0, y: 0, z: 2 }), XYZ.unitZ],
            findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? edges : []),
            outerWire: () => ({
                findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? edges : []),
            }),
            area: () => 0,
            boundingBox: () => BoundingBox.zero,
        };
        const bodyShape = {
            shapeType: ShapeTypes.solid,
            isEqual: () => false,
            dispose: rs.fn(),
            boundingBox: () => new BoundingBox({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 2 }),
            findSubShapes: (type: ShapeType) => (type === ShapeTypes.face ? [topFace] : []),
        };
        const prismShape = {
            shapeType: ShapeTypes.solid,
            isEqual: () => false,
            dispose: rs.fn(),
            boundingBox: () => new BoundingBox({ x: 0, y: 0, z: 1 }, { x: 1, y: 1, z: 7 }),
            findSubShapes: () => [],
            mesh: { edges: { range: [] } },
        };
        const restoreFactory = mockShapeFactory({
            combine: () => Result.ok(bodyShape),
            prism: () => Result.ok(prismShape),
            booleanFuse: () => Result.ok(prismShape),
        });
        const app = createMockApplication();
        const doc = new TestDocument({ application: app });
        (app as any).activeView = { document: doc };
        const body = new ParametricBodyNode({ document: doc, features: [] });
        doc.modelManager.addNode(body);
        const picked = {
            shape: topFace,
            owner: { node: body },
            transform: Matrix4.identity(),
            indexes: [0],
            point: new XYZ({ x: 0.5, y: 0.5, z: 2 }),
        } as any;
        const cmd = new ExtrudeFeatureCommand();
        (cmd as any)._application = app;
        cmd.depth = 7;
        (cmd as any).stepDatas = [
            { shapes: [picked], nodes: [body], type: "shape" },
            {
                shapes: [picked],
                nodes: [body],
                point: new XYZ({ x: 0.5, y: 0.5, z: 7 }),
                plane: Plane.XY,
                type: "input",
            },
        ];
        return { restoreFactory, doc, body, topFace, cmd };
    }

    test("a body face extrudes into a standalone body only when New Body is asked for", () => {
        const { restoreFactory, doc, body, cmd } = bodyFaceScenario();
        try {
            // The prism of a face pick always meets the body it stands on, so the push-pull
            // reading (here, at the commit) answers join — a standalone body is the explicit
            // choice now, not the default.
            cmd.operation = "option.command.operation.new";
            (cmd as any).executeMainTask();

            const created = doc.modelManager.findNode(
                (node) => node instanceof ParametricBodyNode && node !== body,
            ) as ParametricBodyNode;
            expect(created).not.toBeUndefined();
            const feature = created.features[0] as ExtrudeFeatureData;
            expect(feature.sketchId).toBeUndefined();
            expect(feature.depth).toBe(7);
            expect(feature.source?.nodeId).toBe(body.id);
            expect(feature.source?.profiles.length).toBe(1);
            // The source body is not consumed — only sketches are hidden.
            expect(body.visible).toBe(true);
            expect(created.shape.isOk).toBe(true);
        } finally {
            restoreFactory();
        }
    });

    test("a start offset is recorded on the committed feature", () => {
        const { restoreFactory, doc, body, cmd } = bodyFaceScenario();
        try {
            cmd.startOffset = 3;

            (cmd as any).executeMainTask();

            const created = doc.modelManager.findNode(
                (node) => node instanceof ParametricBodyNode && node !== body,
            ) as ParametricBodyNode;
            expect((created.features[0] as ExtrudeFeatureData).startOffset).toBe(3);
        } finally {
            restoreFactory();
        }
    });

    test("join on a body face appends the feature to the intersecting owner body", () => {
        const { restoreFactory, doc, body, cmd } = bodyFaceScenario();
        try {
            cmd.operation = "option.command.operation.join";
            const addNode = rs.spyOn(doc.modelManager, "addNode");

            (cmd as any).executeMainTask();

            expect(addNode).not.toHaveBeenCalled();
            expect(body.features.length).toBe(1);
            expect(body.features[0]).toMatchObject({
                type: "extrude",
                operation: "fuse",
                source: { nodeId: body.id },
            });
            expect(body.visible).toBe(true);

            doc.history.undo();
            expect(body.features.length).toBe(0);
        } finally {
            restoreFactory();
        }
    });
});

describe("ExtrudeFeatureCommand end condition", () => {
    test("defaults to blind — the depth is shown, the end offset hidden", () => {
        const cmd = new ExtrudeFeatureCommand();
        expect(cmd.endCondition).toBe("feature.extrude.endCondition.blind");
        expect(cmd.showDepth).toBe(true);
        expect(cmd.showEndOffset).toBe(false);
        expect(cmd.endOffset).toBe(0);
    });

    test("only blind shows the depth; the up-to conditions show the end offset", () => {
        const cmd = new ExtrudeFeatureCommand();
        cmd.endCondition = "feature.extrude.endCondition.throughAll";
        expect(cmd.showDepth).toBe(false);
        expect(cmd.showEndOffset).toBe(false);

        cmd.endCondition = "feature.extrude.endCondition.upToFace";
        expect(cmd.showDepth).toBe(false);
        expect(cmd.showEndOffset).toBe(true);

        cmd.endCondition = "feature.extrude.endCondition.upToVertex";
        expect(cmd.showDepth).toBe(false);
        expect(cmd.showEndOffset).toBe(true);

        cmd.endCondition = "feature.extrude.endCondition.blind";
        expect(cmd.showDepth).toBe(true);
        expect(cmd.showEndOffset).toBe(false);
    });

    test("the depth and end offset rows follow the visibility flags", () => {
        const cmd = new ExtrudeFeatureCommand();
        expect(PropertyUtils.getProperty(cmd, "depth")?.dependencies).toEqual([
            { property: "showDepth", value: true },
        ]);
        expect(PropertyUtils.getProperty(cmd, "endOffset")?.dependencies).toEqual([
            { property: "showEndOffset", value: true },
        ]);
    });

    test("an end-target pick runs as the last step", () => {
        const steps = (new ExtrudeFeatureCommand() as any).getSteps() as IStep[];
        expect(steps.length).toBe(3);
        expect(steps[2]).toBeInstanceOf(ExtrudeEndTargetStep);
    });

    test("switching to an up-to condition mid-drag ends the drag and reports a zero-depth placeholder", async () => {
        const arrowShape = () => ({
            isOk: true,
            value: { mesh: { faces: { range: [], position: new Float32Array() } }, dispose: () => {} },
        });
        const restoreFactory = mockShapeFactory({ cylinder: arrowShape, cone: arrowShape });
        try {
            const app = createMockApplication();
            const doc = new TestDocument({ application: app });
            doc.visual = createMockVisualWithDocument(doc);
            doc.selection = createMockSelection();
            const view = createHandlerMockView({ document: doc });
            (app as any).activeView = view;
            const sketch = new SketchNode({
                document: doc,
                plane: Plane.XY,
                data: { entities: [], constraints: [] },
            });
            doc.modelManager.addNode(sketch);

            let captured: ExtrudeDragHandler | undefined;
            doc.picker = {
                pickAsync: rs.fn((handler: ExtrudeDragHandler, _prompt: any, controller: AsyncController) => {
                    captured = handler;
                    return new Promise<void>((resolve) => {
                        controller.onCompleted(() => resolve());
                        controller.onCancelled(() => resolve());
                        controller.onFailed(() => resolve());
                    });
                }),
            } as any;

            const cmd = new ExtrudeFeatureCommand();
            (cmd as any)._application = app;
            (cmd as any).stepDatas = [{ shapes: [], nodes: [sketch], type: "shape" }];
            const dragStep = (cmd as any).getSteps()[1] as IStep;
            const controller = new AsyncController();
            const promise = dragStep.execute(doc, controller);
            expect(captured).toBeDefined();
            expect((cmd as any)._dragHandler).toBe(captured);

            // The dropdown flips while the arrow is up: the drag ends at once, at the
            // zero depth a just-started drag sits at — `finishEarly` must both bypass
            // the non-zero confirm gate and fall back to the active view (no pointer
            // ever landed), or the step would hang here / come back undefined.
            cmd.endCondition = "feature.extrude.endCondition.upToFace";

            const result = await promise;
            expect(controller.result?.status).toBe("success");
            expect(result?.type).toBe("input");
            expect(result?.distance).toBe(0);
            expect(result?.view).toBe(view);
            expect((cmd as any)._dragHandler).toBeUndefined();
        } finally {
            restoreFactory();
        }
    });
});

describe("ExtrudeEndTargetStep", () => {
    function stepScenario(endCondition: I18nKeys, picked: any[] = []) {
        const app = createMockApplication();
        const doc = new TestDocument({ application: app });
        (app as any).activeView = { document: doc };
        // Every pick round clears the selection first (Enter would otherwise confirm a
        // leftover), so the step needs a selection that can be cleared.
        doc.selection = createMockSelection();
        const pickShape = rs.fn((_prompt: any, _controller: any, _options?: any) => Promise.resolve(picked));
        doc.picker = { pickShape } as any;
        const cmd = new ExtrudeFeatureCommand();
        cmd.endCondition = endCondition;
        const step = (cmd as any).getSteps()[2] as ExtrudeEndTargetStep;
        return { doc, pickShape, step, cmd };
    }

    test.each([
        "feature.extrude.endCondition.blind",
        "feature.extrude.endCondition.throughAll",
    ] as const)("%s needs no target and passes through without picking", async (endCondition) => {
        const { doc, pickShape, step, cmd } = stepScenario(endCondition);
        cmd.depth = 5; // the depth the drag step produced (zero would re-offer the drag)
        const controller = new AsyncController();

        const result = await step.execute(doc, controller);

        expect(controller.result?.status).toBe("success");
        expect(result?.shapes).toEqual([]);
        expect(pickShape).not.toHaveBeenCalled();
    });

    test("upToFace picks a single face of any node", async () => {
        const node = { id: "target" };
        const picked = [
            {
                shape: { shapeType: ShapeTypes.face },
                owner: { node },
                transform: Matrix4.identity(),
                indexes: [0],
            },
        ];
        const { doc, pickShape, step } = stepScenario("feature.extrude.endCondition.upToFace", picked);

        const result = await step.execute(doc, new AsyncController());

        expect(pickShape).toHaveBeenCalledTimes(1);
        const [prompt, , options] = pickShape.mock.calls[0] as any[];
        expect(prompt).toBe("prompt.select.faces");
        expect(options.shapeType).toBe(ShapeTypes.face);
        expect(options.multi).toBe(false);
        // The click only aims the target; the bar's confirm ends the command.
        expect(options.finishOnClick).toBe(false);
        expect(result?.shapes).toBe(picked);
        expect(result?.nodes?.[0]).toBe(node);
    });

    test("upToVertex picks a single vertex", async () => {
        const node = { id: "target" };
        const picked = [
            {
                shape: { shapeType: ShapeTypes.vertex },
                owner: { node },
                transform: Matrix4.identity(),
                indexes: [0],
            },
        ];
        const { doc, pickShape, step } = stepScenario("feature.extrude.endCondition.upToVertex", picked);

        const result = await step.execute(doc, new AsyncController());

        const [prompt, , options] = pickShape.mock.calls[0] as any[];
        expect(prompt).toBe("prompt.select.vertexes");
        expect(options.shapeType).toBe(ShapeTypes.vertex);
        expect(options.finishOnClick).toBe(false);
        expect(result?.shapes).toBe(picked);
    });

    test("the target pick previews the aimed face and keeps the profiles highlighted", async () => {
        const prismVecs: XYZ[] = [];
        const restoreFactory = mockProfileFactory(prismVecs);
        try {
            const app = createMockApplication();
            const doc = new TestDocument({ application: app });
            (app as any).activeView = { document: doc };
            doc.visual = createMockVisualWithDocument(doc);
            const displayMesh = rs.fn((_meshes: any[], _options?: any) => 7);
            const removeMesh = rs.fn((_id?: number) => {});
            (doc.visual.context as any).displayMesh = displayMesh;
            (doc.visual.context as any).removeMesh = removeMesh;
            doc.selection = createMockSelection();
            const addState = rs.fn();
            const removeState = rs.fn();
            (doc.visual.highlighter as any).addState = addState;
            (doc.visual.highlighter as any).removeState = removeState;

            const sketch = new SketchNode({
                document: doc,
                plane: Plane.XY,
                data: { entities: [], constraints: [] },
            });
            doc.modelManager.addNode(sketch);
            const profile = sweptProfile(sketch);
            const target = targetFaceAt(sketch, 20);

            const cmd = new ExtrudeFeatureCommand();
            (cmd as any)._application = app;
            cmd.endCondition = "feature.extrude.endCondition.upToFace";
            // A cut: the prism is what the commit takes away, so the ghost is red.
            cmd.operation = "option.command.operation.cut";
            cmd.depth = 0;
            (cmd as any).stepDatas = [
                { shapes: [profile], nodes: [sketch], type: "shape" },
                { shapes: [profile], nodes: [sketch], point: XYZ.zero, plane: Plane.XY, type: "input" },
            ];
            const step = (cmd as any).getSteps()[2] as ExtrudeEndTargetStep;

            let resolvePick: ((shapes: any[]) => void) | undefined;
            doc.picker = {
                pickShape: rs.fn(() => new Promise<any[]>((resolve) => (resolvePick = resolve))),
            } as any;

            expect((cmd as any).upToTargetPreview(target)).toBeDefined();

            const running = step.execute(doc, new AsyncController());
            expect((step as any)._document).toBeDefined();

            // The click's selection — what the preview follows while the pick is open.
            doc.selection.onShapeChanged.emit([target]);

            expect(displayMesh).toHaveBeenCalledTimes(1);
            expect(prismVecs.at(-1)!.z).toBeCloseTo(20, 5);
            // The ghost drawn for a cut is the removed volume: red.
            expect((displayMesh.mock.calls[0][0] as any[])[0].color).toBe(0xff4d4d);
            expect(addState).toHaveBeenCalledWith(profile.owner, SELECTED_FACE_STATE, ShapeTypes.face, 0);

            resolvePick!([target]);
            const result = await running;

            expect(result?.shapes).toEqual([target]);
            // Both the preview mesh and the profiles' highlight come down with the round.
            expect(removeMesh).toHaveBeenCalledWith(7);
            expect(removeState).toHaveBeenCalledWith(profile.owner, SELECTED_FACE_STATE, ShapeTypes.face, 0);
        } finally {
            restoreFactory();
        }
    });

    test("a hovered target wins over a selection the pointer moved away from", async () => {
        const { doc, step, cmd } = stepScenario("feature.extrude.endCondition.upToFace");
        const clicked = {
            owner: { node: { id: "clicked" } },
            shape: { shapeType: ShapeTypes.face },
            indexes: [0],
        };
        const hovered = {
            owner: { node: { id: "hovered" } },
            shape: { shapeType: ShapeTypes.face },
            indexes: [1],
        };
        let settlePick!: () => void;
        let options: any;
        doc.picker = {
            pickShape: rs.fn((_prompt: any, controller: AsyncController, opts?: any) => {
                options = opts;
                // The real picker resolves only after the controller settles.
                return new Promise<any[]>((resolve) => {
                    settlePick = () => {
                        controller.success();
                        resolve([clicked]);
                    };
                });
            }),
        } as any;
        // The preview itself is not what is under test; keep the pick round headless.
        (cmd as any).upToTargetPreview = () => undefined;

        const running = step.execute(doc, new AsyncController());
        // The pointer settles on another face after the click: the preview follows it, so
        // the confirm must take it too.
        options.onDetect(hovered);
        settlePick();

        const result = await running;
        expect(result?.shapes).toEqual([hovered]);
    });

    test("an up-to target preview starts from the drag's final plane and faces", () => {
        const prismVecs: XYZ[] = [];
        const restoreFactory = mockProfileFactory(prismVecs);
        try {
            const app = createMockApplication();
            const doc = new TestDocument({ application: app });
            (app as any).activeView = { document: doc };
            const initial = new SketchNode({
                document: doc,
                plane: Plane.XY,
                data: { entities: [], constraints: [] },
            });
            const movedPlane = new Plane({
                origin: new XYZ({ x: 0, y: 0, z: 10 }),
                normal: XYZ.unitZ,
                xvec: XYZ.unitX,
            });
            const moved = new SketchNode({
                document: doc,
                plane: movedPlane,
                data: { entities: [], constraints: [] },
            });
            doc.modelManager.addNode(initial);
            doc.modelManager.addNode(moved);

            const cmd = new ExtrudeFeatureCommand();
            (cmd as any)._application = app;
            cmd.endCondition = "feature.extrude.endCondition.upToFace";
            cmd.depth = 0;
            (cmd as any).stepDatas = [
                { shapes: [sweptProfile(initial)], nodes: [initial], type: "shape" },
                // The drag switched target: these are its final faces and plane, and the
                // commit reads them — so the preview must too.
                {
                    shapes: [sweptProfile(moved)],
                    nodes: [moved],
                    point: new XYZ({ x: 0, y: 0, z: 10 }),
                    plane: movedPlane,
                    type: "input",
                },
            ];

            expect((cmd as any).upToTargetPreview(targetFaceAt(moved, 20))).toBeDefined();

            // 20 - 10: the preview runs from the moved plane, not the original one.
            expect(prismVecs.at(-1)!.z).toBeCloseTo(10, 5);
        } finally {
            restoreFactory();
        }
    });

    test("an opposite-direction target preview sweeps the picked side", () => {
        const prismVecs: XYZ[] = [];
        const restoreFactory = mockProfileFactory(prismVecs);
        try {
            const app = createMockApplication();
            const doc = new TestDocument({ application: app });
            (app as any).activeView = { document: doc };
            const sketch = new SketchNode({
                document: doc,
                plane: Plane.XY,
                data: { entities: [], constraints: [] },
            });
            doc.modelManager.addNode(sketch);
            const profile = sweptProfile(sketch);

            const cmd = new ExtrudeFeatureCommand();
            (cmd as any)._application = app;
            cmd.endCondition = "feature.extrude.endCondition.upToFace";
            cmd.depth = 0;
            cmd.oppositeDirection = true;
            (cmd as any).stepDatas = [
                { shapes: [profile], nodes: [sketch], type: "shape" },
                { shapes: [profile], nodes: [sketch], point: XYZ.zero, plane: Plane.XY, type: "input" },
            ];

            expect((cmd as any).upToTargetPreview(targetFaceAt(sketch, -20))).toBeDefined();

            // The checkbox flips the sweep: the prism runs to the target below the plane.
            expect(prismVecs.at(-1)!.z).toBeCloseTo(-20, 5);
        } finally {
            restoreFactory();
        }
    });

    test("an empty pick cancels the command", async () => {
        const { doc, step } = stepScenario("feature.extrude.endCondition.upToFace");
        const result = await step.execute(doc, new AsyncController());
        expect(result).toBeUndefined();
    });

    test("Enter with nothing selected re-offers the pick instead of ending the step", async () => {
        const node = { id: "target" };
        const targetPick = [
            {
                shape: { shapeType: ShapeTypes.face },
                owner: { node },
                transform: Matrix4.identity(),
                indexes: [0],
            },
        ];
        const { doc, pickShape, step } = stepScenario("feature.extrude.endCondition.upToFace");
        const events: string[] = [];
        doc.selection.clearSelection = () => {
            events.push("clear");
        };
        let round = 0;
        pickShape.mockImplementation((_prompt: any, controller: AsyncController, _options?: any) => {
            events.push("pick");
            round += 1;
            if (round === 1) {
                // `SelectionHandler.keyDown` accepts Enter unconditionally; with the
                // selection empty, the round settles successfully with nothing picked.
                controller.success();
                return Promise.resolve([]);
            }
            return Promise.resolve(targetPick);
        });

        const controller = new AsyncController();
        const result = await step.execute(doc, controller);

        // The empty confirm neither commits nor cancels: a fresh round picks the real
        // target, and every round clears the selection before it picks.
        expect(events).toEqual(["clear", "pick", "clear", "pick"]);
        expect(controller.result?.status).toBe("success");
        expect(result?.shapes).toBe(targetPick);
        expect(result?.nodes?.[0]).toBe(node);
    });

    test("a selection left over from an earlier step is not confirmed as the target", async () => {
        const node = { id: "target" };
        const targetPick = [
            {
                shape: { shapeType: ShapeTypes.face },
                owner: { node },
                transform: Matrix4.identity(),
                indexes: [0],
            },
        ];
        const { doc, pickShape, step } = stepScenario("feature.extrude.endCondition.upToFace");
        // The profile step leaves its faces selected, and the real pickShape returns
        // whatever `getSelectedShapes` holds when the round settles — Enter would
        // confirm the leftover as the target without ever being aimed at it.
        const stale = [{ shape: { shapeType: ShapeTypes.face }, owner: { node: { id: "stale" } } }];
        let selected: any[] = stale;
        doc.selection.getSelectedShapes = () => selected;
        doc.selection.clearSelection = () => {
            selected = [];
        };
        let round = 0;
        pickShape.mockImplementation((_prompt: any, controller: AsyncController, _options?: any) => {
            round += 1;
            controller.success(); // Enter
            return Promise.resolve(round === 1 ? doc.selection.getSelectedShapes() : targetPick);
        });

        const result = await step.execute(doc, new AsyncController());

        // The first round started empty (the leftover was cleared), so Enter re-picked;
        // the target is the face the second round aimed at, not the leftover.
        expect(pickShape).toHaveBeenCalledTimes(2);
        expect(result?.shapes).toBe(targetPick);
        expect(result?.nodes?.[0]).toBe(node);
    });

    test("Escape in the target pick cancels the command", async () => {
        const { doc, pickShape, step } = stepScenario("feature.extrude.endCondition.upToFace");
        pickShape.mockImplementation((_prompt: any, controller: AsyncController) => {
            // Escape: the handler cancels its controller, the selection reports empty.
            controller.cancel();
            return Promise.resolve([]);
        });

        const controller = new AsyncController();
        const result = await step.execute(doc, controller);

        expect(result).toBeUndefined();
        // A round's cancel does not settle the step's own controller (the bridge is
        // one-way); the framework reads the undefined result as the command's cancel.
        expect(controller.result).toBeUndefined();
    });

    test("flipping the condition mid-pick re-picks for the new target", async () => {
        const node = { id: "target" };
        const vertexPick = [
            {
                shape: { shapeType: ShapeTypes.vertex },
                owner: { node },
                transform: Matrix4.identity(),
                indexes: [0],
            },
        ];
        const { doc, pickShape, step, cmd } = stepScenario("feature.extrude.endCondition.upToFace");
        pickShape.mockImplementation((_prompt: any, _controller: any, options?: any) => {
            if (options?.shapeType === ShapeTypes.face) {
                // The dropdown flips while the face pick is up: the setter settles this
                // round with an empty result and the step loops onto the new condition.
                cmd.endCondition = "feature.extrude.endCondition.upToVertex";
                return Promise.resolve([]);
            }
            return Promise.resolve(vertexPick);
        });

        const controller = new AsyncController();
        const result = await step.execute(doc, controller);

        expect(pickShape).toHaveBeenCalledTimes(2);
        expect(pickShape.mock.calls[0][0]).toBe("prompt.select.faces");
        expect((pickShape.mock.calls[0][2] as any).shapeType).toBe(ShapeTypes.face);
        expect(pickShape.mock.calls[1][0]).toBe("prompt.select.vertexes");
        expect((pickShape.mock.calls[1][2] as any).shapeType).toBe(ShapeTypes.vertex);
        expect(controller.result?.status).toBe("success");
        expect(result?.shapes).toBe(vertexPick);
        expect(result?.nodes?.[0]).toBe(node);
    });

    test("a flip to blind with a depth already in the panel still asks for the gesture", async () => {
        const faceMesh = {
            range: [],
            index: new Uint32Array(),
            position: new Float32Array(),
            normal: new Float32Array(),
            uv: new Float32Array(),
        };
        const restoreFactory = mockShapeFactory({
            cylinder: arrowShape,
            cone: arrowShape,
            prism: () => Result.ok({ dispose: () => {}, mesh: { faces: faceMesh, edges: undefined } }),
        });
        try {
            const { doc, cmd, step } = skippedDragScenario();
            // What the option cache restores at `beforeExecute` (`setPrivateValue`): a
            // depth from the command's last run, never given in this one. The old flow
            // committed with it the moment the dropdown flipped, without ever asking.
            (cmd as any).setPrivateValue("depth", 5);
            const pickShape = rs.fn((_prompt: any, _controller: any, _options?: any) => {
                cmd.endCondition = "feature.extrude.endCondition.blind";
                return Promise.resolve([]);
            });
            let dragged = false;
            const pickAsync = driveDrag((handler) => {
                dragged = true;
                handler.setValue(7);
                (handler as any).confirm();
            });
            doc.picker = { pickShape, pickAsync } as any;

            const controller = new AsyncController();
            const result = await step.execute(doc, controller);

            expect(controller.result?.status).toBe("success");
            expect(result?.shapes).toEqual([]);
            expect(dragged).toBe(true);
            expect(cmd.depth).toBe(7);
        } finally {
            restoreFactory();
        }
    });

    test.each([
        {
            from: "feature.extrude.endCondition.upToFace",
            to: "feature.extrude.endCondition.upToVertex",
            first: ShapeTypes.face,
            second: ShapeTypes.vertex,
        },
        {
            from: "feature.extrude.endCondition.upToVertex",
            to: "feature.extrude.endCondition.upToFace",
            first: ShapeTypes.vertex,
            second: ShapeTypes.face,
        },
    ] as const)("a flip from $from to $to drops the old target instead of committing it", async (c) => {
        const node = { id: "target" };
        const pickOf = (shapeType: ShapeType) => [
            {
                shape: { shapeType },
                owner: { node },
                transform: Matrix4.identity(),
                indexes: [0],
            },
        ];
        const oldPick = pickOf(c.first);
        const newPick = pickOf(c.second);
        const { doc, pickShape, step, cmd } = stepScenario(c.from);

        pickShape.mockImplementation((_prompt: any, _controller: any, options?: any) => {
            if (options?.shapeType === c.first) {
                cmd.endCondition = c.to;
                // The already-aimed target resolves the settled round — the very case the
                // click-to-select pick makes possible. It belongs to the OLD condition and
                // must not be handed over as the new one's answer (a face is no vertex).
                return Promise.resolve(oldPick);
            }
            return Promise.resolve(newPick);
        });

        const controller = new AsyncController();
        const result = await step.execute(doc, controller);

        expect(controller.result?.status).toBe("success");
        expect(pickShape).toHaveBeenCalledTimes(2);
        expect((pickShape.mock.calls[1][2] as any).shapeType).toBe(c.second);
        expect(result?.shapes).toEqual(newPick);
    });

    test("flipping back to blind mid-pick ends the step with an empty pick", async () => {
        const { doc, pickShape, step, cmd } = stepScenario("feature.extrude.endCondition.upToFace");
        cmd.depth = 5; // the drag already ran in step 2 and settled on 5 — nothing to redo
        pickShape.mockImplementation(() => {
            // The user thinks better of the target pick: with a depth already set, the
            // step passes through with no target and the command commits with it.
            cmd.endCondition = "feature.extrude.endCondition.blind";
            return Promise.resolve([]);
        });

        const controller = new AsyncController();
        const result = await step.execute(doc, controller);

        expect(pickShape).toHaveBeenCalledTimes(1);
        expect(controller.result?.status).toBe("success");
        expect(result?.shapes).toEqual([]);
        expect(result?.type).toBe("shape");
    });

    /** A picked profile face at z = 0, rich enough for `captureProfileRef` at the commit. */
    function profileFaceData(node: unknown) {
        const corners = [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
        ];
        const edges = corners.map(([x, y], index) => {
            const [x2, y2] = corners[(index + 1) % corners.length];
            return {
                curve: { basisCurve: { direction: new XYZ({ x: x2 - x, y: y2 - y, z: 0 }).normalize() } },
                startPoint: () => new XYZ({ x, y, z: 0 }),
                endPoint: () => new XYZ({ x: x2, y: y2, z: 0 }),
            };
        });
        return {
            shape: {
                shapeType: ShapeTypes.face,
                outerWire: () => ({ findSubShapes: () => edges }),
                normal: () => [XYZ.zero, XYZ.unitZ],
                area: () => 100,
                boundingBox: () => new BoundingBox({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 0 }),
            },
            owner: { node },
            transform: Matrix4.identity(),
            indexes: [0],
            point: new XYZ({ x: 5, y: 5, z: 0 }),
        } as any;
    }

    /**
     * The state an up-to flow leaves at the end-target step: the profiles pick, the skipped
     * drag's zero-depth placeholder in `stepDatas[1]`, and the panel depth never set (0) —
     * which is what `needsDepthDrag` keys the in-place re-drag on.
     */
    function skippedDragScenario() {
        const app = createMockApplication();
        const doc = new TestDocument({ application: app });
        doc.visual = createMockVisualWithDocument(doc);
        doc.selection = createMockSelection();
        const view = createHandlerMockView({ document: doc });
        (app as any).activeView = view;
        const sketch = new SketchNode({
            document: doc,
            plane: Plane.XY,
            data: { entities: [], constraints: [] },
        });
        doc.modelManager.addNode(sketch);
        const cmd = new ExtrudeFeatureCommand();
        (cmd as any)._application = app;
        const step = (cmd as any).endTargetStep as ExtrudeEndTargetStep;
        cmd.endCondition = "feature.extrude.endCondition.upToFace";
        const placeholder = {
            view,
            point: XYZ.zero,
            distance: 0,
            shapes: [profileFaceData(sketch)],
            nodes: [sketch],
            type: "input",
            plane: Plane.XY,
        };
        (cmd as any).stepDatas = [
            { shapes: placeholder.shapes, nodes: [sketch], type: "shape" },
            placeholder,
        ];
        return { app, doc, view, sketch, cmd, step, placeholder };
    }

    /** The pickAsync mock the in-place drag tests share: captures the handler, runs `drive`. */
    function driveDrag(drive: (handler: ExtrudeDragHandler) => void) {
        return rs.fn((handler: ExtrudeDragHandler, _prompt: any, controller: AsyncController) => {
            drive(handler);
            return new Promise<void>((resolve) => {
                controller.onCompleted(() => resolve());
                controller.onCancelled(() => resolve());
                controller.onFailed(() => resolve());
            });
        });
    }

    const arrowShape = () => ({
        isOk: true,
        value: { mesh: { faces: { range: [], position: new Float32Array() } }, dispose: () => {} },
    });

    test("a flip to blind re-runs the skipped drag in place, and the commit uses its depth", async () => {
        const faceMesh = {
            range: [],
            index: new Uint32Array(),
            position: new Float32Array(),
            normal: new Float32Array(),
            uv: new Float32Array(),
        };
        const restoreFactory = mockShapeFactory({
            cylinder: arrowShape,
            cone: arrowShape,
            prism: () => Result.ok({ dispose: () => {}, mesh: { faces: faceMesh, edges: undefined } }),
        });
        try {
            const { doc, view, cmd, step } = skippedDragScenario();
            const pickShape = rs.fn((_prompt: any, _controller: any, _options?: any) => {
                // The dropdown flips while the target pick is up: the round settles
                // empty and the loop re-reads the condition.
                cmd.endCondition = "feature.extrude.endCondition.blind";
                return Promise.resolve([]);
            });
            let captured: ExtrudeDragHandler | undefined;
            const pickAsync = driveDrag((handler) => {
                captured = handler;
                // The arrows are up (the handler is live): the user settles on 12.
                handler.setValue(12);
                (handler as any).confirm();
            });
            doc.picker = { pickShape, pickAsync } as any;

            const controller = new AsyncController();
            const result = await step.execute(doc, controller);

            expect(controller.result?.status).toBe("success");
            expect(result?.shapes).toEqual([]);
            expect(pickShape).toHaveBeenCalledTimes(1); // only the up-to round picked
            expect(pickAsync).toHaveBeenCalledTimes(1);
            expect(captured).toBeInstanceOf(ExtrudeDragHandler);
            // The drag pushed its depth into the panel, and its result replaced the
            // placeholder: the commit reads the real drag's plane, point, and faces.
            expect(cmd.depth).toBe(12);
            expect((cmd as any)._dragHandler).toBeUndefined(); // disposed with the drag
            const dragData = (cmd as any).stepDatas[1];
            expect(dragData.type).toBe("input");
            expect(dragData.distance).toBe(12);
            expect(dragData.view).toBe(view);
            expect(dragData.point.isEqualTo(new XYZ({ x: 0, y: 0, z: 12 }))).toBe(true);
            expect(dragData.plane.normal.isEqualTo(XYZ.unitZ)).toBe(true);
            expect(dragData.shapes).toHaveLength(1);

            (cmd as any).executeMainTask();
            const body = doc.modelManager.findNode(
                (node) => node instanceof ParametricBodyNode,
            ) as ParametricBodyNode;
            expect(body).toBeInstanceOf(ParametricBodyNode);
            const feature = body.features[0] as ExtrudeFeatureData;
            expect(feature.depth).toBe(12);
            expect(feature.endCondition).toBeUndefined();
        } finally {
            restoreFactory();
        }
    });

    test("a flip to throughAll asks for the gesture — no depth needed, but no silent commit", async () => {
        const faceMesh = {
            range: [],
            index: new Uint32Array(),
            position: new Float32Array(),
            normal: new Float32Array(),
            uv: new Float32Array(),
        };
        const restoreFactory = mockShapeFactory({
            cylinder: arrowShape,
            cone: arrowShape,
            prism: () => Result.ok({ dispose: () => {}, mesh: { faces: faceMesh, edges: undefined } }),
        });
        try {
            const { doc, cmd, step } = skippedDragScenario();
            const pickShape = rs.fn((_prompt: any, _controller: any, _options?: any) => {
                cmd.endCondition = "feature.extrude.endCondition.throughAll";
                return Promise.resolve([]);
            });
            let captured: ExtrudeDragHandler | undefined;
            const pickAsync = driveDrag((handler) => {
                captured = handler;
                // no depth to set: the arrows are the affordance, the confirm is the OK
                (handler as any).confirm();
            });
            doc.picker = { pickShape, pickAsync } as any;

            const controller = new AsyncController();
            const result = await step.execute(doc, controller);

            expect(controller.result?.status).toBe("success");
            expect(result?.shapes).toEqual([]);
            expect(pickShape).toHaveBeenCalledTimes(1);
            expect(pickAsync).toHaveBeenCalledTimes(1);
            expect(captured).toBeInstanceOf(ExtrudeDragHandler);
            expect(cmd.depth).toBe(0);
            // The skipped drag's placeholder is what the commit reads: it still carries
            // the plane and the profile faces.
            expect((cmd as any).stepDatas[1].type).toBe("input");

            (cmd as any).executeMainTask();
            const body = doc.modelManager.findNode(
                (node) => node instanceof ParametricBodyNode,
            ) as ParametricBodyNode;
            expect(body).toBeInstanceOf(ParametricBodyNode);
            const feature = body.features[0] as ExtrudeFeatureData;
            expect(feature.endCondition).toBe("throughAll");
            expect(feature.depth).toBe(0);
        } finally {
            restoreFactory();
        }
    });

    test("a flip to an up-to target mid-drag ends it through finishEarly, and the next round picks", async () => {
        const restoreFactory = mockShapeFactory({ cylinder: arrowShape, cone: arrowShape });
        try {
            const { doc, cmd, step } = skippedDragScenario();
            const node = { id: "target" };
            const vertexPick = [
                {
                    shape: { shapeType: ShapeTypes.vertex },
                    owner: { node },
                    transform: Matrix4.identity(),
                    indexes: [0],
                },
            ];
            let picks = 0;
            const pickShape = rs.fn((_prompt: any, _controller: any, _options?: any) => {
                picks += 1;
                if (picks === 1) {
                    // First the flip to blind — the skipped drag re-runs in place...
                    cmd.endCondition = "feature.extrude.endCondition.blind";
                    return Promise.resolve([]);
                }
                return Promise.resolve(vertexPick);
            });
            const pickAsync = driveDrag(() => {
                // ...then the flip to upToVertex mid-drag ends it at once (finishEarly).
                cmd.endCondition = "feature.extrude.endCondition.upToVertex";
            });
            doc.picker = { pickShape, pickAsync } as any;

            const controller = new AsyncController();
            const result = await step.execute(doc, controller);

            expect(controller.result?.status).toBe("success");
            expect(result?.shapes).toBe(vertexPick);
            expect(pickAsync).toHaveBeenCalledTimes(1);
            expect(pickShape).toHaveBeenCalledTimes(2);
            expect(pickShape.mock.calls[0][0]).toBe("prompt.select.faces");
            expect(pickShape.mock.calls[1][0]).toBe("prompt.select.vertexes");
            // The finishEarly'd drag's zero-depth result replaced the placeholder; the
            // depth is still unset, so a further flip back to blind would drag again.
            expect((cmd as any).stepDatas[1].type).toBe("input");
        } finally {
            restoreFactory();
        }
    });

    test("a depth-driven condition whose drag produced a depth passes through — no second drag", async () => {
        const { doc, step, cmd } = stepScenario("feature.extrude.endCondition.blind");
        const pickAsync = rs.fn();
        (doc.picker as any).pickAsync = pickAsync;
        cmd.depth = 8; // the drag that ran settled on 8 (synced via onDist)
        const dragResult = { type: "input", distance: 8 };
        (cmd as any).stepDatas = [{ shapes: [], nodes: [], type: "shape" }, dragResult];

        const result = await step.execute(doc, new AsyncController());

        expect(result?.shapes).toEqual([]);
        expect(pickAsync).not.toHaveBeenCalled();
        expect((cmd as any).stepDatas[1]).toBe(dragResult);
    });

    /** Steps 2+3 as the framework runs them: the drag step, then the end-target step. */
    function liveDragScenario() {
        const app = createMockApplication();
        const doc = new TestDocument({ application: app });
        doc.visual = createMockVisualWithDocument(doc);
        doc.selection = createMockSelection();
        const view = createHandlerMockView({ document: doc });
        (app as any).activeView = view;
        const sketch = new SketchNode({
            document: doc,
            plane: Plane.XY,
            data: { entities: [], constraints: [] },
        });
        doc.modelManager.addNode(sketch);
        const cmd = new ExtrudeFeatureCommand();
        (cmd as any)._application = app;
        (cmd as any).stepDatas = [{ shapes: [profileFaceData(sketch)], nodes: [sketch], type: "shape" }];
        return { app, doc, view, sketch, cmd };
    }

    const previewFactory = () => ({
        cylinder: arrowShape,
        cone: arrowShape,
        prism: () =>
            Result.ok({
                dispose: () => {},
                mesh: {
                    faces: {
                        range: [],
                        index: new Uint32Array(),
                        position: new Float32Array(),
                        normal: new Float32Array(),
                        uv: new Float32Array(),
                    },
                    edges: undefined,
                },
            }),
    });

    test("blind drag flipped to upToFace and back re-offers the arrows instead of committing empty", async () => {
        const restoreFactory = mockShapeFactory(previewFactory());
        try {
            const { doc, cmd } = liveDragScenario();
            let drags = 0;
            const pickAsync = driveDrag((handler) => {
                drags += 1;
                if (drags === 1) {
                    // The condition flips to upToFace before any gesture: finishEarly
                    // ends the drag at the zero depth it started with (the bug's path).
                    cmd.endCondition = "feature.extrude.endCondition.upToFace";
                    return;
                }
                // The re-offered drag: the user settles on 15.
                handler.setValue(15);
                (handler as any).confirm();
            });
            const pickShape = rs.fn((_prompt: any, _controller: any, _options?: any) => {
                // In the target pick, the user thinks better of it: back to blind.
                cmd.endCondition = "feature.extrude.endCondition.blind";
                return Promise.resolve([]);
            });
            doc.picker = { pickShape, pickAsync } as any;

            // Step 2: the real drag, finishEarly'd by the flip — a zero-depth result.
            const dragStep = (cmd as any).getSteps()[1] as IStep;
            const dragResult = await dragStep.execute(doc, new AsyncController());
            expect(dragResult?.distance).toBe(0);
            (cmd as any).stepDatas.push(dragResult);

            // Step 3: the flip back must re-run the drag, not commit at zero.
            const step = (cmd as any).endTargetStep as ExtrudeEndTargetStep;
            const controller = new AsyncController();
            const result = await step.execute(doc, controller);

            expect(controller.result?.status).toBe("success");
            expect(result?.shapes).toEqual([]);
            expect(pickAsync).toHaveBeenCalledTimes(2);
            expect(cmd.depth).toBe(15);
            expect((cmd as any).stepDatas[1].distance).toBe(15);

            (cmd as any).executeMainTask();
            const body = doc.modelManager.findNode(
                (node) => node instanceof ParametricBodyNode,
            ) as ParametricBodyNode;
            expect(body).toBeInstanceOf(ParametricBodyNode);
            expect((body.features[0] as ExtrudeFeatureData).depth).toBe(15);
        } finally {
            restoreFactory();
        }
    });

    test("a drag that produced a depth before finishEarly commits it — no re-drag", async () => {
        const restoreFactory = mockShapeFactory(previewFactory());
        try {
            const { doc, cmd } = liveDragScenario();
            const pickAsync = driveDrag((handler) => {
                // Dragged to 8 first — then the flip ends the drag (finishEarly).
                handler.setValue(8);
                cmd.endCondition = "feature.extrude.endCondition.upToFace";
            });
            const pickShape = rs.fn((_prompt: any, _controller: any, _options?: any) => {
                cmd.endCondition = "feature.extrude.endCondition.blind";
                return Promise.resolve([]);
            });
            doc.picker = { pickShape, pickAsync } as any;

            const dragStep = (cmd as any).getSteps()[1] as IStep;
            const dragResult = await dragStep.execute(doc, new AsyncController());
            expect(dragResult?.distance).toBe(8);
            (cmd as any).stepDatas.push(dragResult);

            const step = (cmd as any).endTargetStep as ExtrudeEndTargetStep;
            const result = await step.execute(doc, new AsyncController());

            // The depth the user already dragged to is the commit's — no second drag.
            expect(result?.shapes).toEqual([]);
            expect(pickAsync).toHaveBeenCalledTimes(1);

            (cmd as any).executeMainTask();
            const body = doc.modelManager.findNode(
                (node) => node instanceof ParametricBodyNode,
            ) as ParametricBodyNode;
            expect((body.features[0] as ExtrudeFeatureData).depth).toBe(8);
        } finally {
            restoreFactory();
        }
    });

    test("a depth typed into the panel commits as-is even when the drag was skipped", async () => {
        const { doc, cmd, step } = skippedDragScenario();
        const pickAsync = rs.fn();
        const pickShape = rs.fn((_prompt: any, _controller: any, _options?: any) => {
            // The fallback depth the user typed for the up-to condition, then the flip.
            cmd.depth = 10;
            cmd.endCondition = "feature.extrude.endCondition.blind";
            return Promise.resolve([]);
        });
        doc.picker = { pickShape, pickAsync } as any;

        const result = await step.execute(doc, new AsyncController());

        expect(result?.shapes).toEqual([]);
        expect(pickAsync).not.toHaveBeenCalled();

        (cmd as any).executeMainTask();
        const body = doc.modelManager.findNode(
            (node) => node instanceof ParametricBodyNode,
        ) as ParametricBodyNode;
        expect((body.features[0] as ExtrudeFeatureData).depth).toBe(10);
    });
});

describe("ExtrudeFeatureCommand end condition commit", () => {
    const squareData: SketchData = {
        entities: [
            { id: 1, type: "line", params: [0, 0, 1, 0] },
            { id: 2, type: "line", params: [1, 0, 1, 1] },
            { id: 3, type: "line", params: [1, 1, 0, 1] },
            { id: 4, type: "line", params: [0, 1, 0, 0] },
        ],
        constraints: [],
    };

    /** A planar face at z = 20, fingerprintable by `captureProfileRef`. */
    function endFaceData(node: unknown) {
        const corners = [
            [0, 0],
            [10, 0],
            [10, 10],
            [0, 10],
        ];
        const edges = corners.map(([x, y], index) => {
            const [x2, y2] = corners[(index + 1) % corners.length];
            const start = new XYZ({ x, y, z: 20 });
            const end = new XYZ({ x: x2, y: y2, z: 20 });
            return {
                curve: { basisCurve: { direction: new XYZ({ x: x2 - x, y: y2 - y, z: 0 }).normalize() } },
                startPoint: () => start,
                endPoint: () => end,
                firstParameter: () => 0,
                lastParameter: () => 1,
                pointAt: (t: number) => start.add(end.sub(start).multiply(t)),
            };
        });
        return {
            shape: {
                shapeType: ShapeTypes.face,
                outerWire: () => ({ findSubShapes: () => edges }),
                findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? edges : []),
                normal: () => [new XYZ({ x: 0, y: 0, z: 20 }), XYZ.unitZ],
                area: () => 100,
                boundingBox: () => new BoundingBox({ x: 0, y: 0, z: 20 }, { x: 10, y: 10, z: 20 }),
            },
            owner: { node },
            transform: Matrix4.identity(),
            indexes: [0],
        } as any;
    }

    function endVertexData(node: unknown, point: XYZ, transform = Matrix4.identity()) {
        const vertex = {
            shapeType: ShapeTypes.vertex,
            point: () => point,
            dispose: () => {},
            transformedMul: (matrix: Matrix4) => ({
                shapeType: ShapeTypes.vertex,
                point: () => matrix.ofPoint(point),
                dispose: () => {},
            }),
        };
        return { shape: vertex, owner: { node }, transform, indexes: [0] } as any;
    }

    function commitScenario(endCondition: I18nKeys) {
        const app = createMockApplication();
        const doc = new TestDocument({ application: app });
        (app as any).activeView = { document: doc };
        const sketch = new SketchNode({ document: doc, plane: Plane.XY, data: squareData });
        doc.modelManager.addNode(sketch);
        // The end target may live on any node — a second sketch stands in for one.
        const targetNode = new SketchNode({ document: doc, plane: Plane.XY, data: squareData });
        doc.modelManager.addNode(targetNode);
        const cmd = new ExtrudeFeatureCommand();
        (cmd as any)._application = app;
        cmd.endCondition = endCondition;
        cmd.depth = 5;
        (cmd as any).stepDatas = [
            { shapes: [], nodes: [sketch], type: "shape" },
            {
                shapes: [],
                nodes: [sketch],
                point: new XYZ({ x: 0, y: 0, z: 5 }),
                plane: Plane.XY,
                type: "input",
            },
        ];
        return { doc, sketch, targetNode, cmd };
    }

    function pushEndFace(scenario: ReturnType<typeof commitScenario>) {
        (scenario.cmd as any).stepDatas.push({
            shapes: [endFaceData(scenario.targetNode)],
            nodes: [scenario.targetNode],
            type: "shape",
        });
    }

    function committedFeature(doc: TestDocument): ExtrudeFeatureData {
        const body = doc.modelManager.findNode(
            (node) => node instanceof ParametricBodyNode,
        ) as ParametricBodyNode;
        expect(body).toBeInstanceOf(ParametricBodyNode);
        return body.features[0] as ExtrudeFeatureData;
    }

    /** A body standing off the sketch plane, its own box spanning `z` to `z + depth`. */
    function bodyAbove(doc: TestDocument, z: number, depth: number): ParametricBodyNode {
        const sketch = new SketchNode({
            document: doc,
            plane: new Plane({
                origin: new XYZ({ x: 0, y: 0, z }),
                normal: XYZ.unitZ,
                xvec: XYZ.unitX,
            }),
            data: squareData,
        });
        doc.modelManager.addNode(sketch);
        const body = new ParametricBodyNode({
            document: doc,
            features: [{ id: "t1", type: "extrude", sketchId: sketch.id, depth }],
        });
        doc.modelManager.addNode(body);
        return body;
    }

    /** A body whose shape is already fixed, so measuring it never builds its chain. */
    function bodyWithBox(doc: TestDocument, min: XYZLike, max: XYZLike): ParametricBodyNode {
        const body = new ParametricBodyNode({ document: doc, features: [] });
        doc.modelManager.addNode(body);
        body.shape = Result.ok({
            shapeType: ShapeTypes.solid,
            isEqual: () => false,
            dispose: () => {},
            findSubShapes: () => [],
            boundingBox: () => new BoundingBox(min, max),
        } as any);
        return body;
    }

    test("a blind commit stores none of the end-condition fields", () => {
        const { doc, cmd } = commitScenario("feature.extrude.endCondition.blind");

        (cmd as any).executeMainTask();

        const feature = committedFeature(doc);
        expect(feature.depth).toBe(5);
        expect(feature.endCondition).toBeUndefined();
        expect(feature.endFace).toBeUndefined();
        expect(feature.endVertex).toBeUndefined();
        expect(feature.endOffset).toBeUndefined();
    });

    test("a draft angle is a panel parameter and is stored on the committed feature", () => {
        const straight = commitScenario("feature.extrude.endCondition.blind");
        expect(straight.cmd.draftAngle).toBe(0);
        (straight.cmd as any).executeMainTask();
        expect(committedFeature(straight.doc).draftAngle).toBeUndefined();

        const drafted = commitScenario("feature.extrude.endCondition.blind");
        drafted.cmd.draftAngle = 5;
        (drafted.cmd as any).executeMainTask();
        expect(committedFeature(drafted.doc).draftAngle).toBe(5);
    });

    test("a blind commit with a ~zero depth toasts and lands no body", () => {
        const { doc, cmd } = commitScenario("feature.extrude.endCondition.blind");
        cmd.depth = 0;
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            (cmd as any).executeMainTask();

            expect(pub).toHaveBeenCalledWith(
                "showToast",
                "error.default:{0}",
                "Blind extrude needs a non-zero depth",
            );
            expect(doc.modelManager.findNode((node) => node instanceof ParametricBodyNode)).toBeUndefined();
        } finally {
            pub.mockRestore();
        }
    });

    test("a throughAll commit keeps its zero fallback depth (it measures its own reach)", () => {
        const { doc, cmd } = commitScenario("feature.extrude.endCondition.throughAll");
        cmd.depth = 0;

        (cmd as any).executeMainTask();

        const feature = committedFeature(doc);
        expect(feature.endCondition).toBe("throughAll");
        expect(feature.depth).toBe(0);
    });

    test("throughAll stores the condition and keeps the depth as the fallback", () => {
        const { doc, cmd } = commitScenario("feature.extrude.endCondition.throughAll");

        (cmd as any).executeMainTask();

        const feature = committedFeature(doc);
        expect(feature.endCondition).toBe("throughAll");
        expect(feature.depth).toBe(5);
        expect(feature.endFace).toBeUndefined();
        expect(feature.endVertex).toBeUndefined();
    });

    test("upToFace captures the picked face in world coordinates with its node's id", () => {
        const scenario = commitScenario("feature.extrude.endCondition.upToFace");
        pushEndFace(scenario);

        (scenario.cmd as any).executeMainTask();

        const feature = committedFeature(scenario.doc);
        expect(feature.endCondition).toBe("upToFace");
        expect(feature.endFace?.nodeId).toBe(scenario.targetNode.id);
        expect(feature.endFace?.profile.edges.length).toBe(4);
        expect(feature.endFace?.profile.edges[0]).toMatchObject({
            kind: "line",
            start: { x: 0, y: 0, z: 20 },
            end: { x: 10, y: 0, z: 20 },
        });
        expect(feature.endFace?.profile.center).toEqual({ x: 5, y: 5, z: 20 });
        expect(feature.endFace?.profile.normal).toEqual({ x: 0, y: 0, z: 1 });
        expect(feature.endVertex).toBeUndefined();
    });

    test("upToVertex captures the picked vertex mapped to world coordinates", () => {
        const scenario = commitScenario("feature.extrude.endCondition.upToVertex");
        (scenario.cmd as any).stepDatas.push({
            shapes: [
                endVertexData(
                    scenario.targetNode,
                    new XYZ({ x: 1, y: 2, z: 20 }),
                    Matrix4.fromTranslation(100, 0, 0),
                ),
            ],
            nodes: [scenario.targetNode],
            type: "shape",
        });

        (scenario.cmd as any).executeMainTask();

        const feature = committedFeature(scenario.doc);
        expect(feature.endCondition).toBe("upToVertex");
        expect(feature.endVertex?.nodeId).toBe(scenario.targetNode.id);
        expect(feature.endVertex?.vertex.point).toEqual({ x: 101, y: 2, z: 20 });
        expect(feature.endFace).toBeUndefined();
    });

    test("the end offset is stored for an up-to condition only, and only when set", () => {
        // Blind never carries an end offset, even with a value left in the field.
        const blind = commitScenario("feature.extrude.endCondition.blind");
        blind.cmd.endOffset = 2;
        (blind.cmd as any).executeMainTask();
        expect(committedFeature(blind.doc).endOffset).toBeUndefined();

        // Zero is the feature's own default — nothing to store.
        const zero = commitScenario("feature.extrude.endCondition.upToFace");
        pushEndFace(zero);
        (zero.cmd as any).executeMainTask();
        expect(committedFeature(zero.doc).endOffset).toBeUndefined();

        const offset = commitScenario("feature.extrude.endCondition.upToFace");
        pushEndFace(offset);
        offset.cmd.endOffset = 2;
        (offset.cmd as any).executeMainTask();
        expect(committedFeature(offset.doc).endOffset).toBe(2);
    });

    test("an up-to condition without a picked target toasts and aborts", () => {
        const { doc, cmd } = commitScenario("feature.extrude.endCondition.upToFace");
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            (cmd as any).executeMainTask();

            expect(pub).toHaveBeenCalledWith("showToast", "prompt.select.faces");
            expect(doc.modelManager.findNode((node) => node instanceof ParametricBodyNode)).toBeUndefined();
        } finally {
            pub.mockRestore();
        }
    });

    test("a skipped drag still detects the body the up-to target belongs to", () => {
        // The box a face/prism mock reports is derived from its own geometry: the face
        // from its wires' endpoints (world z, so an elevated sketch's profiles sit
        // high), the prism from the face box swept by the vector it was given.
        const prismVecs: XYZ[] = [];
        const restoreFactory = mockShapeFactory({
            line: (start: XYZ, end: XYZ) =>
                Result.ok({
                    shapeType: ShapeTypes.edge,
                    curve: { nearestFromPoint: (point: XYZ) => nearestOnSegment(start, end, point) },
                    startPoint: () => start,
                    endPoint: () => end,
                    firstParameter: () => 0,
                    lastParameter: () => 1,
                    pointAt: (t: number) => start.add(end.sub(start).multiply(t)),
                    intersect: () => [],
                    boundingBox: () =>
                        new BoundingBox(
                            {
                                x: Math.min(start.x, end.x),
                                y: Math.min(start.y, end.y),
                                z: Math.min(start.z, end.z),
                            },
                            {
                                x: Math.max(start.x, end.x),
                                y: Math.max(start.y, end.y),
                                z: Math.max(start.z, end.z),
                            },
                        ),
                    isEqual: () => false,
                }),
            combine: (edges: any[]) =>
                Result.ok({
                    shapeType: ShapeTypes.compound,
                    isEqual: () => false,
                    dispose: () => {},
                    findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? edges : []),
                }),
            wire: (edges: any[]) => Result.ok({ isClosed: () => edges.length > 1, edges }),
            face: (wires: any[]) => {
                const edges = wires.flatMap((w: any) => w.edges);
                const zs = edges.flatMap((e: any) => [e.startPoint().z, e.endPoint().z]);
                return Result.ok({
                    shapeType: ShapeTypes.face,
                    isEqual: () => false,
                    dispose: () => {},
                    findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? edges : []),
                    area: () => 1,
                    boundingBox: () =>
                        new BoundingBox(
                            { x: 0, y: 0, z: Math.min(...zs) },
                            { x: 1, y: 1, z: Math.max(...zs) },
                        ),
                });
            },
            prism: (face: any, vec: XYZ) => {
                prismVecs.push(vec);
                const fb = face.boundingBox();
                return Result.ok({
                    shapeType: ShapeTypes.solid,
                    isEqual: () => false,
                    dispose: () => {},
                    findSubShapes: () => [],
                    boundingBox: () =>
                        new BoundingBox(
                            { x: fb.min.x, y: fb.min.y, z: Math.min(fb.min.z, fb.min.z + vec.z) },
                            { x: fb.max.x, y: fb.max.y, z: Math.max(fb.max.z, fb.max.z + vec.z) },
                        ),
                    mesh: { edges: { range: [] } },
                });
            },
            booleanCut: () =>
                Result.ok({
                    shapeType: ShapeTypes.solid,
                    isEqual: () => false,
                    dispose: () => {},
                    findSubShapes: () => [],
                    boundingBox: () => new BoundingBox({ x: 0, y: 0, z: 19 }, { x: 1, y: 1, z: 21 }),
                }),
        });
        try {
            const scenario = commitScenario("feature.extrude.endCondition.upToFace");
            // The drag was skipped and nothing was typed: the depth is still 0, so a
            // depth-driven tool box would collapse onto the sketch plane and meet
            // nothing. The captured face at z = 20 must drive the detection instead.
            scenario.cmd.depth = 0;
            scenario.cmd.operation = "option.command.operation.cut";
            pushEndFace(scenario);
            // The target floats above the sketch plane: z in [19, 21] (its own sketch
            // sits at z = 19 and extrudes 2 high), a zero-height tool never meets it.
            const targetSketch = new SketchNode({
                document: scenario.doc,
                plane: new Plane({
                    origin: new XYZ({ x: 0, y: 0, z: 19 }),
                    normal: XYZ.unitZ,
                    xvec: XYZ.unitX,
                }),
                data: squareData,
            });
            scenario.doc.modelManager.addNode(targetSketch);
            const target = new ParametricBodyNode({
                document: scenario.doc,
                features: [{ id: "t1", type: "extrude", sketchId: targetSketch.id, depth: 2 }],
            });
            scenario.doc.modelManager.addNode(target);

            (scenario.cmd as any).executeMainTask();

            // The tool box reached the captured face (z = 20)...
            expect(prismVecs[0].z).toBeCloseTo(20, 9);
            // ...so the cut grew onto the target instead of standing alone.
            expect(target.features.length).toBe(2);
            expect(target.features[1]).toMatchObject({
                type: "extrude",
                operation: "cut",
                endCondition: "upToFace",
                depth: 0,
            });
            expect(scenario.doc.modelManager.findNodes((node) => node instanceof ParametricBodyNode)).toEqual(
                [target],
            );
            expect(target.shape.isOk).toBe(true);
        } finally {
            restoreFactory();
        }
    });

    test("an intersect operation previews the plane-capped prism, not the conforming cap", () => {
        // The commit maps only join/cut to the surface-conforming kernel path
        // (`extrudeToFaceOperation`); an intersect sweeps to the plane depth and commons
        // THAT prism. The hover preview must be the one the commit builds.
        const prismToFace = rs.fn(() =>
            Result.ok({ shape: { mesh: { faces: { range: [] } }, dispose: () => {} } }),
        );
        const prism = rs.fn((_face: unknown, vec: XYZ) =>
            Result.ok({
                shapeType: ShapeTypes.solid,
                isEqual: () => false,
                dispose: () => {},
                boundingBox: () => new BoundingBox({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: vec.z }),
                mesh: { faces: { range: [] } },
            }),
        );
        const restoreFactory = mockShapeFactory({ prism, prismToFaceTracked: prismToFace });
        try {
            const scenario = commitScenario("feature.extrude.endCondition.upToFace");
            (scenario.cmd as any).stepDatas[0].shapes = [sweptProfile(scenario.sketch)];
            // A curved target (a cylinder-side stand-in): the conforming path's material.
            const arc = {
                startPoint: () => new XYZ({ x: -5, y: 0, z: 20 }),
                endPoint: () => new XYZ({ x: 5, y: 0, z: 20 }),
                firstParameter: () => 0,
                lastParameter: () => 1,
                pointAt: (t: number) => new XYZ({ x: -5 + 10 * t, y: 0, z: 20 + 2 * Math.sin(Math.PI * t) }),
            };
            const curved = {
                shape: {
                    shapeType: ShapeTypes.face,
                    normal: () => [new XYZ({ x: 0, y: 0, z: 21 }), XYZ.unitZ],
                    surface: () => ({ isPlanar: () => false }),
                    findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? [arc] : []),
                    boundingBox: () => new BoundingBox({ x: -5, y: 0, z: 20 }, { x: 5, y: 0, z: 22 }),
                },
                owner: { node: scenario.targetNode },
                transform: Matrix4.identity(),
                indexes: [0],
            } as any;

            scenario.cmd.operation = "option.command.operation.intersect";
            const intersectPreview = scenario.cmd.upToTargetPreview(curved);
            // No conforming cap is built for an intersect...
            expect(prismToFace).not.toHaveBeenCalled();
            // ...and the plane-capped prism previews instead.
            expect(prism).toHaveBeenCalledTimes(1);
            expect(intersectPreview).not.toBeUndefined();

            scenario.cmd.operation = "option.command.operation.join";
            const joinPreview = scenario.cmd.upToTargetPreview(curved);
            expect(prismToFace).toHaveBeenCalledTimes(1);
            expect(joinPreview).not.toBeUndefined();
        } finally {
            restoreFactory();
        }
    });

    test("a through-all commit measures its tool box from the bodies in its path", () => {
        const prismVecs: XYZ[] = [];
        const restoreFactory = mockProfileFactory(prismVecs);
        try {
            const scenario = commitScenario("feature.extrude.endCondition.throughAll");
            // No gesture: through-all measures its own reach, so the depth stays 0.
            scenario.cmd.depth = 0;
            scenario.cmd.operation = "option.command.operation.cut";
            const target = bodyAbove(scenario.doc, 19, 2);

            (scenario.cmd as any).executeMainTask();

            // The tool box reaches past the target's far side (z = 21) with the margin.
            // (The target's own 2-high prism answers too, when its shape is first built.)
            expect(Math.max(...prismVecs.map((vec) => vec.z))).toBeCloseTo(21.001, 3);
            // ...so the cut grows onto the target instead of standing alone.
            expect(target.features.length).toBe(2);
            expect(target.features[1]).toMatchObject({
                type: "extrude",
                operation: "cut",
                endCondition: "throughAll",
                depth: 0,
            });
            expect(target.shape.isOk).toBe(true);
        } finally {
            restoreFactory();
        }
    });

    test("a through-all preview sweeps past the bodies in its path", () => {
        const prismVecs: XYZ[] = [];
        const restoreFactory = mockProfileFactory(prismVecs);
        try {
            const scenario = commitScenario("feature.extrude.endCondition.throughAll");
            scenario.cmd.depth = 0;
            bodyAbove(scenario.doc, 19, 2);

            const preview = (scenario.cmd as any).buildPreview({
                node: scenario.sketch,
                faces: [],
                origin: XYZ.zero,
                normal: XYZ.unitZ,
                anchor: XYZ.zero,
                dist: 0,
                startOffset: 0,
            });

            // A zero drag distance would preview nothing; the measured reach previews
            // the same prism the commit builds.
            expect(Math.max(...prismVecs.map((vec) => vec.z))).toBeCloseTo(21.001, 3);
            expect(preview.meshes).toHaveLength(1);
        } finally {
            restoreFactory();
        }
    });

    test("a through-all preview ignores a body outside the sweep's column", () => {
        const prismVecs: XYZ[] = [];
        const restoreFactory = mockProfileFactory(prismVecs);
        try {
            const scenario = commitScenario("feature.extrude.endCondition.throughAll");
            scenario.cmd.depth = 0;
            // In the path: far side at z = 21. Off to the side: a much taller body whose
            // far side is z = 300 — it must not stretch the preview.
            bodyWithBox(scenario.doc, { x: 0, y: 0, z: 19 }, { x: 1, y: 1, z: 21 });
            bodyWithBox(scenario.doc, { x: 1000, y: 0, z: 0 }, { x: 1001, y: 1, z: 300 });

            const preview = (scenario.cmd as any).buildPreview({
                node: scenario.sketch,
                faces: [],
                origin: XYZ.zero,
                normal: XYZ.unitZ,
                anchor: XYZ.zero,
                dist: 0,
                startOffset: 0,
            });

            expect(Math.max(...prismVecs.map((vec) => vec.z))).toBeCloseTo(21.001, 3);
            expect(preview.meshes).toHaveLength(1);
        } finally {
            restoreFactory();
        }
    });

    test("a through-all preview subtracts the start offset from its reach", () => {
        const prismVecs: XYZ[] = [];
        const restoreFactory = mockProfileFactory(prismVecs);
        try {
            const scenario = commitScenario("feature.extrude.endCondition.throughAll");
            scenario.cmd.depth = 0;
            scenario.cmd.startOffset = 5;
            bodyWithBox(scenario.doc, { x: 0, y: 0, z: 19 }, { x: 1, y: 1, z: 21 });
            const profile = {
                shapeType: ShapeTypes.face,
                boundingBox: () => new BoundingBox({ x: 0, y: 0, z: 0 }, { x: 1, y: 1, z: 0 }),
                transformedMul: () => profile,
                dispose: () => {},
            };

            (scenario.cmd as any).buildPreview({
                node: scenario.sketch,
                faces: [{ shape: profile, transform: Matrix4.identity() }],
                origin: XYZ.zero,
                normal: XYZ.unitZ,
                anchor: XYZ.zero,
                dist: 0,
                startOffset: 5,
            });

            // The sweep starts 5 above the plane, so it only needs 21 - 5 (plus the
            // through-all margin) to clear the body — the same reach the feature measures.
            expect(prismVecs.at(-1)!.z).toBeCloseTo(16.001, 3);
        } finally {
            restoreFactory();
        }
    });

    test("a through-all preview measures each body face from its own plane", () => {
        // An empty feature list still evaluates to `combine([])` when the body is added.
        const restore = mockShapeFactory({
            combine: () =>
                Result.ok({
                    shapeType: ShapeTypes.compound,
                    isEqual: () => false,
                    dispose: () => {},
                }),
        });
        try {
            const scenario = commitScenario("feature.extrude.endCondition.throughAll");
            scenario.cmd.depth = 0;
            // The body being pushed: 100 long in x, 10 in z. Two perpendicular faces.
            const body = bodyWithBox(scenario.doc, { x: 0, y: 0, z: 0 }, { x: 100, y: 10, z: 10 });
            const faceAt = (normal: XYZ) => {
                const shape: any = {
                    shapeType: ShapeTypes.face,
                    normal: () => [XYZ.zero, normal],
                    boundingBox: () => new BoundingBox(XYZ.zero, XYZ.zero),
                    dispose: () => {},
                };
                return shape;
            };
            const zFace = faceAt(XYZ.unitZ);
            const xFace = faceAt(XYZ.unitX);

            const vecsOf = (scenario.cmd as any).previewSweepVectors(
                { node: body, origin: XYZ.zero, normal: XYZ.unitZ, dist: 0 },
                [zFace, xFace],
            );

            // +z face: 10 deep; +x face: 100 deep. The first plane's reach must not be
            // reused for the second face.
            const zVec = vecsOf(zFace)[0] as XYZ;
            expect(zVec.z).toBeCloseTo(10.001, 3);
            expect(zVec.x).toBeCloseTo(0);
            const xVec = vecsOf(xFace)[0] as XYZ;
            expect(xVec.x).toBeCloseTo(100.001, 3);
            expect(xVec.z).toBeCloseTo(0);
        } finally {
            restore();
        }
    });

    test("a zero gesture with the opposite direction previews the flipped side", () => {
        const restore = mockShapeFactory({
            combine: () =>
                Result.ok({
                    shapeType: ShapeTypes.compound,
                    isEqual: () => false,
                    dispose: () => {},
                }),
        });
        try {
            const scenario = commitScenario("feature.extrude.endCondition.throughAll");
            scenario.cmd.depth = 0;
            scenario.cmd.oppositeDirection = true;
            // The body straddles the face plane, so both directions have a reach to find.
            const body = bodyWithBox(scenario.doc, { x: 0, y: 0, z: -10 }, { x: 10, y: 10, z: 10 });
            const face: any = {
                shapeType: ShapeTypes.face,
                normal: () => [XYZ.zero, XYZ.unitZ],
                boundingBox: () => new BoundingBox(XYZ.zero, XYZ.zero),
                dispose: () => {},
            };

            const vecsOf = (scenario.cmd as any).previewSweepVectors(
                { node: body, origin: XYZ.zero, normal: XYZ.unitZ, dist: 0 },
                [face],
            );

            // `-0 < 0` is false: the old sign test swallowed the checkbox at zero.
            const vec = vecsOf(face)[0] as XYZ;
            expect(vec.z).toBeCloseTo(-10.001, 3);
        } finally {
            restore();
        }
    });

    test("a checked opposite direction stores the net flip", () => {
        const { doc, cmd } = commitScenario("feature.extrude.endCondition.blind");
        cmd.oppositeDirection = true;

        (cmd as any).executeMainTask();

        const feature = committedFeature(doc);
        expect(feature.reverse).toBe(true);
        expect(feature.depth).toBe(5);
    });

    test("a checked opposite direction reaches the feature on an up-to commit too", () => {
        const scenario = commitScenario("feature.extrude.endCondition.upToFace");
        pushEndFace(scenario);
        scenario.cmd.oppositeDirection = true;

        (scenario.cmd as any).executeMainTask();

        const feature = committedFeature(scenario.doc);
        expect(feature.reverse).toBe(true);
        // The depth is the panel's (hidden for an up-to condition) fallback, untouched.
        expect(feature.depth).toBe(5);
        expect(feature.endCondition).toBe("upToFace");
    });

    test("a leftover negative depth does not flip an up-to commit", () => {
        // The depth row is hidden for an up-to condition; a value left over from an
        // earlier run must not silently decide the direction the checkbox owns.
        const scenario = commitScenario("feature.extrude.endCondition.upToFace");
        pushEndFace(scenario);
        scenario.cmd.depth = -5;

        (scenario.cmd as any).executeMainTask();

        expect(committedFeature(scenario.doc).reverse).toBeUndefined();
    });

    test("a negative depth folds its sign into the same flip", () => {
        const { doc, cmd } = commitScenario("feature.extrude.endCondition.blind");
        cmd.depth = -5;

        (cmd as any).executeMainTask();

        const feature = committedFeature(doc);
        expect(feature.reverse).toBe(true);
        expect(feature.depth).toBe(5);
    });

    test("a backward drag with the box checked is no flip at all", () => {
        const { doc, cmd } = commitScenario("feature.extrude.endCondition.blind");
        cmd.oppositeDirection = true;
        cmd.depth = -5;

        (cmd as any).executeMainTask();

        const feature = committedFeature(doc);
        expect(feature.reverse).toBeUndefined();
        expect(feature.depth).toBe(5);
    });

    test("an expression resolving negative is stored negated with the flip set", () => {
        const { doc, cmd } = commitScenario("feature.extrude.endCondition.blind");
        cmd.depth = "20 / 2 - 20";

        (cmd as any).executeMainTask();

        const feature = committedFeature(doc);
        expect(feature.reverse).toBe(true);
        expect(feature.depth).toBe("-(20 / 2 - 20)");
    });

    test("the flip composes with an up-to condition", () => {
        const scenario = commitScenario("feature.extrude.endCondition.upToFace");
        pushEndFace(scenario);
        scenario.cmd.oppositeDirection = true;

        (scenario.cmd as any).executeMainTask();

        const feature = committedFeature(scenario.doc);
        expect(feature.reverse).toBe(true);
        expect(feature.endCondition).toBe("upToFace");
    });
});

describe("ExtrudeFeatureCommand opposite direction", () => {
    test("defaults to off and shows unconditionally", () => {
        const cmd = new ExtrudeFeatureCommand();

        expect(cmd.oppositeDirection).toBe(false);
        expect(PropertyUtils.getProperty(cmd, "oppositeDirection")?.dependencies).toBeUndefined();
    });

    test("toggling re-runs the drag preview", () => {
        const cmd = new ExtrudeFeatureCommand();
        const refresh = rs.fn();
        (cmd as any)._dragHandler = { refresh };

        cmd.oppositeDirection = true;

        expect(refresh).toHaveBeenCalled();
    });

    test("changing the operation repaints an open target preview", () => {
        const cmd = new ExtrudeFeatureCommand();
        const refreshPreview = rs.fn();
        (cmd as any)._endTargetStep = { refreshPreview };

        cmd.operation = "option.command.operation.cut";

        expect(refreshPreview).toHaveBeenCalled();
    });

    test("the preview sweeps the prism along the flipped normal", () => {
        const faceMesh = {
            range: [],
            index: new Uint32Array(),
            position: new Float32Array(),
            normal: new Float32Array(),
            uv: new Float32Array(),
        };
        const prism = { dispose: rs.fn(), mesh: { faces: faceMesh, edges: undefined } };
        const prismFn = rs.fn(() => Result.ok(prism));
        const restoreFactory = mockShapeFactory({ prism: prismFn });
        try {
            const cmd = new ExtrudeFeatureCommand();
            cmd.oppositeDirection = true;
            const face = { shapeType: ShapeTypes.face };
            const state = {
                dist: 5,
                normal: XYZ.unitZ,
                faces: [{ shape: face, transform: Matrix4.identity() }],
                node: new SketchNode({
                    document: new TestDocument(),
                    plane: Plane.XY,
                    data: { entities: [], constraints: [] },
                }),
            };

            (cmd as any).buildPreview(state);

            expect(prismFn).toHaveBeenCalledTimes(1);
            const [sweptFace, vec] = prismFn.mock.calls[0] as unknown as [unknown, XYZ];
            expect(sweptFace).toBe(face);
            expect(vec.x).toBeCloseTo(0);
            expect(vec.y).toBeCloseTo(0);
            expect(vec.z).toBe(-5);
        } finally {
            restoreFactory();
        }
    });

    test.each([
        { condition: "feature.extrude.endCondition.upToFace" as I18nKeys, checked: true, z: -1 },
        { condition: "feature.extrude.endCondition.upToFace" as I18nKeys, checked: false, z: 1 },
        { condition: "feature.extrude.endCondition.blind" as I18nKeys, checked: true, z: 1 },
    ])("the skipped drag's placeholder normal flips only for a reversed up-to ($condition, checked: $checked)", ({
        condition,
        checked,
        z,
    }) => {
        const doc = new TestDocument({ application: createMockApplication() });
        const sketch = new SketchNode({
            document: doc,
            plane: Plane.XY,
            data: { entities: [], constraints: [] },
        });
        doc.modelManager.addNode(sketch);
        const cmd = new ExtrudeFeatureCommand();
        (cmd as any).stepDatas = [{ shapes: [], nodes: [sketch], type: "shape" }];
        cmd.endCondition = condition;
        cmd.oppositeDirection = checked;

        expect((cmd as any).getDragData().normal.z).toBe(z);
    });
});

describe("ExtrudeFeatureCommand push-pull operation", () => {
    /** A sketch profile at z = 100, and the drag frame the handler would report. */
    function setup() {
        const app = createMockApplication();
        const doc = new TestDocument({ application: app });
        (app as any).activeView = { document: doc };
        const sketch = new SketchNode({
            document: doc,
            plane: Plane.XY,
            data: { entities: [], constraints: [] },
        });
        const face = {
            shape: {
                shapeType: ShapeTypes.face,
                boundingBox: () => new BoundingBox({ x: -5, y: -5, z: 0 }, { x: 5, y: 5, z: 0 }),
            },
            owner: { node: sketch },
            transform: Matrix4.fromTranslation(0, 0, 100),
            indexes: [0],
            point: new XYZ({ x: 0, y: 0, z: 100 }),
        };
        return { app, doc, sketch, face };
    }

    function bodyAt(
        doc: TestDocument,
        inside: (point: any) => boolean,
        box = new BoundingBox({ x: -5, y: -5, z: 50 }, { x: 5, y: 5, z: 100 }),
    ) {
        const body = new ParametricBodyNode({ document: doc, features: [] });
        (body as any)._evaluated = true;
        (body as any)._shape = Result.ok({
            shapeType: ShapeTypes.solid,
            isEqual: () => false,
            boundingBox: () => box,
            containsPoint: inside,
            findSubShapes: () => [],
            dispose: () => {},
        });
        doc.modelManager.addNode(body);
        return body;
    }

    // The end at z = 140 sits INSIDE the box (the classification excludes the boundary), so the
    // box early-out lets it through to `containsPoint`.
    const upperBodyBox = () => new BoundingBox({ x: -5, y: -5, z: 130 }, { x: 5, y: 5, z: 170 });

    function dragged(app: any, face: any) {
        const cmd = new ExtrudeFeatureCommand();
        (cmd as any)._application = app;
        // The hand-off marker, not `pickSettled`: the whole-sketch entry leaves the drag running.
        cmd.pressPull = true;
        (cmd as any)._dragHandler = {
            state: {
                faces: [face],
                anchor: face.point,
                normal: XYZ.unitZ,
                origin: face.point,
                dist: 0,
                startOffset: 0,
                node: face.owner.node,
            },
            // The option setters push into an open drag.
            refresh: () => {},
            finishEarly: () => {},
            setStartOffset: () => {},
        };
        return cmd;
    }

    test("a drag ending inside a body cuts", () => {
        const { app, doc, face } = setup();
        bodyAt(doc, (point) => point.z <= 70);
        const cmd = dragged(app, face);

        // The anchor is at z = 100; a -40 drag ends at z = 60, inside the body.
        (cmd as any).syncPushedOperation(-40);

        expect(cmd.operation).toBe("option.command.operation.cut");
    });

    test("a drag ending outside, whose prism still meets a body, joins", () => {
        const { app, doc, face } = setup();
        bodyAt(doc, () => false);
        const cmd = dragged(app, face);

        (cmd as any).syncPushedOperation(-40);

        expect(cmd.operation).toBe("option.command.operation.join");
    });

    test("a drag that meets nothing is a body of its own", () => {
        const { app, face } = setup();
        const cmd = dragged(app, face);

        (cmd as any).syncPushedOperation(-40);

        expect(cmd.operation).toBe("option.command.operation.new");
    });

    test("an operation the user set is not talked over", () => {
        const { app, doc, face } = setup();
        bodyAt(doc, (point) => point.z <= 70);
        const cmd = dragged(app, face);
        cmd.operation = "option.command.operation.intersect";

        (cmd as any).syncPushedOperation(-40);

        expect(cmd.operation).toBe("option.command.operation.intersect");
    });

    test("a condition that measures its own depth is not decided by the drag value", () => {
        const { app, doc, face } = setup();
        // A blind -40 drag would cut here; through-all measures its own reach instead.
        bodyAt(doc, (point) => point.z <= 70);
        const cmd = dragged(app, face);
        cmd.endCondition = "feature.extrude.endCondition.throughAll";

        (cmd as any).syncPushedOperation(-40);

        expect(cmd.operation).toBe("option.command.operation.new");
    });

    test("a start offset or draft moves the prism the reading was built from", () => {
        const { app, doc, face } = setup();
        bodyAt(doc, (point) => point.z <= 70);
        const cmd = dragged(app, face);
        cmd.startOffset = 5;

        (cmd as any).syncPushedOperation(-40);

        expect(cmd.operation).toBe("option.command.operation.new");
    });

    test("only Press Pull's hand-off decides — a plain Extrude keeps its own operation", () => {
        const { app, doc, face } = setup();
        bodyAt(doc, (point) => point.z <= 70);
        const cmd = dragged(app, face);
        cmd.pressPull = false;

        (cmd as any).syncPushedOperation(-40);

        expect(cmd.operation).toBe("option.command.operation.new");
    });

    test("the opposite-direction checkbox is part of the committed sweep", () => {
        const { app, doc, face } = setup();
        bodyAt(doc, (point) => point.z >= 140, upperBodyBox());
        const cmd = dragged(app, face);

        // Without the checkbox the -40 drag goes down, away from the body.
        (cmd as any).syncPushedOperation(-40);
        expect(cmd.operation).toBe("option.command.operation.new");

        // Checked, the commit sweeps up instead — and that is where the body is.
        cmd.oppositeDirection = true;
        (cmd as any).syncPushedOperation(-40);
        expect(cmd.operation).toBe("option.command.operation.cut");
    });

    test("a symmetric sweep reads both ends", () => {
        const { app, doc, face } = setup();
        bodyAt(doc, (point) => point.z >= 140, upperBodyBox());
        const cmd = dragged(app, face);
        cmd.symmetric = true;

        // The drag goes down; symmetric lays the other half up into the body.
        (cmd as any).syncPushedOperation(-40);

        expect(cmd.operation).toBe("option.command.operation.cut");
    });

    test("an unsettled hand-off (a sketch picked as a node) is re-judged at the commit", () => {
        const { app, doc, face } = setup();
        bodyAt(doc, (point) => point.z <= 70);
        const cmd = new ExtrudeFeatureCommand();
        (cmd as any)._application = app;
        // The whole-sketch hand-off marker WITHOUT `pickSettled`: its own depth drag ran
        // here, and a gestureless confirm still gets the reading.
        cmd.pressPull = true;
        (cmd as any).stepDatas = [
            { shapes: [face], nodes: [face.owner.node], type: "shape" },
            {
                shapes: [face],
                nodes: [face.owner.node],
                type: "input",
                plane: dragPlaneOf(face.point, XYZ.unitZ),
            },
        ];

        // The anchor is at z = 100; the -40 reach ends at z = 60, inside the body.
        (cmd as any).syncCommittedOperation(face.owner.node, (cmd as any).stepDatas[1].plane, -40);

        expect(cmd.operation).toBe("option.command.operation.cut");
    });

    describe("a solid face as the profile", () => {
        /**
         * A 10×10×10 plate and its own top face (z = 10) as the picked profile — the pick the
         * Extrude command's face filter admits. No Press Pull marker: the plain command must
         * read a solid face's drag by itself, or the prism it commits is embedded invisibly
         * (a push in) or left unwelded across a slot (never joining the opposite wall).
         */
        function solidFaceSetup() {
            const app = createMockApplication();
            const doc = new TestDocument({ application: app });
            (app as any).activeView = { document: doc };
            const body = bodyAt(
                doc,
                (point) => point.z >= 0 && point.z <= 10,
                new BoundingBox({ x: -5, y: -5, z: 0 }, { x: 5, y: 5, z: 10 }),
            );
            const face = {
                shape: {
                    shapeType: ShapeTypes.face,
                    boundingBox: () => new BoundingBox({ x: -5, y: -5, z: 10 }, { x: 5, y: 5, z: 10 }),
                },
                owner: { node: body },
                transform: Matrix4.identity(),
                indexes: [0],
                point: new XYZ({ x: 0, y: 0, z: 10 }),
            };
            return { app, face };
        }

        test("pushing a solid face into its body cuts, without any hand-off marker", () => {
            const { app, face } = solidFaceSetup();
            const cmd = dragged(app, face);
            cmd.pressPull = false;

            // The anchor is at z = 10; a -5 drag ends at z = 5, inside the plate.
            (cmd as any).syncPushedOperation(-5);

            expect(cmd.operation).toBe("option.command.operation.cut");
        });

        test("pulling a solid face out joins the body it stands on", () => {
            const { app, face } = solidFaceSetup();
            const cmd = dragged(app, face);
            cmd.pressPull = false;

            // The end at z = 15 is outside, but the prism still meets the plate.
            (cmd as any).syncPushedOperation(5);

            expect(cmd.operation).toBe("option.command.operation.join");
        });

        test("a confirm without a drag gesture is still judged, at the commit", () => {
            const { app, face } = solidFaceSetup();
            const cmd = new ExtrudeFeatureCommand();
            (cmd as any)._application = app;
            cmd.pressPull = false;
            (cmd as any).stepDatas = [
                { shapes: [face], nodes: [face.owner.node], type: "shape" },
                { shapes: [face], nodes: [face.owner.node], type: "input" },
            ];

            // No `onDist` ever fired (a cached depth confirmed as-is): the commit reads the
            // reach itself. The end at z = 5 is inside the plate. (The drag step reports its
            // plane AT the anchor — `dragPlaneOf(face.point, …)` is what it would hand over.)
            (cmd as any).syncCommittedOperation(face.owner.node, dragPlaneOf(face.point, XYZ.unitZ), -5);

            expect(cmd.operation).toBe("option.command.operation.cut");
        });

        test("a settled hand-off is not re-read at the commit", () => {
            const { app, face } = solidFaceSetup();
            const cmd = new ExtrudeFeatureCommand();
            (cmd as any)._application = app;
            cmd.pressPull = true;
            cmd.pickSettled = true;
            (cmd as any).stepDatas = [
                { shapes: [face], nodes: [face.owner.node], type: "shape" },
                { shapes: [face], nodes: [face.owner.node], type: "input" },
            ];

            // Press Pull handed the operation over; re-reading would second-guess the hand-off.
            (cmd as any).syncCommittedOperation(face.owner.node, dragPlaneOf(face.point, XYZ.unitZ), -5);

            expect(cmd.operation).toBe("option.command.operation.new");
        });

        test("an operation the user set is not re-read at the commit either", () => {
            const { app, face } = solidFaceSetup();
            const cmd = new ExtrudeFeatureCommand();
            (cmd as any)._application = app;
            cmd.pressPull = false;
            cmd.operation = "option.command.operation.new";
            (cmd as any).stepDatas = [
                { shapes: [face], nodes: [face.owner.node], type: "shape" },
                { shapes: [face], nodes: [face.owner.node], type: "input" },
            ];

            (cmd as any).syncCommittedOperation(face.owner.node, dragPlaneOf(face.point, XYZ.unitZ), -5);

            expect(cmd.operation).toBe("option.command.operation.new");
        });

        test("an operation the user set is not talked over, on a solid face either", () => {
            const { app, face } = solidFaceSetup();
            const cmd = dragged(app, face);
            cmd.pressPull = false;
            cmd.operation = "option.command.operation.intersect";

            (cmd as any).syncPushedOperation(-5);

            expect(cmd.operation).toBe("option.command.operation.intersect");
        });

        test("the commit judges from the drag's anchor, not the first picked face", () => {
            const { app, face } = solidFaceSetup();
            // A second picked profile OFF the plate. The drag moved its anchor to it (a
            // shift-click follows the added profile), and from there the -5 reach ends in
            // nothing — a join. Judged from `faces[0]` (over the plate) the same reach
            // would read a cut, flipping the answer between preview and commit.
            const offPlate = {
                shape: {
                    shapeType: ShapeTypes.face,
                    boundingBox: () => new BoundingBox({ x: 15, y: 15, z: 10 }, { x: 25, y: 25, z: 10 }),
                },
                owner: face.owner,
                transform: Matrix4.identity(),
                indexes: [1],
                point: new XYZ({ x: 20, y: 20, z: 10 }),
            };
            const cmd = new ExtrudeFeatureCommand();
            (cmd as any)._application = app;
            (cmd as any).stepDatas = [
                { shapes: [face, offPlate], nodes: [face.owner.node], type: "shape" },
                // The drag step reports its plane AT the anchor it ended on.
                {
                    shapes: [face, offPlate],
                    nodes: [face.owner.node],
                    type: "input",
                    plane: dragPlaneOf(offPlate.point, XYZ.unitZ),
                },
            ];

            (cmd as any).syncCommittedOperation(face.owner.node, (cmd as any).stepDatas[1].plane, -5);

            expect(cmd.operation).toBe("option.command.operation.join");
        });

        test("an automatic operation is not left in the option cache", () => {
            const { app, face } = solidFaceSetup();
            // The user's own standing choice — `readProperties` restores it next run.
            CancelableCommand.seedOptions("feature.extrude", { operation: "option.command.operation.join" });
            try {
                const cmd = dragged(app, face);
                (cmd as any).beforeExecute();
                expect(cmd.operation).toBe("option.command.operation.join");

                // The drag's reading answers cut for THIS run…
                (cmd as any).syncPushedOperation(-5);
                expect(cmd.operation).toBe("option.command.operation.cut");
                (cmd as any).afterExecute();

                // …and the next run still opens on the user's choice, not the reading.
                const next = new ExtrudeFeatureCommand();
                (next as any)._application = app;
                (next as any).beforeExecute();
                expect(next.operation).toBe("option.command.operation.join");
            } finally {
                (CancelableCommand as any)._propertiesCache.delete("feature.extrude:operation");
            }
        });

        test("a user override of the reading is the value the cache keeps", () => {
            const { app, face } = solidFaceSetup();
            (CancelableCommand as any)._propertiesCache.delete("feature.extrude:operation");
            try {
                const cmd = dragged(app, face);
                (cmd as any).beforeExecute();
                (cmd as any).syncPushedOperation(-5);
                expect(cmd.operation).toBe("option.command.operation.cut");
                // The panel wins over the reading — and it is the panel that sticks.
                cmd.operation = "option.command.operation.join";
                (cmd as any).afterExecute();

                const next = new ExtrudeFeatureCommand();
                (next as any)._application = app;
                (next as any).beforeExecute();
                expect(next.operation).toBe("option.command.operation.join");
            } finally {
                (CancelableCommand as any)._propertiesCache.delete("feature.extrude:operation");
            }
        });

        test("a handed-off operation applies to the run but is never cached", () => {
            const { app } = solidFaceSetup();
            (CancelableCommand as any)._propertiesCache.delete("feature.extrude:operation");
            try {
                const cmd = new ExtrudeFeatureCommand();
                (cmd as any)._application = app;
                cmd.handoffOperation = "option.command.operation.cut";
                (cmd as any).beforeExecute();

                // Shown and effective for the run…
                expect(cmd.operation).toBe("option.command.operation.cut");
                expect(cmd.showTargets).toBe(true);
                (cmd as any).afterExecute();

                // …but it rode the instance, not the cache: the next plain extrude opens on New.
                const next = new ExtrudeFeatureCommand();
                (next as any)._application = app;
                (next as any).beforeExecute();
                expect(next.operation).toBe("option.command.operation.new");
            } finally {
                (CancelableCommand as any)._propertiesCache.delete("feature.extrude:operation");
            }
        });

        test("an operation the user set still sticks for the next run", () => {
            const { app } = solidFaceSetup();
            (CancelableCommand as any)._propertiesCache.delete("feature.extrude:operation");
            try {
                const cmd = new ExtrudeFeatureCommand();
                (cmd as any)._application = app;
                (cmd as any).beforeExecute();
                cmd.operation = "option.command.operation.intersect";
                (cmd as any).afterExecute();

                const next = new ExtrudeFeatureCommand();
                (next as any)._application = app;
                (next as any).beforeExecute();
                expect(next.operation).toBe("option.command.operation.intersect");
            } finally {
                (CancelableCommand as any)._propertiesCache.delete("feature.extrude:operation");
            }
        });
    });
});
