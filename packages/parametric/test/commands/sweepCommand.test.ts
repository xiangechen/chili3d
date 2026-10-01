// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    BoundingBox,
    Matrix4,
    Plane,
    Result,
    type ShapeType,
    ShapeTypes,
    XYZ,
} from "@chili3d/core";
import { createMockApplication, nearestOnSegment, TestDocument } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { SweepFeatureCommand } from "../../src/commands/sweepCommand";
import type { SweepFeatureData } from "../../src/features/feature";
import { ParametricBodyNode } from "../../src/parametricBodyNode";
import type { SketchData } from "../../src/sketch/sketchModel";
import { SketchNode } from "../../src/sketch/sketchNode";

const square: SketchData = {
    entities: [
        { id: 1, type: "line", params: [5, 0, 15, 0] },
        { id: 2, type: "line", params: [15, 0, 15, 10] },
        { id: 3, type: "line", params: [15, 10, 5, 10] },
        { id: 4, type: "line", params: [5, 10, 5, 0] },
    ],
    constraints: [],
};

function mockShapeFactory() {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "shapeFactory");
    Object.defineProperty(globalThis, "shapeFactory", {
        value: {
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
                    isEqual: () => false,
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
                }),
            combine: (edges: any[]) =>
                Result.ok({
                    shapeType: ShapeTypes.compound,
                    matrix: Matrix4.identity(),
                    isEqual: () => false,
                    dispose: () => {},
                    findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? edges : []),
                    boundingBox: () => new BoundingBox({ x: 0, y: 0, z: 0 }, { x: 20, y: 20, z: 5 }),
                }),
            wire: (edges: any[]) =>
                Result.ok({
                    isClosed: () => edges.length > 1,
                    edges,
                    dispose: () => {},
                    findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? edges : []),
                }),
            face: (wires: any[]) =>
                Result.ok({
                    shapeType: ShapeTypes.face,
                    matrix: Matrix4.identity(),
                    boundingBox: () => new BoundingBox({ x: 5, y: 0, z: 0 }, { x: 15, y: 10, z: 0 }),
                    area: () => 0,
                    isEqual: () => false,
                    dispose: () => {},
                    outerWire: () => wires[0],
                    findSubShapes: (type: ShapeType) =>
                        type === ShapeTypes.edge ? wires.flatMap((w: any) => w.edges) : [],
                }),
            sweep: () =>
                Result.ok({
                    shapeType: ShapeTypes.solid,
                    isEqual: () => false,
                    dispose: () => {},
                    findSubShapes: () => [],
                    boundingBox: () => new BoundingBox({ x: 0, y: 0, z: 0 }, { x: 15, y: 10, z: 10 }),
                }),
        },
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

function pathEdgeData(node: SketchNode, start: XYZ, end: XYZ) {
    return {
        shape: {
            shapeType: ShapeTypes.edge,
            curve: { basisCurve: { direction: end.sub(start).normalize() } },
            startPoint: () => start,
            endPoint: () => end,
        },
        owner: { node },
        transform: Matrix4.identity(),
        indexes: [0],
    } as any;
}

function profileFaceData(sketch: SketchNode | ParametricBodyNode) {
    const corners = [
        [5, 0],
        [15, 0],
        [15, 10],
        [5, 10],
    ];
    const edges = corners.map(([x, y], i) => {
        const [x2, y2] = corners[(i + 1) % corners.length];
        const start = new XYZ({ x, y, z: 0 });
        const end = new XYZ({ x: x2, y: y2, z: 0 });
        return {
            curve: { basisCurve: { direction: end.sub(start).normalize() } },
            startPoint: () => start,
            endPoint: () => end,
        };
    });
    return {
        shape: {
            shapeType: ShapeTypes.face,
            outerWire: () => ({ findSubShapes: () => edges }),
            area: () => 0,
            boundingBox: () => BoundingBox.zero,
        },
        owner: { node: sketch },
        transform: Matrix4.identity(),
        indexes: [0],
    } as any;
}

/** A body-face pick: the profile face plus the outward normal the source ref captures. */
function bodyFaceData(node: ParametricBodyNode) {
    const data = profileFaceData(node);
    (data.shape as any).normal = () => [XYZ.zero, XYZ.unitZ];
    return data;
}

describe("SweepFeatureCommand profile step", () => {
    test("picks sketch profile faces and planar body faces", async () => {
        const app = createMockApplication();
        const doc = new TestDocument({ application: app });
        (app as any).activeView = { document: doc };
        const sketch = new SketchNode({ document: doc, plane: Plane.XY, data: square });
        doc.selection = {
            getSelectedShapes: () => [],
            getSelectedNodes: () => [],
            clearSelection: () => {},
        } as any;
        const pickShape = rs.fn((_prompt: any, _controller: any, _options?: any) => Promise.resolve([]));
        doc.picker = { pickShape } as any;

        const step = (new SweepFeatureCommand() as any).getSteps()[0];
        const result = await step.execute(doc, new AsyncController());

        expect(result).toBeUndefined();
        expect(pickShape).toHaveBeenCalledTimes(1);
        const options = pickShape.mock.calls[0][2] as any;
        expect(options.shapeType).toBe(ShapeTypes.face);
        expect(options.nodeFilter.allow(sketch)).toBe(true);
        // A parametric body is a profile source too (press-pull style); only planar faces.
        expect(options.nodeFilter.allow(new ParametricBodyNode({ document: doc, features: [] }))).toBe(true);
        const planar = { surface: () => ({ isPlanar: () => true }) };
        const curved = { surface: () => ({ isPlanar: () => false }) };
        expect(options.shapeFilter.allow(planar)).toBe(true);
        expect(options.shapeFilter.allow(curved)).toBe(false);
    });
});

describe("SweepFeatureCommand path step", () => {
    let doc: TestDocument;
    let sketch: SketchNode;

    beforeEach(() => {
        doc = new TestDocument({ application: createMockApplication() });
        sketch = new SketchNode({ document: doc, plane: Plane.XY, data: square });
    });

    function pathStep() {
        const cmd = new SweepFeatureCommand() as any;
        cmd.stepDatas = [{ shapes: [], nodes: [sketch], type: "node" }];
        const steps = cmd.getSteps();
        expect(steps.length).toBe(2);
        return steps[1];
    }

    test("the path step picks edges with the profile selection cleared", () => {
        const step = pathStep() as any;
        expect(step.snapeType).toBe(ShapeTypes.edge);
        expect(step.prompt).toBe("prompt.select.path");
        expect(step.options.keepSelection).toBe(false);
        expect(step.options.multiple).toBe(true);
    });

    test("the path step accepts edges of any node, not just the sketch", () => {
        const step = pathStep() as any;
        expect(step.options.nodeFilter).toBeUndefined();
        expect(step.options.shapeFilter).toBeUndefined();
    });
});

describe("SweepFeatureCommand execution", () => {
    function scenario(withProfileFace = true) {
        const restoreFactory = mockShapeFactory();
        const app = createMockApplication();
        const doc = new TestDocument({ application: app });
        (app as any).activeView = { document: doc };
        const sketch = new SketchNode({ document: doc, plane: Plane.XY, data: square });
        doc.modelManager.addNode(sketch);

        // The path edges come from another node — the path is not restricted to the swept sketch.
        const pathNode = new SketchNode({ document: doc, plane: Plane.XY, data: square });
        doc.modelManager.addNode(pathNode);
        const pathEdges = [
            pathEdgeData(pathNode, new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 10, y: 0, z: 0 })),
            pathEdgeData(pathNode, new XYZ({ x: 10, y: 0, z: 0 }), new XYZ({ x: 10, y: 10, z: 0 })),
        ];

        const cmd = new SweepFeatureCommand();
        (cmd as any)._application = app;
        (cmd as any).stepDatas = [
            {
                shapes: withProfileFace ? [profileFaceData(sketch)] : [],
                nodes: [sketch],
                type: "shape",
            },
            { shapes: pathEdges, nodes: [pathNode], type: "shape" },
        ];
        return { restoreFactory, doc, sketch, pathNode, cmd };
    }

    test("commits a body whose feature fingerprints the profiles and the path edges", () => {
        const { restoreFactory, doc, sketch, pathNode, cmd } = scenario();
        try {
            (cmd as any).executeMainTask();

            const body = doc.modelManager.findNode(
                (node) => node instanceof ParametricBodyNode,
            ) as ParametricBodyNode;
            expect(body).toBeInstanceOf(ParametricBodyNode);
            expect(body.features.length).toBe(1);
            const feature = body.features[0] as SweepFeatureData;
            expect(feature).toMatchObject({ type: "sweep", sketchId: sketch.id, isRoundCorner: false });
            expect(feature.profiles?.length).toBe(1);
            expect(feature.profiles![0].edges.length).toBe(4);
            expect(feature.profiles![0].edges[0]).toMatchObject({
                kind: "line",
                start: { x: 5, y: 0, z: 0 },
                end: { x: 15, y: 0, z: 0 },
            });
            // The path is stored as fingerprinted edge references (local coords), so it
            // follows the source node on rebuild.
            expect(feature.path.nodeId).toBe(pathNode.id);
            expect(feature.path.edges.length).toBe(2);
            expect(feature.path.edges[0]).toMatchObject({
                kind: "line",
                start: { x: 0, y: 0, z: 0 },
                end: { x: 10, y: 0, z: 0 },
            });
            expect(feature.path.edges[1]).toMatchObject({
                kind: "line",
                start: { x: 10, y: 0, z: 0 },
                end: { x: 10, y: 10, z: 0 },
            });
            expect(sketch.visible).toBe(false);
            expect(pathNode.visible).toBe(true);

            doc.history.undo();
            expect(sketch.visible).toBe(true);
            expect(doc.modelManager.findNode((node) => node instanceof ParametricBodyNode)).toBeUndefined();
        } finally {
            restoreFactory();
        }
    });

    test("sweeps every profile when no faces were picked", () => {
        const { restoreFactory, doc, cmd } = scenario(false);
        try {
            (cmd as any).executeMainTask();

            const body = doc.modelManager.findNode(
                (node) => node instanceof ParametricBodyNode,
            ) as ParametricBodyNode;
            expect((body.features[0] as SweepFeatureData).profiles).toBeUndefined();
        } finally {
            restoreFactory();
        }
    });

    test("keeps only the path edges of the first picked edge's node", () => {
        const { restoreFactory, doc, pathNode, cmd } = scenario();
        const otherNode = new SketchNode({ document: doc, plane: Plane.XY, data: square });
        doc.modelManager.addNode(otherNode);
        const shapes = (cmd as any).stepDatas[1].shapes;
        shapes.push(pathEdgeData(otherNode, new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 0, y: 5, z: 0 })));
        try {
            (cmd as any).executeMainTask();

            const body = doc.modelManager.findNode(
                (node) => node instanceof ParametricBodyNode,
            ) as ParametricBodyNode;
            const feature = body.features[0] as SweepFeatureData;
            expect(feature.path.nodeId).toBe(pathNode.id);
            expect(feature.path.edges.length).toBe(2);
        } finally {
            restoreFactory();
        }
    });

    test("stores the isRoundCorner option", () => {
        const { restoreFactory, doc, cmd } = scenario();
        try {
            cmd.isRoundCorner = true;
            (cmd as any).executeMainTask();

            const body = doc.modelManager.findNode(
                (node) => node instanceof ParametricBodyNode,
            ) as ParametricBodyNode;
            expect((body.features[0] as SweepFeatureData).isRoundCorner).toBe(true);
        } finally {
            restoreFactory();
        }
    });

    test("join appends the feature to the intersecting body instead of creating one", () => {
        const { restoreFactory, doc, cmd } = scenario();
        // An existing body whose box (0..20, 0..20, 0..5) intersects the swept tool's.
        const target = new ParametricBodyNode({ document: doc, features: [] });
        doc.modelManager.addNode(target);
        try {
            cmd.operation = "option.command.operation.join";
            (cmd as any).executeMainTask();

            expect(target.features.length).toBe(1);
            expect(target.features[0]).toMatchObject({ type: "sweep", operation: "fuse" });
            // No standalone body was created — the target is the only one.
            const bodies = doc.modelManager.findNodes((node) => node instanceof ParametricBodyNode);
            expect(bodies).toEqual([target]);
        } finally {
            restoreFactory();
        }
    });

    test("join without an intersecting body creates a standalone body without operation", () => {
        const { restoreFactory, doc, cmd } = scenario();
        try {
            cmd.operation = "option.command.operation.join";
            (cmd as any).executeMainTask();

            const body = doc.modelManager.findNode(
                (node) => node instanceof ParametricBodyNode,
            ) as ParametricBodyNode;
            expect(body).toBeInstanceOf(ParametricBodyNode);
            expect((body.features[0] as SweepFeatureData).operation).toBeUndefined();
        } finally {
            restoreFactory();
        }
    });

    test("a body face pick commits a source feature and keeps the body visible", () => {
        const { restoreFactory, doc, sketch, cmd } = scenario();
        const source = new ParametricBodyNode({ document: doc, features: [] });
        doc.modelManager.addNode(source);
        (cmd as any).stepDatas[0] = { shapes: [bodyFaceData(source)], nodes: [source], type: "shape" };
        try {
            (cmd as any).executeMainTask();

            const body = doc.modelManager.findNode(
                (node) => node instanceof ParametricBodyNode && node !== source,
            ) as ParametricBodyNode;
            expect(body).toBeInstanceOf(ParametricBodyNode);
            const feature = body.features[0] as SweepFeatureData;
            expect(feature.sketchId).toBeUndefined();
            expect(feature.source?.nodeId).toBe(source.id);
            expect(feature.source?.profiles.length).toBe(1);
            // World-coordinate fingerprint with the outward normal (the press-pull
            // `source` contract).
            expect(feature.source?.profiles[0].normal).toEqual({ x: 0, y: 0, z: 1 });
            // Neither the source body nor the swept body is hidden — only sketches are.
            expect(source.visible).toBe(true);
            expect(sketch.visible).toBe(true);
        } finally {
            restoreFactory();
        }
    });
});
