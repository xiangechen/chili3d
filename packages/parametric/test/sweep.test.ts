// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    BoundingBox,
    EditableShapeNode,
    type I18nKeys,
    Matrix4,
    Plane,
    PubSub,
    Result,
    type ShapeType,
    ShapeTypes,
    Signal,
    VisualStates,
    XYZ,
} from "@chili3d/core";
import { createMockApplication, nearestOnSegment, TestDocument } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { type SketchData, SketchNode } from "../src/sketch";
import "../src/features"; // registers all feature handlers
import { captureEdgeRef, type EdgeRef } from "../src/features/edgeRef";
import { featureHandler, type SweepFeatureData } from "../src/features/feature";
import { captureProfileRef, type ProfileRef } from "../src/features/profileRef";
import { ParametricBodyNode } from "../src/parametricBodyNode";

function mockShapeFactory(methods: Record<string, (...args: any[]) => any>) {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "shapeFactory");
    Object.defineProperty(globalThis, "shapeFactory", { value: methods, writable: true, configurable: true });
    return () => {
        if (previous) {
            Object.defineProperty(globalThis, "shapeFactory", previous);
        } else {
            delete (globalThis as any).shapeFactory;
        }
    };
}

const SQUARE: SketchData = {
    entities: [
        { id: 1, type: "line", params: [0, 0, 1, 0] },
        { id: 2, type: "line", params: [1, 0, 1, 1] },
        { id: 3, type: "line", params: [1, 1, 0, 1] },
        { id: 4, type: "line", params: [0, 1, 0, 0] },
    ],
    constraints: [],
};

function edge(start: XYZ, end: XYZ) {
    const self: any = {
        shapeType: ShapeTypes.edge,
        curve: {
            basisCurve: { direction: { x: end.x - start.x, y: end.y - start.y, z: end.z - start.z } },
            nearestFromPoint: (point: XYZ) => nearestOnSegment(start, end, point),
        },
        startPoint: () => start,
        endPoint: () => end,
        firstParameter: () => 0,
        lastParameter: () => 1,
        pointAt: (t: number) => start.add(end.sub(start).multiply(t)),
        intersect: () => [],
        boundingBox: () =>
            new BoundingBox(
                { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), z: Math.min(start.z, end.z) },
                { x: Math.max(start.x, end.x), y: Math.max(start.y, end.y), z: Math.max(start.z, end.z) },
            ),
        isEqual: () => false,
        isSame: (other: any) => other === self,
        findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? [self] : []),
    };
    return self;
}

function setupMocks() {
    const sweptShape = {
        shapeType: ShapeTypes.solid,
        isEqual: () => false,
        dispose: rs.fn(),
        findSubShapes: () => [],
    };
    const line = rs.fn((start: XYZ, end: XYZ) => Result.ok(edge(start, end)));
    const combine = rs.fn((edges: any[]) =>
        Result.ok({
            shapeType: ShapeTypes.compound,
            isEqual: () => false,
            dispose: rs.fn(),
            findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? edges : []),
        }),
    );
    /** The wire keeps its path edges; the face exposes the boundary edges of all its wires. */
    const wire = rs.fn((edges: any[]) =>
        Result.ok({
            isClosed: () => edges.length > 1,
            edges,
            findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? edges : []),
        }),
    );
    const face = rs.fn((wires: any[]) =>
        Result.ok({
            shapeType: ShapeTypes.face,
            isEqual: () => false,
            outerWire: () => wires[0],
            findSubShapes: (type: ShapeType) =>
                type === ShapeTypes.edge ? wires.flatMap((w: any) => w.edges) : [],
            area: () => 0,
            boundingBox: () => BoundingBox.zero,
        }),
    );
    const sweep = rs.fn((_profiles: any[], _path: any, _isRound: boolean) => Result.ok(sweptShape));
    const restore = mockShapeFactory({ line, combine, wire, face, sweep });
    return { line, combine, wire, face, sweep, sweptShape, restore };
}

describe("sweep feature", () => {
    let doc: TestDocument;
    let sketch: SketchNode;
    let mocks: ReturnType<typeof setupMocks>;

    beforeEach(() => {
        doc = new TestDocument({ application: createMockApplication() });
        mocks = setupMocks();
        sketch = new SketchNode({ document: doc, plane: Plane.XY, data: SQUARE });
        doc.modelManager.addNode(sketch);
    });

    afterEach(() => mocks.restore());

    /** The path source: a node whose stubbed shape exposes two connected line edges. */
    function pathHost() {
        const host = new SketchNode({ document: doc, plane: Plane.XY, data: SQUARE });
        doc.modelManager.addNode(host);
        const pathEdges = [
            edge(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 10, y: 0, z: 0 })),
            edge(new XYZ({ x: 10, y: 0, z: 0 }), new XYZ({ x: 10, y: 10, z: 0 })),
        ];
        const shape = {
            shapeType: ShapeTypes.compound,
            isEqual: () => false,
            dispose: rs.fn(),
            findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? pathEdges : []),
            mesh: { edges: { range: pathEdges.map((e) => ({ shape: e })) } },
        };
        Object.defineProperty(host, "shape", { value: Result.ok(shape), configurable: true });
        return { host, pathEdges };
    }

    function bodyWith(features: SweepFeatureData[]) {
        const body = new ParametricBodyNode({ document: doc, features });
        doc.modelManager.addNode(body);
        return body;
    }

    /** The path refs, captured exactly as the command does. */
    function pathRefs(pathEdges: any[]): EdgeRef[] {
        return pathEdges.map((e) => captureEdgeRef(e));
    }

    function sweepFeature(nodeId: string, edges: EdgeRef[], overrides?: Partial<SweepFeatureData>) {
        const feature: SweepFeatureData = {
            id: "f1",
            type: "sweep",
            sketchId: "s1",
            path: { nodeId, edges },
            ...overrides,
        };
        return feature;
    }

    test("is registered with its ribbon identity and reselect", () => {
        const handler = featureHandler("sweep");
        expect(handler).toBeDefined();
        expect(handler!.display).toBe("command.feature.sweep");
        expect(handler!.icon).toBe("icon-sweep");
        expect(handler!.reselectable).toBe(true);
    });

    test("sweeps the sketch profiles along the re-matched path wire", () => {
        const { host, pathEdges } = pathHost();
        const body = bodyWith([sweepFeature(host.id, pathRefs(pathEdges), { sketchId: sketch.id })]);

        expect(body.shape.isOk).toBe(true);
        expect(body.shape.unchecked()).toBe(mocks.sweptShape);
        expect(mocks.sweep).toHaveBeenCalledTimes(1);
        const [profiles, path, isRound] = mocks.sweep.mock.calls[0] as unknown as [any[], any, boolean];
        expect(profiles).toHaveLength(1);
        expect(profiles[0].shapeType).toBe(ShapeTypes.face);
        expect(isRound).toBe(false);
        // The wire wraps the two re-matched path edges, in ref order (the sketch's
        // own profile resolution calls `wire` too, so filter by identity).
        const wireInputs = mocks.wire.mock.calls.map((call) => call[0] as unknown as any[]);
        expect(wireInputs.some((input) => input[0] === pathEdges[0] && input[1] === pathEdges[1])).toBe(true);
        expect(path.findSubShapes(ShapeTypes.edge)).toEqual(pathEdges);
    });

    test("passes isRoundCorner through to the kernel", () => {
        const { host, pathEdges } = pathHost();
        const body = bodyWith([
            sweepFeature(host.id, pathRefs(pathEdges), { sketchId: sketch.id, isRoundCorner: true }),
        ]);

        expect(body.shape.isOk).toBe(true);
        expect(mocks.sweep).toHaveBeenCalledTimes(1);
        expect(mocks.sweep.mock.calls[0][2]).toBe(true);
    });

    test("re-anchors the stored path refs to what the evaluation matched", () => {
        const { host, pathEdges } = pathHost();
        const feature = sweepFeature(host.id, pathRefs(pathEdges), { sketchId: sketch.id });
        const body = bodyWith([feature]);

        expect(body.shape.isOk).toBe(true);
        const stored = (body.features[0] as SweepFeatureData).path.edges;
        expect(stored).toEqual(feature.path.edges);
    });

    test("a missing sketch surfaces as a feature error", () => {
        const { host, pathEdges } = pathHost();
        const body = bodyWith([sweepFeature(host.id, pathRefs(pathEdges), { sketchId: "deleted" })]);

        expect(body.shape.isOk).toBe(false);
        expect(body.featureItems()[0].error).toBe("Sketch not found");
        expect(mocks.sweep).not.toHaveBeenCalled();
    });

    test("a missing path node surfaces as a feature error", () => {
        const body = bodyWith([
            sweepFeature(
                "deleted",
                [{ kind: "line", start: { x: 0, y: 0, z: 0 }, end: { x: 1, y: 0, z: 0 } }],
                {
                    sketchId: sketch.id,
                },
            ),
        ]);

        expect(body.shape.isOk).toBe(false);
        expect(body.featureItems()[0].error).toBe("Sweep path body not found");
        expect(mocks.sweep).not.toHaveBeenCalled();
    });

    test("a path edge that no longer matches surfaces as a feature error", () => {
        const { host } = pathHost();
        // A circle ref can never match the host's line edges (score Infinity).
        const circle: EdgeRef = {
            kind: "circle",
            center: { x: 0, y: 0, z: 0 },
            radius: 1,
            axis: { x: 0, y: 0, z: 1 },
        };
        const body = bodyWith([sweepFeature(host.id, [circle], { sketchId: sketch.id })]);

        expect(body.shape.isOk).toBe(false);
        expect(body.featureItems()[0].error).toBe("Edge not found after rebuild");
        expect(mocks.sweep).not.toHaveBeenCalled();
    });

    describe("source faces", () => {
        /** A planar face mock with the surface captureProfileRef/profileScore read. */
        function solidFace() {
            const profileEdge = edge(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 10, y: 0, z: 0 }));
            return {
                shapeType: ShapeTypes.face,
                isEqual: () => false,
                findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? [profileEdge] : []),
                outerWire: () => ({
                    findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? [profileEdge] : []),
                }),
                normal: () => [XYZ.zero, XYZ.unitZ],
                area: () => 100,
                boundingBox: () => new BoundingBox({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 0 }),
            };
        }

        /** The source body: an editable node whose solid exposes the one face. */
        function sourceBody(face: any) {
            const shape = {
                shapeType: ShapeTypes.solid,
                isEqual: () => false,
                dispose: rs.fn(),
                findSubShapes: (type: ShapeType) => (type === ShapeTypes.face ? [face] : []),
            };
            const node = new EditableShapeNode({ document: doc, name: "Source", shape: shape as any });
            doc.modelManager.addNode(node);
            return node;
        }

        test("sweeps a solid face of another body along the path", () => {
            const { host, pathEdges } = pathHost();
            const face = solidFace();
            const source = sourceBody(face);
            const feature: SweepFeatureData = {
                id: "f1",
                type: "sweep",
                source: {
                    nodeId: source.id,
                    profiles: [captureProfileRef(face as any, undefined, undefined, true)],
                },
                path: { nodeId: host.id, edges: pathRefs(pathEdges) },
            };
            const body = bodyWith([feature]);

            expect(body.shape.isOk).toBe(true);
            expect(body.shape.unchecked()).toBe(mocks.sweptShape);
            expect(mocks.sweep).toHaveBeenCalledTimes(1);
            const [profiles] = mocks.sweep.mock.calls[0] as unknown as [any[]];
            expect(profiles).toEqual([face]);
            // The refs re-anchor onto the source in place: the feature keeps its
            // `source` shape and gains no sketchId.
            const stored = body.features[0] as SweepFeatureData;
            expect(stored.sketchId).toBeUndefined();
            expect(stored.source?.nodeId).toBe(source.id);
            expect(stored.source?.profiles).toHaveLength(1);
        });

        test("a missing source body surfaces as a feature error", () => {
            const { host, pathEdges } = pathHost();
            const face = solidFace();
            const feature: SweepFeatureData = {
                id: "f1",
                type: "sweep",
                source: {
                    nodeId: "deleted",
                    profiles: [captureProfileRef(face as any, undefined, undefined, true)],
                },
                path: { nodeId: host.id, edges: pathRefs(pathEdges) },
            };
            const body = bodyWith([feature]);

            expect(body.shape.isOk).toBe(false);
            expect(body.featureItems()[0].error).toBe("Extrude source body not found");
            expect(mocks.sweep).not.toHaveBeenCalled();
        });
    });

    describe("handler plumbing", () => {
        const edges: EdgeRef[] = [
            { kind: "line", start: { x: 0, y: 0, z: 0 }, end: { x: 1, y: 0, z: 0 } },
            { kind: "line", start: { x: 1, y: 0, z: 0 }, end: { x: 1, y: 1, z: 0 } },
        ];
        const feature = sweepFeature("b1", edges);

        test("nodeIds watches the sketch and the path node, deduped", () => {
            expect(featureHandler("sweep")!.nodeIds(feature)).toEqual(["s1", "b1"]);
            const self = sweepFeature("s1", edges);
            expect(featureHandler("sweep")!.nodeIds(self)).toEqual(["s1"]);
        });

        test("references list the sketch and the path", () => {
            expect(featureHandler("sweep")!.references!(feature)).toEqual([
                { key: "sketchId", display: "body.sketch", nodeId: "s1" },
                { key: "path", display: "feature.sweep.path", nodeId: "b1" },
            ]);
        });

        test("parameters expose isRoundCorner, defaulting to false", () => {
            expect(featureHandler("sweep")!.parameters!(feature)).toEqual([
                { key: "isRoundCorner", display: "option.command.isRoundCorner", value: false },
            ]);
            const round = sweepFeature("b1", edges, { isRoundCorner: true });
            expect(featureHandler("sweep")!.parameters!(round)).toEqual([
                { key: "isRoundCorner", display: "option.command.isRoundCorner", value: true },
            ]);
        });

        test("setParameter normalizes the boolean", () => {
            const handler = featureHandler("sweep")!;
            expect(
                (handler.setParameter(feature, "isRoundCorner", "true") as SweepFeatureData).isRoundCorner,
            ).toBe(true);
            expect(
                (handler.setParameter(feature, "isRoundCorner", false) as SweepFeatureData).isRoundCorner,
            ).toBe(false);
        });

        test("applyResolvedRefs consumes profiles and edges", () => {
            const profiles = [{ edges: [] }] as ProfileRef[];
            const anchored: EdgeRef[] = [
                { kind: "line", start: { x: 2, y: 0, z: 0 }, end: { x: 3, y: 0, z: 0 } },
            ];
            const next = featureHandler("sweep")!.applyResolvedRefs!(feature, {
                resolvedProfiles: profiles,
                resolvedEdges: anchored,
            }) as SweepFeatureData;

            expect(next.profiles).toBe(profiles);
            expect(next.path).toEqual({ nodeId: "b1", edges: anchored });
        });

        test("applyResolvedRefs with nothing resolved returns the feature unchanged", () => {
            expect(featureHandler("sweep")!.applyResolvedRefs!(feature, {})).toBe(feature);
        });

        test("a source sweep watches the source and the path, and references only the path", () => {
            const sourced: SweepFeatureData = {
                id: "f1",
                type: "sweep",
                source: { nodeId: "b2", profiles: [] },
                path: { nodeId: "b1", edges },
            };
            expect(featureHandler("sweep")!.nodeIds(sourced)).toEqual(["b2", "b1"]);
            expect(featureHandler("sweep")!.nodeIds({ ...sourced, path: { nodeId: "b2", edges } })).toEqual([
                "b2",
            ]);
            expect(featureHandler("sweep")!.references!(sourced)).toEqual([
                { key: "path", display: "feature.sweep.path", nodeId: "b1" },
            ]);
        });

        test("applyResolvedRefs re-anchors the source profiles in place", () => {
            const sourced: SweepFeatureData = {
                id: "f1",
                type: "sweep",
                source: { nodeId: "b2", profiles: [] },
                path: { nodeId: "b1", edges },
            };
            const profiles = [{ edges: [] }] as ProfileRef[];
            const next = featureHandler("sweep")!.applyResolvedRefs!(sourced, {
                resolvedProfiles: profiles,
            }) as SweepFeatureData;

            expect(next.source).toEqual({ nodeId: "b2", profiles });
            expect(next.profiles).toBeUndefined();
        });
    });

    describe("operation", () => {
        let restoreFactory: (() => void) | undefined;

        afterEach(() => {
            restoreFactory?.();
            restoreFactory = undefined;
        });

        function solidShape() {
            return {
                shapeType: ShapeTypes.solid,
                isEqual: () => false,
                dispose: rs.fn(),
                findSubShapes: () => [],
                boundingBox: () => BoundingBox.zero,
            };
        }

        /** Re-mocks the factory: the sketch mocks from setupMocks plus the operation's own. */
        function mockOperationFactory(extra: Record<string, (...args: any[]) => any>) {
            mocks.restore();
            restoreFactory = mockShapeFactory({
                line: mocks.line,
                combine: mocks.combine,
                wire: mocks.wire,
                face: mocks.face,
                ...extra,
            });
        }

        test.each([
            { operation: "fuse" as const, mock: "booleanFuse" as const },
            { operation: "cut" as const, mock: "booleanCut" as const },
            { operation: "common" as const, mock: "booleanCommon" as const },
        ])("$operation combines the swept tool with the preceding feature", ({ operation, mock }) => {
            const { host, pathEdges } = pathHost();
            const firstShape = solidShape();
            const toolShape = solidShape();
            const resultShape = solidShape();
            const shapes = [firstShape, toolShape];
            let call = 0;
            const sweep = rs.fn(() => Result.ok(shapes[call++]));
            const boolean = rs.fn(() => Result.ok(resultShape));
            // No sweepTracked/booleanXxxTracked: the operation takes the plain fallback.
            mockOperationFactory({ sweep, [mock]: boolean });

            const body = bodyWith([
                sweepFeature(host.id, pathRefs(pathEdges), { sketchId: sketch.id }),
                sweepFeature(host.id, pathRefs(pathEdges), { id: "f2", sketchId: sketch.id, operation }),
            ]);

            expect(body.shape.isOk).toBe(true);
            expect(body.shape.unchecked()).toBe(resultShape);
            const [args, tools] = boolean.mock.calls[0] as unknown as [any[], any[]];
            expect(args[0]).toBe(firstShape);
            expect(tools[0]).toBe(toolShape);
            // The swept tool is an intermediate input — disposed once the boolean read it.
            expect(toolShape.dispose).toHaveBeenCalled();
            expect(firstShape.dispose).not.toHaveBeenCalled();
        });

        test("join/cut/intersect as the first feature fails with a feature error", () => {
            const { host, pathEdges } = pathHost();
            const sweep = rs.fn(() => Result.ok(solidShape()));
            const booleanFuse = rs.fn();
            mockOperationFactory({ sweep, booleanFuse });

            const body = bodyWith([
                sweepFeature(host.id, pathRefs(pathEdges), { sketchId: sketch.id, operation: "fuse" }),
            ]);

            expect(body.shape.isOk).toBe(false);
            expect(body.featureItems()[0].error).toBe(
                "Sweep join/cut/intersect requires a preceding feature",
            );
            expect(sweep).not.toHaveBeenCalled();
            expect(booleanFuse).not.toHaveBeenCalled();
        });

        test("a join sweep takes the tracked boolean when the kernel supports it", () => {
            const { host, pathEdges } = pathHost();
            const firstShape = solidShape();
            const toolShape = solidShape();
            const fusedShape = solidShape();
            const shapes = [firstShape, toolShape];
            let call = 0;
            // Empty histories: every map completes to nothing, so no mock geometry is read.
            const sweepTracked = rs.fn(() =>
                Result.ok({ shape: shapes[call++], faceAncestors: [], edgeAncestors: [] }),
            );
            const booleanFuseTracked = rs.fn((_args: any[], _tools: any[]) =>
                Result.ok({ shape: fusedShape, faceAncestors: [], edgeAncestors: [] }),
            );
            const sweep = rs.fn();
            const booleanFuse = rs.fn();
            mockOperationFactory({ sweepTracked, booleanFuseTracked, sweep, booleanFuse });

            const body = bodyWith([
                sweepFeature(host.id, pathRefs(pathEdges), { sketchId: sketch.id }),
                sweepFeature(host.id, pathRefs(pathEdges), {
                    id: "f2",
                    sketchId: sketch.id,
                    operation: "fuse",
                }),
            ]);

            expect(body.shape.isOk).toBe(true);
            expect(body.shape.unchecked()).toBe(fusedShape);
            // Both features swept through the tracked kernel call; the join used the
            // tracked boolean — the plain fallbacks stay untouched.
            expect(sweepTracked).toHaveBeenCalledTimes(2);
            expect(booleanFuseTracked).toHaveBeenCalledTimes(1);
            const [args, tools] = booleanFuseTracked.mock.calls[0] as unknown as [any[], any[]];
            expect(args[0]).toBe(firstShape);
            expect(tools[0]).toBe(toolShape);
            expect(toolShape.dispose).toHaveBeenCalled();
            expect(sweep).not.toHaveBeenCalled();
            expect(booleanFuse).not.toHaveBeenCalled();
        });
    });

    describe("reselect", () => {
        function mockSelection() {
            const selection = {
                clearSelection: rs.fn(),
                setSelectedShapes: rs.fn(),
                setSelectedNodes: rs.fn(),
                onShapeChanged: new Signal<(selected: any[]) => void>(),
            };
            doc.selection = selection as any;
            return selection;
        }

        /** A pickable face mock — the surface `captureProfileRef` reads. */
        function pickedFace() {
            const profileEdge = edge(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 1, y: 0, z: 0 }));
            return {
                shapeType: ShapeTypes.face,
                findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? [profileEdge] : []),
                outerWire: () => ({
                    findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? [profileEdge] : []),
                }),
                area: () => 0,
                boundingBox: () => BoundingBox.zero,
            };
        }

        test("reselectShapes replaces the profiles and the path edges in one step", async () => {
            const { host, pathEdges } = pathHost();
            const body = bodyWith([sweepFeature(host.id, pathRefs(pathEdges), { sketchId: sketch.id })]);
            expect(body.shape.isOk).toBe(true);
            doc.application.activeView = { document: doc } as any;
            mockSelection();
            const prompts: unknown[] = [];
            doc.picker.pickShape = rs.fn((prompt: unknown) => {
                prompts.push(prompt);
                // First the sketch profiles, then the path edges.
                return Promise.resolve(
                    prompts.length === 1
                        ? [{ shape: pickedFace(), indexes: [0] } as any]
                        : [{ shape: pathEdges[1], indexes: [1] } as any],
                );
            }) as any;
            const undoCount = doc.history.undoCount();

            await body.reselectShapes("f1");

            expect(prompts).toEqual(["prompt.select.faces", "prompt.select.path"]);
            expect(body.features[0]).toMatchObject({
                profiles: [
                    { edges: [{ kind: "line", start: { x: 0, y: 0, z: 0 }, end: { x: 1, y: 0, z: 0 } }] },
                ],
                path: {
                    nodeId: host.id,
                    edges: [{ kind: "line", start: { x: 10, y: 0, z: 0 }, end: { x: 10, y: 10, z: 0 } }],
                },
            });
            // Both picks commit in a single undo step.
            expect(doc.history.undoCount()).toBe(undoCount + 1);
        });

        test("cancelling the path pick discards the confirmed profiles too", async () => {
            const { host, pathEdges } = pathHost();
            const originalRefs = pathRefs(pathEdges);
            const body = bodyWith([sweepFeature(host.id, originalRefs, { sketchId: sketch.id })]);
            expect(body.shape.isOk).toBe(true);
            doc.application.activeView = { document: doc } as any;
            mockSelection();
            let picks = 0;
            doc.picker.pickShape = rs.fn((_prompt: unknown, controller: any) => {
                picks++;
                if (picks === 2) controller.cancel();
                return Promise.resolve(picks === 1 ? [{ shape: pickedFace(), indexes: [0] } as any] : []);
            }) as any;
            const undoCount = doc.history.undoCount();

            await body.reselectShapes("f1");

            const feature = body.features[0] as SweepFeatureData;
            expect(feature.profiles).toBeUndefined();
            expect(feature.path.edges).toEqual(originalRefs);
            expect(doc.history.undoCount()).toBe(undoCount);
        });

        test("preselects the current path edges and toasts on an empty path pick", async () => {
            const { host, pathEdges } = pathHost();
            const body = bodyWith([sweepFeature(host.id, pathRefs(pathEdges), { sketchId: sketch.id })]);
            expect(body.shape.isOk).toBe(true);
            doc.application.activeView = { document: doc } as any;
            const selection = mockSelection();
            const owner = { worldTransform: () => Matrix4.identity() };
            doc.visual.context.getVisual = () => owner as any;
            doc.picker.pickShape = rs.fn(() => Promise.resolve([])) as any;
            const onToast = rs.fn((_message: I18nKeys) => {});
            PubSub.default.sub("showToast", onToast);
            const undoCount = doc.history.undoCount();
            try {
                await body.reselectShapes("f1");
            } finally {
                PubSub.default.remove("showToast", onToast);
            }

            // The profile pick ran first (empty confirmation = all profiles, no preselect
            // for a feature without stored profiles); the path pick preselected both
            // current path edges.
            expect(selection.setSelectedShapes).toHaveBeenCalledTimes(1);
            const [picked, state, _select] = selection.setSelectedShapes.mock.calls[0] as unknown as [
                any[],
                number,
                boolean,
            ];
            expect(picked.map((x) => x.indexes)).toEqual([[0], [1]]);
            expect(picked.every((x) => x.owner === owner)).toBe(true);
            expect(state).toBe(VisualStates.edgeSelected);
            // An empty path is no path at all: the pick cancels with a toast and
            // nothing is committed.
            expect(onToast).toHaveBeenCalledWith("toast.select.noSelected");
            expect((body.features[0] as SweepFeatureData).profiles).toBeUndefined();
            expect(doc.history.undoCount()).toBe(undoCount);
        });
    });
});
