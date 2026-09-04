// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    BoundingBox,
    Matrix4,
    Plane,
    PubSub,
    Result,
    type ShapeType,
    ShapeTypes,
    XYZ,
} from "@chili3d/core";
import { createMockApplication, TestDocument } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { RevolveFeatureCommand } from "../../src/commands/revolveCommand";
import type { RevolveFeatureData } from "../../src/features/feature";
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
                    startPoint: () => start,
                    endPoint: () => end,
                    firstParameter: () => 0,
                    lastParameter: () => 1,
                    pointAt: (t: number) => start.add(end.sub(start).multiply(t)),
                    intersect: () => [],
                    isEqual: () => false,
                }),
            combine: (edges: any[]) =>
                Result.ok({
                    shapeType: ShapeTypes.compound,
                    matrix: Matrix4.identity(),
                    isEqual: () => false,
                    dispose: () => {},
                    findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? edges : []),
                }),
            wire: (edges: any[]) => Result.ok({ isClosed: () => edges.length > 1, edges }),
            face: (wires: any[]) =>
                Result.ok({
                    shapeType: ShapeTypes.face,
                    matrix: Matrix4.identity(),
                    boundingBox: () => new BoundingBox({ x: 5, y: 0, z: 0 }, { x: 15, y: 10, z: 0 }),
                    area: () => 0,
                    isEqual: () => false,
                    dispose: () => {},
                    findSubShapes: (type: ShapeType) =>
                        type === ShapeTypes.edge ? wires.flatMap((w: any) => w.edges) : [],
                }),
            revolve: () =>
                Result.ok({
                    shapeType: ShapeTypes.solid,
                    isEqual: () => false,
                    dispose: () => {},
                    findSubShapes: () => [],
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

function lineEdgeData(sketch: SketchNode, start: XYZ, direction: XYZ, transform = Matrix4.identity()) {
    const end = start.add(direction.multiply(10));
    return {
        shape: {
            shapeType: ShapeTypes.edge,
            curve: { basisCurve: { value: () => start, direction } },
            startPoint: () => start,
            endPoint: () => end,
        },
        owner: { node: sketch },
        transform,
        indexes: [0],
    } as any;
}

function profileFaceData(sketch: SketchNode) {
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

describe("RevolveFeatureCommand profile step", () => {
    test("picks sketch profile faces; parametric bodies are rejected", async () => {
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

        const step = (new RevolveFeatureCommand() as any).getSteps()[0];
        const result = await step.execute(doc, new AsyncController());

        expect(result).toBeUndefined();
        expect(pickShape).toHaveBeenCalledTimes(1);
        const options = pickShape.mock.calls[0][2] as any;
        expect(options.shapeType).toBe(ShapeTypes.face);
        expect(options.nodeFilter.allow(sketch)).toBe(true);
        expect(options.nodeFilter.allow(new ParametricBodyNode({ document: doc, features: [] }))).toBe(false);
    });
});

describe("RevolveFeatureCommand axis step", () => {
    let doc: TestDocument;
    let sketch: SketchNode;

    beforeEach(() => {
        doc = new TestDocument({ application: createMockApplication() });
        sketch = new SketchNode({ document: doc, plane: Plane.XY, data: square });
    });

    function axisStep() {
        const cmd = new RevolveFeatureCommand() as any;
        cmd.stepDatas = [{ shapes: [], nodes: [sketch], type: "node" }];
        const steps = cmd.getSteps();
        expect(steps.length).toBe(2);
        return steps[1];
    }

    test("the axis step picks a single edge and keeps the sketch selected", () => {
        const step = axisStep() as any;
        expect(step.snapeType).toBe(ShapeTypes.edge);
        expect(step.prompt).toBe("prompt.select.axis");
        expect(step.options.keepSelection).toBe(true);
        expect(step.options.multiple).toBeUndefined();
    });

    test("the axis step accepts line edges of any node, not just the sketch", () => {
        const step = axisStep() as any;
        expect(step.options.nodeFilter).toBeUndefined();
    });

    test("the axis step accepts only line edges", () => {
        const step = axisStep() as any;
        const allow = step.options.shapeFilter.allow;
        const lineEdge = { shapeType: ShapeTypes.edge, curve: { basisCurve: { direction: XYZ.unitY } } };
        const circleEdge = {
            shapeType: ShapeTypes.edge,
            curve: { basisCurve: { center: XYZ.zero, radius: 5 } },
        };
        expect(allow(lineEdge, Matrix4.identity())).toBe(true);
        expect(allow(circleEdge, Matrix4.identity())).toBe(false);
        expect(allow({ shapeType: ShapeTypes.face }, Matrix4.identity())).toBe(false);
    });
});

describe("RevolveFeatureCommand execution", () => {
    function scenario(angle: number, withProfileFace = true) {
        const restoreFactory = mockShapeFactory();
        const app = createMockApplication();
        const doc = new TestDocument({ application: app });
        (app as any).activeView = { document: doc };
        const sketch = new SketchNode({ document: doc, plane: Plane.XY, data: square });
        doc.modelManager.addNode(sketch);

        const cmd = new RevolveFeatureCommand();
        (cmd as any)._application = app;
        cmd.angle = angle;
        // The axis edge comes from another node with a translation transform —
        // the axis is not restricted to the revolved sketch.
        const axisNode = new SketchNode({ document: doc, plane: Plane.XY, data: square });
        (cmd as any).stepDatas = [
            {
                shapes: withProfileFace ? [profileFaceData(sketch)] : [],
                nodes: [sketch],
                type: "shape",
            },
            {
                shapes: [
                    lineEdgeData(
                        axisNode,
                        new XYZ({ x: 5, y: 0, z: 0 }),
                        XYZ.unitY,
                        Matrix4.fromTranslation(100, 0, 0),
                    ),
                ],
                nodes: [axisNode],
                type: "shape",
            },
        ];
        return { restoreFactory, doc, sketch, axisNode, cmd };
    }

    test("commits immediately with the angle from the options tab", () => {
        const { restoreFactory, doc, sketch, axisNode, cmd } = scenario(90);
        try {
            (cmd as any).executeMainTask();

            const body = doc.modelManager.findNode(
                (node) => node instanceof ParametricBodyNode,
            ) as ParametricBodyNode;
            expect(body).toBeInstanceOf(ParametricBodyNode);
            expect(body.features.length).toBe(1);
            const feature = body.features[0] as RevolveFeatureData;
            expect(feature).toMatchObject({ type: "revolve", sketchId: sketch.id, angle: 90 });
            expect(feature.axis.point).toEqual({ x: 105, y: 0, z: 0 });
            expect(feature.axis.direction).toEqual({ x: 0, y: 1, z: 0 });
            expect(feature.profiles?.length).toBe(1);
            expect(feature.profiles![0].edges.length).toBe(4);
            expect(feature.profiles![0].edges[0]).toMatchObject({
                kind: "line",
                start: { x: 5, y: 0, z: 0 },
                end: { x: 15, y: 0, z: 0 },
            });
            // The axis is also stored as a fingerprinted edge reference (local coords),
            // so it follows the source node on rebuild; `axis` stays the fallback snapshot.
            expect(feature.axisSource?.nodeId).toBe(axisNode.id);
            expect(feature.axisSource?.edge).toMatchObject({
                kind: "line",
                start: { x: 5, y: 0, z: 0 },
                end: { x: 5, y: 10, z: 0 },
            });
            expect(sketch.visible).toBe(false);

            doc.history.undo();
            expect(sketch.visible).toBe(true);
            expect(doc.modelManager.findNode((node) => node instanceof ParametricBodyNode)).toBeUndefined();
        } finally {
            restoreFactory();
        }
    });

    test("revolves every profile when no faces were picked", () => {
        const { restoreFactory, doc, cmd } = scenario(90, false);
        try {
            (cmd as any).executeMainTask();

            const body = doc.modelManager.findNode(
                (node) => node instanceof ParametricBodyNode,
            ) as ParametricBodyNode;
            expect((body.features[0] as RevolveFeatureData).profiles).toBeUndefined();
        } finally {
            restoreFactory();
        }
    });

    test("a zero or invalid angle toasts instead of creating a body", () => {
        const { restoreFactory, doc, cmd } = scenario(0);
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            (cmd as any).executeMainTask();

            expect(pub).toHaveBeenCalledWith("showToast", "error.input.invalidNumber");
            expect(doc.modelManager.findNode((node) => node instanceof ParametricBodyNode)).toBeUndefined();
        } finally {
            pub.mockRestore();
            restoreFactory();
        }
    });
});
