// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    BoundingBox,
    Line,
    Matrix4,
    Plane,
    Result,
    type ShapeType,
    ShapeTypes,
    Transaction,
    XYZ,
} from "@chili3d/core";
import { createMockApplication, TestDocument } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { type SketchData, SketchNode } from "../src/sketch";
import "../src/features"; // registers all feature handlers
import type { EdgeRef } from "../src/features/edgeRef";
import type {
    BooleanFeatureData,
    BooleanOperation,
    ChamferFeatureData,
    ExtrudeFeatureData,
    FeatureData,
    FilletFeatureData,
    RevolveFeatureData,
    VariableFeatureData,
} from "../src/features/feature";
import { featureHandler } from "../src/features/feature";
import { allProfiles, sketchProfiles } from "../src/features/profileBuilder";
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

const AXIS = { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 1, z: 0 } };
const EDGE_REF: EdgeRef = { kind: "line", start: { x: 0, y: 0, z: 0 }, end: { x: 1, y: 0, z: 0 } };

/** A sub-edge of the rebuilt solid matching EDGE_REF. */
function subEdge() {
    return {
        shapeType: ShapeTypes.edge,
        curve: { basisCurve: { direction: { x: 1, y: 0, z: 0 } } },
        startPoint: () => ({ x: 0, y: 0, z: 0 }) as XYZ,
        endPoint: () => ({ x: 1, y: 0, z: 0 }) as XYZ,
        isEqual: () => false,
    };
}

function edge(start: XYZ, end: XYZ) {
    return {
        shapeType: ShapeTypes.edge,
        curve: { basisCurve: { direction: { x: end.x - start.x, y: end.y - start.y, z: end.z - start.z } } },
        startPoint: () => start,
        endPoint: () => end,
        firstParameter: () => 0,
        lastParameter: () => 1,
        pointAt: (t: number) => start.add(end.sub(start).multiply(t)),
        isEqual: () => false,
    };
}

function setupMocks() {
    /** Boolean tools are mapped into the host's local space via `transformedMul`. */
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
    const prismShapes: any[] = [];
    const revolvedShape = { shapeType: ShapeTypes.solid, isEqual: () => false, dispose: rs.fn() };
    const filletedShape = { shapeType: ShapeTypes.solid, isEqual: () => false, dispose: rs.fn() };
    const fusedShape = { shapeType: ShapeTypes.solid, isEqual: () => false, dispose: rs.fn() };
    const line = rs.fn((start: XYZ, end: XYZ) => Result.ok(edge(start, end)));
    /** Full-circle edge: closed, so start and end coincide on the circumference. */
    const circle = rs.fn((normal: XYZ, center: XYZ, radius: number) =>
        Result.ok({
            shapeType: ShapeTypes.edge,
            curve: { basisCurve: { center, radius, axis: normal } },
            startPoint: () => center.add(new XYZ({ x: radius, y: 0, z: 0 })),
            endPoint: () => center.add(new XYZ({ x: radius, y: 0, z: 0 })),
            firstParameter: () => 0,
            lastParameter: () => Math.PI * 2,
            pointAt: (t: number) =>
                new XYZ({
                    x: center.x + radius * Math.cos(t),
                    y: center.y + radius * Math.sin(t),
                    z: center.z,
                }),
            isEqual: () => false,
        }),
    );
    const combine = rs.fn((edges: any[]) =>
        Result.ok(
            withTransform({
                shapeType: ShapeTypes.compound,
                isEqual: () => false,
                dispose: rs.fn(),
                findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? edges : []),
            }),
        ),
    );
    /** The wire keeps its loop edges; the face exposes the boundary edges of all its wires. */
    const wire = rs.fn((edges: any[]) => Result.ok({ isClosed: () => edges.length > 1, edges }));
    const face = rs.fn((wires: any[]) =>
        Result.ok({
            shapeType: ShapeTypes.face,
            isEqual: () => false,
            findSubShapes: (type: ShapeType) =>
                type === ShapeTypes.edge ? wires.flatMap((w: any) => w.edges) : [],
        }),
    );
    /** Each prism gets a bounding box computed from its profile, so fusion tests are truthful. */
    const prism = rs.fn((profileFace: any, _vec: XYZ) => {
        const points = (profileFace.findSubShapes(ShapeTypes.edge) as any[]).flatMap((e) => [
            e.startPoint(),
            e.endPoint(),
        ]);
        const shape = withTransform({
            shapeType: ShapeTypes.solid,
            isEqual: () => false,
            dispose: rs.fn(),
            findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? [subEdge()] : []),
            boundingBox: () => BoundingBox.fromPoints(points),
        });
        prismShapes.push(shape);
        return Result.ok(shape);
    });
    const revolve = rs.fn((_face: any, _axis: Line, _angle: number) => Result.ok(revolvedShape));
    const fillet = rs.fn((_shape: any, _indexes: number[], _radius: number) => Result.ok(filletedShape));
    const chamfer = rs.fn((_shape: any, _indexes: number[], _distance: number) => Result.ok(filletedShape));
    const booleanFuse = rs.fn((_s1: any[], _s2: any[], _simplify: boolean) => Result.ok(fusedShape));
    const booleanCut = rs.fn((_s1: any[], _s2: any[]) => Result.ok(fusedShape));
    const booleanCommon = rs.fn((_s1: any[], _s2: any[]) => Result.ok(fusedShape));
    const restore = mockShapeFactory({
        line,
        circle,
        combine,
        wire,
        face,
        prism,
        revolve,
        fillet,
        chamfer,
        booleanFuse,
        booleanCut,
        booleanCommon,
    });
    return {
        line,
        circle,
        combine,
        wire,
        prism,
        revolve,
        fillet,
        chamfer,
        booleanFuse,
        booleanCut,
        booleanCommon,
        face,
        prismShapes,
        /** The shape of the most recent prism call. */
        get prismShape() {
            return prismShapes.at(-1);
        },
        revolvedShape,
        filletedShape,
        fusedShape,
        restore,
    };
}

describe("feature evaluation", () => {
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

    function bodyWith(features: FeatureData[]) {
        const body = new ParametricBodyNode({ document: doc, features });
        doc.modelManager.addNode(body);
        return body;
    }

    test("revolve rotates the sketch profile around the axis with the angle in degrees", () => {
        const feature: RevolveFeatureData = {
            id: "r1",
            type: "revolve",
            sketchId: sketch.id,
            axis: AXIS,
            angle: 270,
        };
        const body = bodyWith([feature]);

        expect(body.shape.isOk).toBe(true);
        expect(body.shape.unchecked()).toBe(mocks.revolvedShape);
        expect(mocks.revolve).toHaveBeenCalledTimes(1);
        const [, axis, angle] = mocks.revolve.mock.calls[0] as unknown as [any, Line, number];
        expect(axis).toBeInstanceOf(Line);
        expect([axis.point.x, axis.point.y, axis.point.z]).toEqual([0, 0, 0]);
        expect([axis.direction.x, axis.direction.y, axis.direction.z]).toEqual([0, 1, 0]);
        expect(angle).toBe(270);
    });

    test("fillet re-matches edge refs against the rebuilt input", () => {
        const extrude: ExtrudeFeatureData = { id: "e1", type: "extrude", sketchId: sketch.id, length: 5 };
        const fillet: FilletFeatureData = { id: "f1", type: "fillet", radius: 2, edges: [EDGE_REF] };
        const body = bodyWith([extrude, fillet]);

        expect(body.shape.isOk).toBe(true);
        expect(body.shape.unchecked()).toBe(mocks.filletedShape);
        expect(mocks.fillet).toHaveBeenCalledTimes(1);
        const [input, indexes, radius] = mocks.fillet.mock.calls[0] as unknown as [any, number[], number];
        expect(input).toBe(mocks.prismShape);
        expect(indexes).toEqual([0]);
        expect(radius).toBe(2);
    });

    test("chamfer passes matched indexes and distance to the factory", () => {
        const extrude: ExtrudeFeatureData = { id: "e1", type: "extrude", sketchId: sketch.id, length: 5 };
        const chamfer: ChamferFeatureData = { id: "c1", type: "chamfer", distance: 1, edges: [EDGE_REF] };
        const body = bodyWith([extrude, chamfer]);

        expect(body.shape.isOk).toBe(true);
        const [input, indexes, distance] = mocks.chamfer.mock.calls[0] as unknown as [any, number[], number];
        expect(input).toBe(mocks.prismShape);
        expect(indexes).toEqual([0]);
        expect(distance).toBe(1);
    });

    test("edge features fail without a preceding feature", () => {
        const fillet: FilletFeatureData = { id: "f1", type: "fillet", radius: 2, edges: [EDGE_REF] };
        const body = bodyWith([fillet]);

        expect(body.shape.isOk).toBe(false);
        expect(body.shape.error).toBe("fillet requires a preceding feature");
        expect(body.featureItems()[0].error).toBe("fillet requires a preceding feature");
    });

    test("an edge ref that matches nothing surfaces as a feature error", () => {
        const extrude: ExtrudeFeatureData = { id: "e1", type: "extrude", sketchId: sketch.id, length: 5 };
        // A circle ref against the prism's line-only edges has no candidate of its
        // type at all — the one case that still fails outright.
        const circle: EdgeRef = {
            kind: "circle",
            center: { x: 9, y: 9, z: 9 },
            radius: 2,
            axis: { x: 0, y: 0, z: 1 },
        };
        const fillet: FilletFeatureData = { id: "f1", type: "fillet", radius: 2, edges: [circle] };
        const body = bodyWith([extrude, fillet]);

        expect(body.shape.isOk).toBe(false);
        expect(body.shape.error).toBe("Edge not found after rebuild");
        expect(body.featureItems()[1].error).toBe("Edge not found after rebuild");
        expect(mocks.fillet).not.toHaveBeenCalled();
    });

    function toolSketch(data: SketchData = SQUARE) {
        const tool = new SketchNode({ document: doc, plane: Plane.XY, data });
        doc.modelManager.addNode(tool);
        return tool;
    }

    function booleanFeature(operation: BooleanOperation, toolIds: string[]): BooleanFeatureData {
        return { id: "b1", type: "boolean", operation, toolIds };
    }

    test.each([
        { operation: "fuse" as const, mock: "booleanFuse" as const, display: "command.feature.fuse" },
        { operation: "cut" as const, mock: "booleanCut" as const, display: "command.feature.cut" },
        { operation: "common" as const, mock: "booleanCommon" as const, display: "command.feature.common" },
    ])("$operation applies the input and tool shapes to the factory", ({ operation, mock, display }) => {
        const tool = toolSketch();
        const extrude: ExtrudeFeatureData = { id: "e1", type: "extrude", sketchId: sketch.id, length: 5 };
        const body = bodyWith([extrude, booleanFeature(operation, [tool.id])]);

        expect(body.shape.isOk).toBe(true);
        expect(body.shape.unchecked()).toBe(mocks.fusedShape);
        const [bases, tools] = mocks[mock].mock.calls[0] as unknown as [any[], any[]];
        expect(bases).toEqual([mocks.prismShape]);
        expect(tools).toEqual([tool.shape.unchecked()]);
        expect(body.featureItems()[1].display).toBe(display);
    });

    test("boolean fails without a preceding feature", () => {
        const body = bodyWith([booleanFeature("fuse", [toolSketch().id])]);

        expect(body.shape.isOk).toBe(false);
        expect(body.shape.error).toBe("boolean requires a preceding feature");
    });

    test("boolean fails when a tool node is missing", () => {
        const extrude: ExtrudeFeatureData = { id: "e1", type: "extrude", sketchId: sketch.id, length: 5 };
        const body = bodyWith([extrude, booleanFeature("cut", ["no-such-node"])]);

        expect(body.shape.isOk).toBe(false);
        expect(body.shape.error).toBe("Boolean tool not found");
        expect(body.featureItems()[1].error).toBe("Boolean tool not found");
    });

    test("a tool change re-evaluates the boolean but keeps the cached prefix", () => {
        const tool = toolSketch();
        const extrude: ExtrudeFeatureData = { id: "e1", type: "extrude", sketchId: sketch.id, length: 5 };
        const body = bodyWith([extrude, booleanFeature("fuse", [tool.id])]);
        expect(body.shape.isOk).toBe(true);
        mocks.prism.mockClear();
        mocks.booleanFuse.mockClear();

        tool.setDataEmitShapeChanged({
            entities: [
                { id: 1, type: "line", params: [0, 0, 2, 0] },
                { id: 2, type: "line", params: [2, 0, 2, 2] },
                { id: 3, type: "line", params: [2, 2, 0, 2] },
                { id: 4, type: "line", params: [0, 2, 0, 0] },
            ],
            constraints: [],
        });

        expect(mocks.prism).not.toHaveBeenCalled();
        expect(mocks.booleanFuse).toHaveBeenCalledTimes(1);
    });

    // Regression: cutting with an original node and its moved copy produced only one
    // hole — the boolean ignored tool transforms and reused the cached result.
    test("boolean maps a moved tool into the host's local space", () => {
        const toolA = toolSketch();
        const toolB = toolSketch();
        toolB.transform = Matrix4.fromTranslation(30, 0, 0);
        const extrude: ExtrudeFeatureData = { id: "e1", type: "extrude", sketchId: sketch.id, length: 5 };
        const body = bodyWith([extrude, booleanFeature("cut", [toolA.id, toolB.id])]);

        expect(body.shape.isOk).toBe(true);
        const [, tools] = mocks.booleanCut.mock.calls[0] as unknown as [any[], any[]];
        expect(tools[0]).toBe(toolA.shape.unchecked());
        expect(tools[1]).not.toBe(toolB.shape.unchecked());
        expect(tools[1].transformedBy.equals(Matrix4.fromTranslation(30, 0, 0))).toBe(true);
        // The transformed copy is intermediate — disposed once the kernel call returns.
        expect(tools[1].dispose).toHaveBeenCalledTimes(1);
    });

    test("moving a boolean tool re-evaluates the cut at the new position", () => {
        const tool = toolSketch();
        const extrude: ExtrudeFeatureData = { id: "e1", type: "extrude", sketchId: sketch.id, length: 5 };
        const body = bodyWith([extrude, booleanFeature("cut", [tool.id])]);
        expect(body.shape.isOk).toBe(true);
        mocks.prism.mockClear();
        mocks.booleanCut.mockClear();

        tool.transform = Matrix4.fromTranslation(10, 0, 0);

        expect(mocks.prism).not.toHaveBeenCalled();
        expect(mocks.booleanCut).toHaveBeenCalledTimes(1);
        const [, tools] = mocks.booleanCut.mock.calls[0] as unknown as [any[], any[]];
        expect(tools[0].transformedBy.equals(Matrix4.fromTranslation(10, 0, 0))).toBe(true);
    });

    test("a moved host maps tools relative to its own transform", () => {
        const tool = toolSketch();
        tool.transform = Matrix4.fromTranslation(15, 0, 0);
        const extrude: ExtrudeFeatureData = { id: "e1", type: "extrude", sketchId: sketch.id, length: 5 };
        const body = bodyWith([extrude, booleanFeature("cut", [tool.id])]);
        body.transform = Matrix4.fromTranslation(5, 0, 0);

        expect(body.shape.isOk).toBe(true);
        const [, tools] = mocks.booleanCut.mock.calls[0] as unknown as [any[], any[]];
        expect(tools[0].transformedBy.equals(Matrix4.fromTranslation(10, 0, 0))).toBe(true);
    });

    describe("consumeTools", () => {
        function consumeFeature(toolIds: string[], consumeTools = true): BooleanFeatureData {
            return { id: "b1", type: "boolean", operation: "fuse", toolIds, consumeTools };
        }

        function bodyWithTool(tool: SketchNode) {
            const extrude: ExtrudeFeatureData = { id: "e1", type: "extrude", sketchId: sketch.id, length: 5 };
            const body = bodyWith([extrude]);
            Transaction.execute(doc, "fuse", () =>
                body.setFeaturesEmitShapeChanged([...body.features, consumeFeature([tool.id])]),
            );
            return body;
        }

        test("moves the tool under the body, hidden from the scene", () => {
            const tool = toolSketch();
            const body = bodyWithTool(tool);

            expect(tool.parent).toBe(body);
            expect(tool.parentVisible).toBe(false);
            expect(body.shape.isOk).toBe(true);
            expect(body.featureItems()[1].parameters).toEqual([
                { key: "consumeTools", display: "features.consumeTools", value: true },
            ]);
        });

        test("undo restores the tool position together with the feature, redo re-consumes", () => {
            const tool = toolSketch();
            const body = bodyWithTool(tool);
            expect(doc.history.undoCount()).toBeGreaterThan(0);

            doc.history.undo();
            expect(tool.parent).toBe(doc.modelManager.rootNode);
            expect(body.features.map((f) => f.id)).toEqual(["e1"]);

            doc.history.redo();
            expect(tool.parent).toBe(body);
            expect(tool.parentVisible).toBe(false);
            expect(body.features.map((f) => f.id)).toEqual(["e1", "b1"]);
        });

        test("unchecking consumeTools moves the tool back next to the body", () => {
            const tool = toolSketch();
            const body = bodyWithTool(tool);

            Transaction.execute(doc, "edit feature", () =>
                body.setFeatureParameter("b1", "consumeTools", false),
            );

            expect(tool.parent).toBe(doc.modelManager.rootNode);
            expect(tool.parentVisible).toBe(true);
            expect(tool.previousSibling).toBe(body);

            Transaction.execute(doc, "edit feature", () =>
                body.setFeatureParameter("b1", "consumeTools", true),
            );
            expect(tool.parent).toBe(body);
        });

        test("releasing multiple tools keeps their original order after the body", () => {
            const tool1 = toolSketch();
            const tool2 = toolSketch();
            const extrude: ExtrudeFeatureData = { id: "e1", type: "extrude", sketchId: sketch.id, length: 5 };
            const body = bodyWith([extrude]);
            Transaction.execute(doc, "fuse", () =>
                body.setFeaturesEmitShapeChanged([...body.features, consumeFeature([tool1.id, tool2.id])]),
            );
            expect(tool1.parent).toBe(body);
            expect(tool2.parent).toBe(body);

            Transaction.execute(doc, "edit feature", () =>
                body.setFeatureParameter("b1", "consumeTools", false),
            );

            expect(tool1.parent).toBe(doc.modelManager.rootNode);
            expect(tool2.parent).toBe(doc.modelManager.rootNode);
            expect(tool1.previousSibling).toBe(body);
            expect(tool2.previousSibling).toBe(tool1);
        });

        test("removing the boolean feature releases the tool", () => {
            const tool = toolSketch();
            const body = bodyWithTool(tool);

            Transaction.execute(doc, "remove feature", () => body.removeFeature("b1"));

            expect(tool.parent).toBe(doc.modelManager.rootNode);
            expect(tool.parentVisible).toBe(true);
        });

        test("serialization round-trips consumed tools under the body", async () => {
            const tool = toolSketch();
            bodyWithTool(tool);
            const data = doc.modelManager.serialize();

            const reloaded = new TestDocument({ application: createMockApplication() });
            await reloaded.modelManager.deserialize(data);

            const body = reloaded.modelManager.findNode(
                (n) => n instanceof ParametricBodyNode,
            ) as ParametricBodyNode;
            const reloadedTool = reloaded.modelManager.findNode((n) => n.id === tool.id)!;
            expect(reloadedTool.parent).toBe(body);
            expect(reloadedTool.parentVisible).toBe(false);
            expect(body.shape.isOk).toBe(true);
        });
    });

    function variableFeature(name: string, expression: string): VariableFeatureData {
        return { id: "v1", type: "variable", name, expression };
    }

    test("a variable defines a scope value usable by later features", () => {
        const extrude: ExtrudeFeatureData = {
            id: "e1",
            type: "extrude",
            sketchId: sketch.id,
            length: "width * 2",
        };
        const body = bodyWith([variableFeature("width", "10"), extrude]);

        expect(body.shape.isOk).toBe(true);
        const vec = (mocks.prism.mock.calls[0] as unknown as [any, XYZ])[1];
        expect(vec.z).toBe(20);
        expect(body.featureItems()[0].display).toBe("command.feature.variable");
        expect(body.featureItems()[0].parameters).toEqual([
            { key: "name", display: "common.name", value: "width" },
            { key: "expression", display: "common.expression", value: "10" },
        ]);
    });

    test("expressions work in any numeric parameter", () => {
        const feature: RevolveFeatureData = {
            id: "r1",
            type: "revolve",
            sketchId: sketch.id,
            axis: AXIS,
            angle: "180 / 2",
        };
        const body = bodyWith([feature]);

        expect(body.shape.isOk).toBe(true);
        expect((mocks.revolve.mock.calls[0] as unknown as [any, any, number])[2]).toBe(90);
    });

    test("editing a variable re-evaluates dependent features", () => {
        const extrude: ExtrudeFeatureData = {
            id: "e1",
            type: "extrude",
            sketchId: sketch.id,
            length: "width",
        };
        const body = bodyWith([variableFeature("width", "10"), extrude]);
        expect(body.shape.isOk).toBe(true);
        mocks.prism.mockClear();

        Transaction.execute(doc, "edit variable", () => body.setFeatureParameter("v1", "expression", "20"));

        expect(mocks.prism).toHaveBeenCalledTimes(1);
        const vec = (mocks.prism.mock.calls[0] as unknown as [any, XYZ])[1];
        expect(vec.z).toBe(20);
    });

    test("an unresolvable expression surfaces as a feature error", () => {
        const extrude: ExtrudeFeatureData = {
            id: "e1",
            type: "extrude",
            sketchId: sketch.id,
            length: "nope",
        };
        const body = bodyWith([extrude]);

        expect(body.shape.isOk).toBe(false);
        expect(body.shape.error).toBe("Unknown identifier: nope");
        expect(body.featureItems()[0].error).toBe("Unknown identifier: nope");
    });

    test("an invalid variable name surfaces as a feature error", () => {
        const extrude: ExtrudeFeatureData = { id: "e1", type: "extrude", sketchId: sketch.id, length: 5 };
        const body = bodyWith([variableFeature("1bad", "10"), extrude]);

        expect(body.shape.isOk).toBe(false);
        expect(body.featureItems()[0].error).toBe("Invalid variable name: 1bad");
    });

    test("a variable may not shadow a constant", () => {
        const extrude: ExtrudeFeatureData = { id: "e1", type: "extrude", sketchId: sketch.id, length: "pi" };
        const body = bodyWith([variableFeature("pi", "3.2"), extrude]);

        expect(body.shape.isOk).toBe(false);
        expect(body.featureItems()[0].error).toBe("Variable name shadows a constant: pi");
    });

    test("a variable-only body yields an empty compound", () => {
        const body = bodyWith([variableFeature("width", "10")]);

        expect(body.shape.isOk).toBe(true);
        expect(mocks.combine).toHaveBeenCalledTimes(1);
        expect((mocks.combine.mock.calls[0] as unknown as [any[]])[0]).toEqual([]);
    });

    describe("extrude profiles", () => {
        const SECOND_SQUARE: SketchData["entities"] = [
            { id: 5, type: "line", params: [5, 5, 7, 5] },
            { id: 6, type: "line", params: [7, 5, 7, 7] },
            { id: 7, type: "line", params: [7, 7, 5, 7] },
            { id: 8, type: "line", params: [5, 7, 5, 5] },
        ];

        const SECOND_PROFILE: ProfileRef = {
            edges: [
                { kind: "line", start: { x: 5, y: 5, z: 0 }, end: { x: 7, y: 5, z: 0 } },
                { kind: "line", start: { x: 7, y: 5, z: 0 }, end: { x: 7, y: 7, z: 0 } },
                { kind: "line", start: { x: 7, y: 7, z: 0 }, end: { x: 5, y: 7, z: 0 } },
                { kind: "line", start: { x: 5, y: 7, z: 0 }, end: { x: 5, y: 5, z: 0 } },
            ],
        };

        function twoLoopSketch() {
            const node = new SketchNode({
                document: doc,
                plane: Plane.XY,
                data: { entities: [...SQUARE.entities, ...SECOND_SQUARE], constraints: [] },
            });
            doc.modelManager.addNode(node);
            return node;
        }

        /** Overlaps SQUARE without sharing endpoints, so the loops stay separate groups. */
        const OVERLAPPING_SQUARE: SketchData["entities"] = [
            { id: 5, type: "line", params: [0.5, -0.5, 2, -0.5] },
            { id: 6, type: "line", params: [2, -0.5, 2, 1.5] },
            { id: 7, type: "line", params: [2, 1.5, 0.5, 1.5] },
            { id: 8, type: "line", params: [0.5, 1.5, 0.5, -0.5] },
        ];

        function overlappingLoopSketch() {
            const node = new SketchNode({
                document: doc,
                plane: Plane.XY,
                data: { entities: [...SQUARE.entities, ...OVERLAPPING_SQUARE], constraints: [] },
            });
            doc.modelManager.addNode(node);
            return node;
        }

        test("extrudes only the referenced profiles", () => {
            const two = twoLoopSketch();
            const extrude: ExtrudeFeatureData = {
                id: "e1",
                type: "extrude",
                sketchId: two.id,
                length: 5,
                profiles: [SECOND_PROFILE],
            };
            const body = bodyWith([extrude]);

            expect(body.shape.isOk).toBe(true);
            expect(mocks.prism).toHaveBeenCalledTimes(1);
            const face = (mocks.prism.mock.calls[0] as unknown as [any])[0];
            const starts = face.findSubShapes(ShapeTypes.edge).map((e: any) => e.startPoint().x);
            expect(starts.every((x: number) => x >= 5)).toBe(true);
        });

        test("without profiles every loop is extruded", () => {
            const two = twoLoopSketch();
            const extrude: ExtrudeFeatureData = { id: "e1", type: "extrude", sketchId: two.id, length: 5 };
            const body = bodyWith([extrude]);

            expect(body.shape.isOk).toBe(true);
            expect(mocks.prism).toHaveBeenCalledTimes(2);
            // Disjoint profiles skip the boolean and stay a compound.
            expect(mocks.booleanFuse).not.toHaveBeenCalled();
            expect(body.shape.unchecked()!.shapeType).toBe(ShapeTypes.compound);
        });

        test("touching profiles are fused into one solid", () => {
            const overlapping = overlappingLoopSketch();
            const extrude: ExtrudeFeatureData = {
                id: "e1",
                type: "extrude",
                sketchId: overlapping.id,
                length: 5,
            };
            const body = bodyWith([extrude]);

            expect(body.shape.isOk).toBe(true);
            expect(body.shape.unchecked()).toBe(mocks.fusedShape);
            expect(mocks.booleanFuse).toHaveBeenCalledTimes(1);
            const [args, tools, simplify] = mocks.booleanFuse.mock.calls[0] as unknown as [
                any[],
                any[],
                boolean,
            ];
            expect(args).toEqual([mocks.prismShapes[0]]);
            expect(tools).toEqual([mocks.prismShapes[1]]);
            expect(simplify).toBe(true);
            // The fuse copies the geometry; the intermediate prisms are disposed.
            expect(mocks.prismShapes[0].dispose).toHaveBeenCalled();
            expect(mocks.prismShapes[1].dispose).toHaveBeenCalled();
        });

        test("falls back to a compound when fusing touching profiles fails", () => {
            const overlapping = overlappingLoopSketch();
            mocks.booleanFuse.mockReturnValue(Result.err("fuse failed") as any);
            const extrude: ExtrudeFeatureData = {
                id: "e1",
                type: "extrude",
                sketchId: overlapping.id,
                length: 5,
            };
            const body = bodyWith([extrude]);

            expect(body.shape.isOk).toBe(true);
            expect(body.shape.unchecked()!.shapeType).toBe(ShapeTypes.compound);
            // The prisms are still owned by the compound — not disposed.
            expect(mocks.prismShapes[0].dispose).not.toHaveBeenCalled();
        });

        test("a nested loop is hollowed out of the outer profile by default", () => {
            const nested = new SketchNode({
                document: doc,
                plane: Plane.XY,
                data: {
                    entities: [
                        { id: 1, type: "line", params: [0, 0, 10, 0] },
                        { id: 2, type: "line", params: [10, 0, 10, 10] },
                        { id: 3, type: "line", params: [10, 10, 0, 10] },
                        { id: 4, type: "line", params: [0, 10, 0, 0] },
                        { id: 5, type: "line", params: [2, 2, 3, 2] },
                        { id: 6, type: "line", params: [3, 2, 3, 3] },
                        { id: 7, type: "line", params: [3, 3, 2, 3] },
                        { id: 8, type: "line", params: [2, 3, 2, 2] },
                    ],
                    constraints: [],
                },
            });
            doc.modelManager.addNode(nested);
            const extrude: ExtrudeFeatureData = { id: "e1", type: "extrude", sketchId: nested.id, length: 5 };
            const body = bodyWith([extrude]);

            expect(body.shape.isOk).toBe(true);
            // Only the outer profile is extruded; its face carries the hole wire.
            expect(mocks.prism).toHaveBeenCalledTimes(1);
            const outerCall = mocks.face.mock.calls.find((c) => (c[0] as any[]).length === 2);
            expect(outerCall).toBeDefined();
        });

        test("moving a circle profile re-matches and the extrude follows", () => {
            // Full-circle wires close with a single edge.
            mocks.wire.mockImplementation(((edges: any[]) =>
                Result.ok({ isClosed: () => true, edges })) as any);
            const circleData = (cx: number): SketchData => ({
                entities: [
                    { id: 1, type: "circle", params: [cx, 0, 1] },
                    { id: 2, type: "circle", params: [5, 0, 1] },
                    { id: 3, type: "circle", params: [10, 0, 1] },
                ],
                constraints: [],
            });
            const three = new SketchNode({ document: doc, plane: Plane.XY, data: circleData(0) });
            doc.modelManager.addNode(three);

            // Capture the refs exactly as the extrude command does at pick time.
            const profileSet = sketchProfiles(three);
            expect(profileSet.isOk).toBe(true);
            const profiles = allProfiles(profileSet.value).map((face) => captureProfileRef(face));
            expect(profiles.length).toBe(3);
            const body = bodyWith([{ id: "e1", type: "extrude", sketchId: three.id, length: 5, profiles }]);
            expect(body.shape.isOk).toBe(true);
            expect(mocks.prism).toHaveBeenCalledTimes(3);

            // Move the first circle; the body must re-evaluate with the moved profile.
            three.setDataEmitShapeChanged(circleData(2));

            expect(body.shape.isOk).toBe(true);
            expect(mocks.prism).toHaveBeenCalledTimes(6);
            const centers = mocks.prism.mock.calls
                .slice(3)
                .map((c) => (c[0] as any).findSubShapes(ShapeTypes.edge)[0].curve.basisCurve.center.x)
                .sort((a, b) => a - b);
            expect(centers).toEqual([2, 5, 10]);
        });

        test("consecutive moves of two profiles re-anchor the refs and still follow", () => {
            mocks.wire.mockImplementation(((edges: any[]) =>
                Result.ok({ isClosed: () => true, edges })) as any);
            const circleData = (c1: number, c2: number): SketchData => ({
                entities: [
                    { id: 1, type: "circle", params: [c1, 0, 1] },
                    { id: 2, type: "circle", params: [c2, 0, 1] },
                    { id: 3, type: "circle", params: [60, 0, 1] },
                ],
                constraints: [],
            });
            const three = new SketchNode({ document: doc, plane: Plane.XY, data: circleData(0, 30) });
            doc.modelManager.addNode(three);

            const profileSet = sketchProfiles(three);
            expect(profileSet.isOk).toBe(true);
            const profiles = allProfiles(profileSet.value).map((face) => captureProfileRef(face));
            const body = bodyWith([{ id: "e1", type: "extrude", sketchId: three.id, length: 5, profiles }]);
            expect(body.shape.isOk).toBe(true);
            expect(mocks.prism).toHaveBeenCalledTimes(3);

            // Move the first circle, then drag the second one next to it. Against
            // the original pick-time refs BOTH would read as moved (drift 15 and 10)
            // and compete ambiguously between the two close faces; re-anchored refs
            // keep the first circle's exact hit, so the second claims the leftover.
            three.setDataEmitShapeChanged(circleData(15, 30));
            expect(body.shape.isOk).toBe(true);
            three.setDataEmitShapeChanged(circleData(15, 20));

            expect(body.shape.isOk).toBe(true);
            expect(mocks.prism).toHaveBeenCalledTimes(9);
            const centers = mocks.prism.mock.calls
                .slice(6)
                .map((c) => (c[0] as any).findSubShapes(ShapeTypes.edge)[0].curve.basisCurve.center.x)
                .sort((a, b) => a - b);
            expect(centers).toEqual([15, 20, 60]);

            // The stored refs were re-anchored to the geometry matched last.
            const stored = (body.features[0] as ExtrudeFeatureData).profiles!;
            const storedCenters = stored
                .map((ref) => (ref.edges[0] as { center: { x: number } }).center.x)
                .sort((a, b) => a - b);
            expect(storedCenters).toEqual([15, 20, 60]);
        });

        test("a lost profile surfaces as a feature error", () => {
            // No remaining loop has the ref's edge count, so there is no candidate.
            // (A sole same-count loop would be adopted as moved geometry, like EdgeRef.)
            const triangleProfile: ProfileRef = {
                edges: [
                    { kind: "line", start: { x: 5, y: 5, z: 0 }, end: { x: 7, y: 5, z: 0 } },
                    { kind: "line", start: { x: 7, y: 5, z: 0 }, end: { x: 6, y: 7, z: 0 } },
                    { kind: "line", start: { x: 6, y: 7, z: 0 }, end: { x: 5, y: 5, z: 0 } },
                ],
            };
            const extrude: ExtrudeFeatureData = {
                id: "e1",
                type: "extrude",
                sketchId: sketch.id,
                length: 5,
                profiles: [triangleProfile],
            };
            const body = bodyWith([extrude]);

            expect(body.shape.isOk).toBe(false);
            expect(body.featureItems()[0].error).toBe("Sketch profile not found after rebuild");
        });

        test("symmetric extrudes both directions and fuses the halves", () => {
            const extrude: ExtrudeFeatureData = {
                id: "e1",
                type: "extrude",
                sketchId: sketch.id,
                length: 5,
                symmetric: true,
            };
            const body = bodyWith([extrude]);

            expect(body.shape.isOk).toBe(true);
            expect(mocks.prism).toHaveBeenCalledTimes(2);
            const vecs = mocks.prism.mock.calls.map((c) => c[1] as XYZ);
            expect(vecs[0].z).toBeCloseTo(5);
            expect(vecs[1].z).toBeCloseTo(-5);
            // The two halves touch at the sketch plane, so they fuse into one solid.
            expect(mocks.booleanFuse).toHaveBeenCalledTimes(1);
            expect(body.shape.unchecked()).toBe(mocks.fusedShape);
        });
    });

    describe("extrude operation", () => {
        test("join fuses the prism with the preceding feature's shape", () => {
            const first: ExtrudeFeatureData = { id: "e1", type: "extrude", sketchId: sketch.id, length: 5 };
            const join: ExtrudeFeatureData = {
                id: "e2",
                type: "extrude",
                sketchId: sketch.id,
                length: 3,
                operation: "fuse",
            };
            const body = bodyWith([first, join]);

            expect(body.shape.isOk).toBe(true);
            expect(mocks.booleanFuse).toHaveBeenCalledTimes(1);
            const [args, tools] = mocks.booleanFuse.mock.calls[0] as unknown as [any[], any[]];
            expect(args).toEqual([mocks.prismShapes[0]]);
            expect(tools).toEqual([mocks.prismShapes[1]]);
            // The second prism is an intermediate of the boolean — it is disposed.
            expect(mocks.prismShapes[1].dispose).toHaveBeenCalled();
            expect(body.shape.unchecked()).toBe(mocks.fusedShape);
        });

        test("cut removes the prism from the preceding feature's shape", () => {
            const first: ExtrudeFeatureData = { id: "e1", type: "extrude", sketchId: sketch.id, length: 5 };
            const cut: ExtrudeFeatureData = {
                id: "e2",
                type: "extrude",
                sketchId: sketch.id,
                length: 3,
                operation: "cut",
            };
            const body = bodyWith([first, cut]);

            expect(body.shape.isOk).toBe(true);
            // The host body is the cut target: input minus the new prism, not the reverse.
            const [args, tools] = mocks.booleanCut.mock.calls[0] as unknown as [any[], any[]];
            expect(args).toEqual([mocks.prismShapes[0]]);
            expect(tools).toEqual([mocks.prismShapes[1]]);
        });

        test("an operation without a preceding feature surfaces as an error", () => {
            const join: ExtrudeFeatureData = {
                id: "e1",
                type: "extrude",
                sketchId: sketch.id,
                length: 5,
                operation: "fuse",
            };
            const body = bodyWith([join]);

            expect(body.shape.isOk).toBe(false);
            expect(body.featureItems()[0].error).toBe(
                "Extrude join/cut/intersect requires a preceding feature",
            );
        });
    });

    describe("extrude from body faces (press-pull)", () => {
        /** Planar top face of the mocked unit prism at height `z`, with boundary edges. */
        function topFace(z: number) {
            const edges = [
                edge(new XYZ({ x: 0, y: 0, z }), new XYZ({ x: 1, y: 0, z })),
                edge(new XYZ({ x: 1, y: 0, z }), new XYZ({ x: 1, y: 1, z })),
                edge(new XYZ({ x: 1, y: 1, z }), new XYZ({ x: 0, y: 1, z })),
                edge(new XYZ({ x: 0, y: 1, z }), new XYZ({ x: 0, y: 0, z })),
            ];
            return {
                shapeType: ShapeTypes.face,
                isEqual: () => false,
                dispose: rs.fn(),
                normal: () => [new XYZ({ x: 0, y: 0, z }), XYZ.unitZ] as [XYZ, XYZ],
                findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? edges : []),
            };
        }

        /** Makes every prism expose `face`, so a host-sourced feature finds it on its input. */
        function prismWithTopFace(face: any) {
            mocks.prism.mockImplementation(((profileFace: any, _vec: XYZ) => {
                const points = (profileFace.findSubShapes(ShapeTypes.edge) as any[]).flatMap((e) => [
                    e.startPoint(),
                    e.endPoint(),
                ]);
                const shape = {
                    shapeType: ShapeTypes.solid,
                    isEqual: () => false,
                    dispose: rs.fn(),
                    findSubShapes: (type: ShapeType) =>
                        type === ShapeTypes.face ? [face] : type === ShapeTypes.edge ? [subEdge()] : [],
                    boundingBox: () => BoundingBox.fromPoints(points),
                };
                mocks.prismShapes.push(shape);
                return Result.ok(shape);
            }) as any);
        }

        test("a standalone body extrudes another body's face along its outward normal", () => {
            const sourceBody = bodyWith([{ id: "e0", type: "extrude", sketchId: sketch.id, length: 2 }]);
            const face = topFace(2);
            sourceBody.shape.unchecked()!.findSubShapes = ((type: ShapeType) =>
                type === ShapeTypes.face ? [face] : []) as any;
            const feature: ExtrudeFeatureData = {
                id: "p1",
                type: "extrude",
                source: { nodeId: sourceBody.id, profiles: [captureProfileRef(face as any)] },
                length: 5,
            };
            const body = bodyWith([feature]);

            expect(body.shape.isOk).toBe(true);
            expect(mocks.prism).toHaveBeenCalledTimes(2);
            const [profile, vec] = mocks.prism.mock.calls[1] as unknown as [any, XYZ];
            expect(profile).toBe(face);
            expect(vec.z).toBeCloseTo(5);
            expect(body.shape.unchecked()).toBe(mocks.prismShape);
        });

        test("a face of the host body itself resolves against the feature's input", () => {
            const face = topFace(2);
            prismWithTopFace(face);
            const first: ExtrudeFeatureData = { id: "e1", type: "extrude", sketchId: sketch.id, length: 2 };
            const pressPull: ExtrudeFeatureData = {
                id: "p1",
                type: "extrude",
                source: { nodeId: "host", profiles: [captureProfileRef(face as any)] },
                length: 5,
            };
            const body = new ParametricBodyNode({ document: doc, id: "host", features: [first, pressPull] });
            doc.modelManager.addNode(body);

            expect(body.shape.isOk).toBe(true);
            expect(mocks.prism).toHaveBeenCalledTimes(2);
            const [profile, vec] = mocks.prism.mock.calls[1] as unknown as [any, XYZ];
            expect(profile).toBe(face);
            expect(vec.z).toBeCloseTo(5);
            // The body must not watch itself — that would re-evaluate on every rebuild.
            expect((body as any)._watched.has("host")).toBe(false);
        });

        test("cut on the host's own face subtracts from the preceding feature", () => {
            const face = topFace(2);
            prismWithTopFace(face);
            const first: ExtrudeFeatureData = { id: "e1", type: "extrude", sketchId: sketch.id, length: 2 };
            const cut: ExtrudeFeatureData = {
                id: "p1",
                type: "extrude",
                source: { nodeId: "host", profiles: [captureProfileRef(face as any)] },
                length: 5,
                operation: "cut",
            };
            const body = new ParametricBodyNode({ document: doc, id: "host", features: [first, cut] });
            doc.modelManager.addNode(body);

            expect(body.shape.isOk).toBe(true);
            const [args, tools] = mocks.booleanCut.mock.calls[0] as unknown as [any[], any[]];
            expect(args).toEqual([mocks.prismShapes[0]]);
            expect(tools).toEqual([mocks.prismShapes[1]]);
            expect(body.shape.unchecked()).toBe(mocks.fusedShape);
        });

        test("a self-sourced first feature surfaces as an error", () => {
            const feature: ExtrudeFeatureData = {
                id: "p1",
                type: "extrude",
                source: { nodeId: "host", profiles: [captureProfileRef(topFace(2) as any)] },
                length: 5,
            };
            const body = new ParametricBodyNode({ document: doc, id: "host", features: [feature] });
            doc.modelManager.addNode(body);

            expect(body.shape.isOk).toBe(false);
            expect(body.featureItems()[0].error).toBe("Extrude source face requires a preceding feature");
        });

        test("a missing source body surfaces as an error", () => {
            const feature: ExtrudeFeatureData = {
                id: "p1",
                type: "extrude",
                source: { nodeId: "missing", profiles: [captureProfileRef(topFace(2) as any)] },
                length: 5,
            };
            const body = bodyWith([feature]);

            expect(body.shape.isOk).toBe(false);
            expect(body.featureItems()[0].error).toBe("Extrude source body not found");
        });

        test("nodeIds reference the sketch or the source node", () => {
            const handler = featureHandler("extrude")!;
            expect(handler.nodeIds({ id: "x", type: "extrude", sketchId: "s1", length: 1 })).toEqual(["s1"]);
            expect(
                handler.nodeIds({
                    id: "x",
                    type: "extrude",
                    source: { nodeId: "b1", profiles: [] },
                    length: 1,
                }),
            ).toEqual(["b1"]);
        });
    });
});
