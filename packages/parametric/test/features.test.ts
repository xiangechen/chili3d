// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    Line,
    Matrix4,
    Plane,
    Result,
    type ShapeType,
    ShapeTypes,
    Transaction,
    type XYZ,
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
        startPoint: () => start,
        endPoint: () => end,
        isEqual: () => false,
    };
}

function setupMocks() {
    const face = { shapeType: ShapeTypes.face, isEqual: () => false };
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
    const prismShape = withTransform({
        shapeType: ShapeTypes.solid,
        isEqual: () => false,
        dispose: rs.fn(),
        findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? [subEdge()] : []),
    });
    const revolvedShape = { shapeType: ShapeTypes.solid, isEqual: () => false, dispose: rs.fn() };
    const filletedShape = { shapeType: ShapeTypes.solid, isEqual: () => false, dispose: rs.fn() };
    const fusedShape = { shapeType: ShapeTypes.solid, isEqual: () => false, dispose: rs.fn() };
    const line = rs.fn((start: XYZ, end: XYZ) => Result.ok(edge(start, end)));
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
    const wire = rs.fn((edges: any[]) =>
        Result.ok({ isClosed: () => edges.length > 1, toFace: () => Result.ok(face) }),
    );
    const prism = rs.fn((_face: any, _vec: XYZ) => Result.ok(prismShape));
    const revolve = rs.fn((_face: any, _axis: Line, _angle: number) => Result.ok(revolvedShape));
    const fillet = rs.fn((_shape: any, _indexes: number[], _radius: number) => Result.ok(filletedShape));
    const chamfer = rs.fn((_shape: any, _indexes: number[], _distance: number) => Result.ok(filletedShape));
    const booleanFuse = rs.fn((_s1: any[], _s2: any[], _simplify: boolean) => Result.ok(fusedShape));
    const booleanCut = rs.fn((_s1: any[], _s2: any[]) => Result.ok(fusedShape));
    const booleanCommon = rs.fn((_s1: any[], _s2: any[]) => Result.ok(fusedShape));
    const restore = mockShapeFactory({
        line,
        combine,
        wire,
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
        combine,
        wire,
        prism,
        revolve,
        fillet,
        chamfer,
        booleanFuse,
        booleanCut,
        booleanCommon,
        prismShape,
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
});
