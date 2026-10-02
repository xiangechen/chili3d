// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    BoundingBox,
    type I18nKeys,
    type INode,
    Matrix4,
    Plane,
    Result,
    type ShapeMeshData,
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

/** The preview meshes the mock hands out, so a test can tell which shape reached the viewport. */
const TOOL_PREVIEW_COLOR = 0;
const BOOLEAN_PREVIEW_COLOR = 1;

function mockShapeFactory() {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "shapeFactory");
    // The profile faces `sketchProfiles` builds — kept, so a test can pin how often the
    // command asks for them and whether it frees them.
    const profileFaces: { disposed: boolean; dispose: () => void }[] = [];
    const face = rs.fn((wires: any[]) => {
        const built = {
            shapeType: ShapeTypes.face,
            matrix: Matrix4.identity(),
            boundingBox: () => new BoundingBox({ x: 5, y: 0, z: 0 }, { x: 15, y: 10, z: 0 }),
            area: () => 0,
            isEqual: () => false,
            disposed: false,
            dispose: () => {
                built.disposed = true;
            },
            outerWire: () => wires[0],
            findSubShapes: (type: ShapeType) =>
                type === ShapeTypes.edge ? wires.flatMap((w: any) => w.edges) : [],
        };
        profileFaces.push(built);
        return Result.ok(built);
    });
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
            face,
            sweep: () =>
                Result.ok({
                    shapeType: ShapeTypes.solid,
                    isEqual: () => false,
                    dispose: () => {},
                    findSubShapes: () => [],
                    boundingBox: () => new BoundingBox({ x: 0, y: 0, z: 0 }, { x: 15, y: 10, z: 10 }),
                    // A solid's own faces — what the preview displays (see `displayVisual`).
                    mesh: { faces: { color: TOOL_PREVIEW_COLOR } },
                }),
            booleanFuse: () =>
                Result.ok({
                    shapeType: ShapeTypes.solid,
                    isEqual: () => false,
                    dispose: () => {},
                    findSubShapes: () => [],
                    boundingBox: () => new BoundingBox({ x: 0, y: 0, z: 0 }, { x: 15, y: 10, z: 10 }),
                    mesh: { faces: { color: BOOLEAN_PREVIEW_COLOR } },
                }),
        },
        writable: true,
        configurable: true,
    });
    return {
        face,
        profileFaces,
        restore: () => {
            if (previous) {
                Object.defineProperty(globalThis, "shapeFactory", previous);
            } else {
                delete (globalThis as any).shapeFactory;
            }
        },
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

    // One edge per click is what leaves room to sweep and show the tool between picks; a
    // multi pick resolves once, at the end. With no picked-count to report, the bar's
    // confirm is the only way to end the list.
    test("the path step picks one edge per click, ended from the viewport bar", () => {
        const step = pathStep() as any;
        expect(step.snapeType).toBe(ShapeTypes.edge);
        expect(step.prompt).toBe("prompt.select.path");
        expect(step.options.keepSelection).toBe(false);
        expect(step.options.multiple).toBe(false);
        expect(step.options.showConfirmControl).toBe(true);
    });

    test("the path step accepts edges of any node, not just the sketch", () => {
        const step = pathStep() as any;
        expect(step.options.nodeFilter).toBeUndefined();
        expect(step.options.shapeFilter).toBeUndefined();
    });
});

describe("SweepFeatureCommand execution", () => {
    function scenario(withProfileFace = true) {
        const { restore: restoreFactory, face, profileFaces } = mockShapeFactory();
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
        return { restoreFactory, doc, sketch, pathNode, cmd, face, profileFaces };
    }

    // The preview asks for the tool again after every path pick, and `sketchProfiles` makes
    // fresh faces on each call — the whole sketch's profiles are the run's, built once.
    test("builds the whole sketch's profiles once and frees them with the run", () => {
        const { restoreFactory, cmd, face, profileFaces } = scenario(false);
        try {
            expect((cmd as any).buildToolShape().isOk).toBe(true);
            expect((cmd as any).buildToolShape().isOk).toBe(true);

            expect(face).toHaveBeenCalledTimes(1);
            expect(profileFaces[0].disposed).toBe(false);

            (cmd as any).afterExecute();
            expect(profileFaces[0].disposed).toBe(true);
        } finally {
            restoreFactory();
        }
    });

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

describe("SweepFeatureCommand path pick loop", () => {
    /**
     * Drives the whole command the way the viewport does: one profile pick, then one path
     * edge per call, and finally the bar's confirm (an empty pick that reports success) or
     * its cancel. The options are set on the first call — `beforeExecute` restores the LAST
     * command's values from the static cache, so setting them up front is overwritten.
     */
    function scenario(
        edgeCount: number,
        end: "confirm" | "cancel" = "confirm",
        operation: I18nKeys = "option.command.operation.new",
        withProfileFace = true,
    ) {
        const { restore: restoreFactory, face } = mockShapeFactory();
        const app = createMockApplication();
        const doc = new TestDocument({ application: app });
        (app as any).activeView = { document: doc };
        doc.selection = {
            getSelectedShapes: () => [],
            getSelectedNodes: () => [],
            clearSelection: () => {},
        } as any;

        const sketch = new SketchNode({ document: doc, plane: Plane.XY, data: square });
        doc.modelManager.addNode(sketch);
        // The path edges come from another node — the path is not restricted to the sketch.
        const pathNode = new SketchNode({ document: doc, plane: Plane.XY, data: square });
        doc.modelManager.addNode(pathNode);
        const edges = Array.from({ length: edgeCount }, (_, i) =>
            pathEdgeData(
                pathNode,
                new XYZ({ x: i * 10, y: 0, z: 0 }),
                new XYZ({ x: (i + 1) * 10, y: 0, z: 0 }),
            ),
        );

        // The preview is the command's own mesh on the viewport's display list.
        const displayMesh = rs.fn((_meshes: ShapeMeshData[]) => 7);
        const removeMesh = rs.fn(() => {});
        const setVisible = rs.fn((_node: INode, _visible: boolean) => {});
        doc.visual.context.displayMesh = displayMesh;
        doc.visual.context.removeMesh = removeMesh;
        doc.visual.context.setVisible = setVisible;

        const cmd = new SweepFeatureCommand();
        let next = 0;
        doc.picker = {
            pickShape: rs.fn((prompt: string, controller: AsyncController) => {
                if (prompt !== "prompt.select.path") {
                    cmd.operation = operation;
                    return Promise.resolve(withProfileFace ? [profileFaceData(sketch)] : []);
                }
                const edge = edges[next++];
                if (edge !== undefined) return Promise.resolve([edge]);
                if (end === "confirm") controller.success();
                else controller.cancel();
                return Promise.resolve([]);
            }),
        } as any;

        const committed = () =>
            doc.modelManager.findNode((node) => node instanceof ParametricBodyNode) as
                | ParametricBodyNode
                | undefined;
        return { restoreFactory, app, doc, cmd, displayMesh, removeMesh, setVisible, face, committed };
    }

    test("re-sweeps the preview on every path pick, not once at the end", async () => {
        const { restoreFactory, app, cmd, displayMesh, removeMesh, committed } = scenario(2);
        try {
            await cmd.execute(app);

            // One preview per picked edge — the second pick cannot have been the first to
            // build the tool, since the mock sweep result is only ever displayed.
            expect(displayMesh).toHaveBeenCalledTimes(2);
            const feature = committed()!.features[0] as SweepFeatureData;
            expect(feature.path.edges.length).toBe(2);
            // The preview is the command's and goes away with it.
            expect(removeMesh).toHaveBeenCalledTimes(2);
        } finally {
            restoreFactory();
        }
    });

    test("a cancelled path pick takes the preview down and commits nothing", async () => {
        const { restoreFactory, app, cmd, displayMesh, removeMesh, committed } = scenario(1, "cancel");
        try {
            await cmd.execute(app);

            expect(displayMesh).toHaveBeenCalledTimes(1);
            expect(removeMesh).toHaveBeenCalledTimes(1);
            expect(committed()).toBeUndefined();
        } finally {
            restoreFactory();
        }
    });

    test("confirming with no path edge commits nothing and shows no preview", async () => {
        const { restoreFactory, app, cmd, displayMesh, removeMesh, committed } = scenario(0);
        try {
            await cmd.execute(app);

            expect(displayMesh).not.toHaveBeenCalled();
            expect(removeMesh).not.toHaveBeenCalled();
            expect(committed()).toBeUndefined();
        } finally {
            restoreFactory();
        }
    });

    test("an operation previews the boolean result and stands in for the target body", async () => {
        const { restoreFactory, app, doc, cmd, displayMesh, setVisible, committed } = scenario(
            1,
            "confirm",
            "option.command.operation.join",
        );
        // A body in the swept tool's way — the box the mock sweep reports.
        const target = new ParametricBodyNode({ document: doc, features: [] });
        doc.modelManager.addNode(target);
        try {
            await cmd.execute(app);

            // What reached the viewport is the boolean's output, not the bare tool: the mock
            // gives the two different meshes.
            expect(displayMesh.mock.calls.at(-1)![0][0].color).toBe(BOOLEAN_PREVIEW_COLOR);
            // The body it stands in for is put away while it shows, and given back when the
            // command ends rather than left invisible. (The commit hides the consumed sketch
            // through the same call, hence the filter.)
            const targetCalls = setVisible.mock.calls.filter((call) => call[0] === target);
            expect(targetCalls.map((call) => call[1])).toEqual([false, true]);
            // The commit lands on the same body the preview stood in for.
            expect(committed()).toBe(target);
            expect(target.features[0]).toMatchObject({ type: "sweep", operation: "fuse" });
        } finally {
            restoreFactory();
        }
    });

    test("no operation previews the swept tool itself", async () => {
        const { restoreFactory, app, displayMesh, cmd } = scenario(1);
        try {
            await cmd.execute(app);

            expect(displayMesh.mock.calls.at(-1)![0][0].color).toBe(TOOL_PREVIEW_COLOR);
        } finally {
            restoreFactory();
        }
    });
});
