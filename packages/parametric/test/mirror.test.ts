// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { BoundingBox, Matrix4, Plane, Result, type ShapeType, ShapeTypes, XYZ } from "@chili3d/core";
import { createMockApplication, nearestOnSegment, TestDocument } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { type SketchData, SketchNode } from "../src/sketch";
import "../src/features"; // registers all feature handlers
import { featureHandler, type MirrorFeatureData } from "../src/features/feature";
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
        findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? [self] : []),
    };
    return self;
}

/** A planar face at height `z` with outward normal +Z — what a plane ref captures and re-matches. */
function planarFace(z: number) {
    return {
        shapeType: ShapeTypes.face,
        isEqual: () => false,
        dispose: rs.fn(),
        surface: () => ({ isPlanar: () => true }),
        normal: () => [new XYZ({ x: 0, y: 0, z }), XYZ.unitZ] as [XYZ, XYZ],
        findSubShapes: () => [],
        area: () => 0,
        boundingBox: () => BoundingBox.zero,
    };
}

function setupMocks() {
    /** Mirror copies are made with `transformedMul`; the copy remembers the matrix. */
    const withTransform = <T extends object>(shape: T): T & { transformedMul: (m: Matrix4) => any } =>
        Object.assign(shape, {
            transformedMul: rs.fn((matrix: Matrix4) =>
                withTransform({
                    shapeType: (shape as any).shapeType,
                    isEqual: () => false,
                    dispose: rs.fn(),
                    findSubShapes: (shape as any).findSubShapes ?? (() => []),
                    transformedBy: matrix,
                } as any),
            ),
        });
    const prismShape = withTransform({
        shapeType: ShapeTypes.solid,
        isEqual: () => false,
        dispose: rs.fn(),
        findSubShapes: () => [],
    });
    const fusedShape = { shapeType: ShapeTypes.solid, isEqual: () => false, dispose: rs.fn() };
    const line = rs.fn((start: XYZ, end: XYZ) => Result.ok(edge(start, end)));
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
    const prism = rs.fn((_profileFace: any, _vec: XYZ) => Result.ok(prismShape));
    const booleanFuse = rs.fn((_s1: any[], _s2: any[], _simplify: boolean) => Result.ok(fusedShape));
    // SketchNode.generateShape also combines (its entity edges), so each call gets its own
    // compound and the mirror assertions look up the one whose inputs are the body halves.
    const compounds: any[] = [];
    const combine = rs.fn((shapes: any[]) => {
        const compound = withTransform({
            shapeType: ShapeTypes.compound,
            isEqual: () => false,
            dispose: rs.fn(),
            findSubShapes: (type: ShapeType) => shapes.filter((s) => s.shapeType === type),
            combinedShapes: shapes,
        });
        compounds.push(compound);
        return Result.ok(compound);
    });
    const restore = mockShapeFactory({ line, wire, face, prism, booleanFuse, combine });
    return { line, wire, face, prism, booleanFuse, combine, compounds, prismShape, fusedShape, restore };
}

const DATUM_YZ = { kind: "datum", name: "YZ" } as const;

describe("mirror feature", () => {
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

    function bodyWith(features: MirrorFeatureData[] | any[], id?: string) {
        const body = new ParametricBodyNode({ document: doc, id, features: features as any });
        doc.modelManager.addNode(body);
        return body;
    }

    function mirroredBody(
        plane: MirrorFeatureData["plane"] = DATUM_YZ,
        patch: Partial<MirrorFeatureData> = {},
    ) {
        return bodyWith([
            { id: "e1", type: "extrude", sketchId: sketch.id, depth: 5 },
            { id: "m1", type: "mirror", plane, ...patch },
        ]);
    }

    test("is registered with its ribbon identity", () => {
        const handler = featureHandler("mirror");
        expect(handler).toBeDefined();
        expect(handler!.display).toBe("command.feature.mirror");
        expect(handler!.icon).toBe("icon-mirror");
        expect(handler!.reselectable).toBe(true);
    });

    test("mirrors the input about the datum plane and fuses the copy by default", () => {
        const body = mirroredBody();

        expect(body.shape.isOk).toBe(true);
        expect(body.shape.unchecked()).toBe(mocks.fusedShape);
        expect(mocks.booleanFuse).toHaveBeenCalledTimes(1);
        const [bases, tools, simplify] = mocks.booleanFuse.mock.calls[0] as unknown as [
            any[],
            any[],
            boolean,
        ];
        expect(bases).toEqual([mocks.prismShape]);
        expect(tools).toHaveLength(1);
        // The copy is the input mirrored about the YZ datum: x flips, y and z keep.
        const matrix = tools[0].transformedBy as Matrix4;
        const mirrored = matrix.ofPoint(new XYZ({ x: 5, y: 3, z: 2 }));
        expect([mirrored.x, mirrored.y, mirrored.z]).toEqual([-5, 3, 2]);
        expect(simplify).toBe(true);
        // The mirrored copy is an intermediate of the fuse — disposed once it returns.
        expect(tools[0].dispose).toHaveBeenCalledTimes(1);
        // The sketch's own entity combine happens, but the halves never go through one.
        expect(mocks.compounds.some((c) => c.combinedShapes.includes(mocks.prismShape))).toBe(false);
    });

    test("merge: false keeps the halves side by side in a compound", () => {
        const body = mirroredBody(DATUM_YZ, { merge: false });

        expect(body.shape.isOk).toBe(true);
        expect(mocks.booleanFuse).not.toHaveBeenCalled();
        const compound = mocks.compounds.find((c) => c.combinedShapes.includes(mocks.prismShape));
        expect(compound).toBeDefined();
        expect(body.shape.unchecked()).toBe(compound);
        const shapes = compound.combinedShapes as any[];
        expect(shapes[0]).toBe(mocks.prismShape);
        expect(shapes[1].transformedBy).toBeInstanceOf(Matrix4);
        // The compound owns its halves — the copy is not disposed (the sweep fallback's contract).
        expect(shapes[1].dispose).not.toHaveBeenCalled();
    });

    test("a moved body mirrors about the plane mapped into its own frame", () => {
        const body = mirroredBody();
        body.transform = Matrix4.fromTranslation(10, 0, 0);

        expect(body.shape.isOk).toBe(true);
        const [, tools] = mocks.booleanFuse.mock.calls.at(-1) as unknown as [any[], any[]];
        // The YZ datum is x = 0 in the world; in the body's frame it is x = −10, so the local
        // origin mirrors to (−20, 0, 0).
        const mirrored = (tools[0].transformedBy as Matrix4).ofPoint(XYZ.zero);
        expect([mirrored.x, mirrored.y, mirrored.z]).toEqual([-20, 0, 0]);
    });

    test("a plane picked on another body's face mirrors about that face's plane", () => {
        const sourceBody = bodyWith([{ id: "e0", type: "extrude", sketchId: sketch.id, depth: 2 }]);
        const face = planarFace(2);
        sourceBody.shape.unchecked()!.findSubShapes = ((type: ShapeType) =>
            type === ShapeTypes.face ? [face] : []) as any;
        const plane: MirrorFeatureData["plane"] = {
            kind: "face",
            ref: { nodeId: sourceBody.id, normal: { x: 0, y: 0, z: 1 }, offset: 2 },
        };
        const body = mirroredBody(plane);

        expect(body.shape.isOk).toBe(true);
        const [, tools] = mocks.booleanFuse.mock.calls.at(-1) as unknown as [any[], any[]];
        // The face lies at z = 2, so z mirrors to 4 − z.
        const mirrored = (tools[0].transformedBy as Matrix4).ofPoint(new XYZ({ x: 1, y: 1, z: 0 }));
        expect([mirrored.x, mirrored.y, mirrored.z]).toEqual([1, 1, 4]);
        // The reference is watched and shown on the feature row.
        expect(featureHandler("mirror")!.nodeIds(body.features[1] as MirrorFeatureData)).toEqual([
            sourceBody.id,
        ]);
        const item = body.featureItems()[1];
        expect(item.references?.map((x) => x.key)).toEqual(["plane"]);
    });

    test("fails without a preceding feature", () => {
        const body = bodyWith([{ id: "m1", type: "mirror", plane: DATUM_YZ }]);

        expect(body.shape.isOk).toBe(false);
        expect(body.featureItems()[0].error).toBe("Mirror requires a preceding feature");
        expect(mocks.booleanFuse).not.toHaveBeenCalled();
    });

    test("fails when the plane's body is gone", () => {
        const plane: MirrorFeatureData["plane"] = {
            kind: "face",
            ref: { nodeId: "deleted", normal: { x: 0, y: 0, z: 1 }, offset: 0 },
        };
        const body = mirroredBody(plane);

        expect(body.shape.isOk).toBe(false);
        expect(body.featureItems()[1].error).toBe("Mirror plane body not found");
        expect(mocks.booleanFuse).not.toHaveBeenCalled();
    });

    test("fails when the plane's body shows a session rollback preview", () => {
        const sourceBody = bodyWith([{ id: "e0", type: "extrude", sketchId: sketch.id, depth: 2 }]);
        Object.defineProperty(sourceBody, "rollbackIndex", { value: 0 });
        const plane: MirrorFeatureData["plane"] = {
            kind: "face",
            ref: { nodeId: sourceBody.id, normal: { x: 0, y: 0, z: 1 }, offset: 2 },
        };
        const body = mirroredBody(plane);

        expect(body.shape.isOk).toBe(false);
        expect(body.featureItems()[1].error).toBe("Mirror plane body is rolled back");
        expect(mocks.booleanFuse).not.toHaveBeenCalled();
    });

    test("fails when the plane face no longer re-matches", () => {
        const sourceBody = bodyWith([{ id: "e0", type: "extrude", sketchId: sketch.id, depth: 2 }]);
        // The source exposes no faces at all, so the fingerprint has nothing to land on.
        const plane: MirrorFeatureData["plane"] = {
            kind: "face",
            ref: { nodeId: sourceBody.id, normal: { x: 0, y: 0, z: 1 }, offset: 2 },
        };
        const body = mirroredBody(plane);

        expect(body.shape.isOk).toBe(false);
        expect(body.featureItems()[1].error).toBe("Mirror plane not found after rebuild");
    });

    test("the merge checkbox parameter defaults to true and writes back", () => {
        const handler = featureHandler("mirror")!;
        const feature: MirrorFeatureData = { id: "m1", type: "mirror", plane: DATUM_YZ };

        expect(handler.parameters(feature)).toEqual([
            { key: "merge", display: "option.command.merge", value: true },
        ]);
        expect(handler.setParameter(feature, "merge", false)).toMatchObject({ merge: false });
        expect(handler.setParameter({ ...feature, merge: false }, "merge", "true")).toMatchObject({
            merge: true,
        });
    });

    test("nodeIds and references follow only a face plane, never a datum", () => {
        const handler = featureHandler("mirror")!;
        const datum: MirrorFeatureData = { id: "m1", type: "mirror", plane: DATUM_YZ };
        const face: MirrorFeatureData = {
            id: "m1",
            type: "mirror",
            plane: { kind: "face", ref: { nodeId: "n1", normal: { x: 0, y: 0, z: 1 }, offset: 0 } },
        };

        expect(handler.nodeIds(datum)).toEqual([]);
        expect(handler.references?.(datum)).toEqual([]);
        expect(handler.nodeIds(face)).toEqual(["n1"]);
        expect(handler.references?.(face)).toEqual([
            { key: "plane", display: "feature.mirror.plane", nodeId: "n1" },
        ]);
    });
});
