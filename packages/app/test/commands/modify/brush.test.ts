// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { EditableShapeNode, type IDocument, type IShape, Result, ShapeTypes, XYZ } from "@chili3d/core";
import { describe, expect, rs, test } from "@rstest/core";
import { AddBrushCommand, ClearBrushCommand, RemoveBrushCommand } from "../../../src/commands/modify/brush";
import {
    ensureGlobalStubApp,
    mockShape,
    seedStepDatas,
    shapeData,
    shapeStepResult,
    stubTransactionRun,
    wireCommand,
} from "../../commands/commandTestUtils";

/**
 * Build a real EditableShapeNode so `instanceof GeometryNode` checks inside
 * brush.executeMainTask succeed, while spying on the face-material mutators so
 * the real mesh-merge logic (which needs a WASM-backed shape) is skipped.
 *
 * `doc` must be the mock document returned by wireCommand (it supplies
 * `modelManager.materials` that the GeometryNode constructor reads).
 */
function makeGeometryNodeSpy(doc: IDocument) {
    const shape = mockShape({ shapeType: ShapeTypes.solid });
    const node = new EditableShapeNode({
        document: doc,
        name: "body",
        shape: Result.ok(shape as unknown as IShape),
    });
    const addSpy = rs.spyOn(node, "addFaceMaterial").mockImplementation(() => {});
    const removeSpy = rs.spyOn(node, "removeFaceMaterial").mockImplementation(() => {});
    const clearSpy = rs.spyOn(node, "clearFaceMaterial").mockImplementation(() => {});
    return { node, shape, addSpy, removeSpy, clearSpy };
}

describe("AddBrushCommand", () => {
    test("should have command metadata", () => {
        const data = (AddBrushCommand as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("modify.brushAdd");
        expect(data.icon).toBe("icon-addBrush");
    });

    test("getSteps should return one step", () => {
        const cmd = new AddBrushCommand();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(1);
    });

    test("materialId should default to first document material", () => {
        const cmd = new AddBrushCommand();
        const { doc } = wireCommand(cmd);
        expect(cmd.materialId).toBe("mat-default");
    });

    test("materialId setter should update property", () => {
        const cmd = new AddBrushCommand();
        wireCommand(cmd);
        cmd.materialId = "mat-other";
        expect(cmd.materialId).toBe("mat-other");
    });

    test("executeMainTask should call addFaceMaterial on GeometryNode owners grouped by node", () => {
        const restoreApp = ensureGlobalStubApp();
        const restoreTx = stubTransactionRun();
        try {
            const cmd = new AddBrushCommand();
            const { doc } = wireCommand(cmd);

            const { node: nodeA, addSpy: addA } = makeGeometryNodeSpy(doc);
            const { node: nodeB, addSpy: addB } = makeGeometryNodeSpy(doc);

            cmd.materialId = "mat-brush";

            // Two faces on nodeA (index 0, 2) and one face on nodeB (index 5).
            // Only entries whose owner.node is a GeometryNode should be collected.
            const shapes = [
                shapeData({ shape: { shapeType: ShapeTypes.face, index: 0 } as any, node: nodeA }),
                shapeData({ shape: { shapeType: ShapeTypes.face, index: 2 } as any, node: nodeA }),
                shapeData({ shape: { shapeType: ShapeTypes.face, index: 5 } as any, node: nodeB }),
            ];
            seedStepDatas(cmd, [shapeStepResult([], {})]);
            (cmd as any).stepDatas[0].shapes = shapes;

            (cmd as any).executeMainTask();

            expect(addA).toHaveBeenCalledTimes(1);
            expect(addA).toHaveBeenCalledWith([
                { faceIndex: 0, materialId: "mat-brush" },
                { faceIndex: 2, materialId: "mat-brush" },
            ]);
            expect(addB).toHaveBeenCalledTimes(1);
            expect(addB).toHaveBeenCalledWith([{ faceIndex: 5, materialId: "mat-brush" }]);
        } finally {
            restoreTx();
            restoreApp();
        }
    });

    test("executeMainTask should skip shapes whose owner is not a GeometryNode", () => {
        const restoreApp = ensureGlobalStubApp();
        const restoreTx = stubTransactionRun();
        try {
            const cmd = new AddBrushCommand();
            wireCommand(cmd);
            cmd.materialId = "mat-brush";

            const plainNode = { id: "not-a-geometry-node" };
            const shapes = [
                shapeData({ shape: { shapeType: ShapeTypes.face, index: 3 } as any, node: plainNode }),
            ];
            seedStepDatas(cmd, [shapeStepResult([], {})] as any);
            (cmd as any).stepDatas[0].shapes = shapes;

            // Should not throw and should call visual.update (a no-op spy).
            expect(() => (cmd as any).executeMainTask()).not.toThrow();
        } finally {
            restoreTx();
            restoreApp();
        }
    });
});

describe("RemoveBrushCommand", () => {
    test("should have command metadata", () => {
        const data = (RemoveBrushCommand as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("modify.brushRemove");
        expect(data.icon).toBe("icon-removeBrush");
    });

    test("getSteps should return one step", () => {
        const cmd = new RemoveBrushCommand();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(1);
    });

    test("executeMainTask should call removeFaceMaterial on GeometryNode owners grouped by node", () => {
        const restoreApp = ensureGlobalStubApp();
        const restoreTx = stubTransactionRun();
        try {
            const cmd = new RemoveBrushCommand();
            const { doc } = wireCommand(cmd);

            const { node: nodeA, removeSpy: removeA } = makeGeometryNodeSpy(doc);
            const { node: nodeB, removeSpy: removeB } = makeGeometryNodeSpy(doc);

            const shapes = [
                shapeData({ shape: { shapeType: ShapeTypes.face, index: 1 } as any, node: nodeA }),
                shapeData({ shape: { shapeType: ShapeTypes.face, index: 7 } as any, node: nodeA }),
                shapeData({ shape: { shapeType: ShapeTypes.face, index: 4 } as any, node: nodeB }),
            ];
            seedStepDatas(cmd, [shapeStepResult([], {})] as any);
            (cmd as any).stepDatas[0].shapes = shapes;

            (cmd as any).executeMainTask();

            expect(removeA).toHaveBeenCalledTimes(1);
            expect(removeA).toHaveBeenCalledWith([1, 7]);
            expect(removeB).toHaveBeenCalledTimes(1);
            expect(removeB).toHaveBeenCalledWith([4]);
        } finally {
            restoreTx();
            restoreApp();
        }
    });

    test("executeMainTask should skip shapes whose owner is not a GeometryNode", () => {
        const restoreApp = ensureGlobalStubApp();
        const restoreTx = stubTransactionRun();
        try {
            const cmd = new RemoveBrushCommand();
            wireCommand(cmd);

            const shapes = [
                shapeData({ shape: { shapeType: ShapeTypes.face, index: 1 } as any, node: { id: "x" } }),
            ];
            seedStepDatas(cmd, [shapeStepResult([], {})] as any);
            (cmd as any).stepDatas[0].shapes = shapes;

            expect(() => (cmd as any).executeMainTask()).not.toThrow();
        } finally {
            restoreTx();
            restoreApp();
        }
    });
});

describe("ClearBrushCommand", () => {
    test("should have command metadata", () => {
        const data = (ClearBrushCommand as any).prototype.data;
        expect(data).toBeDefined();
        expect(data.key).toBe("modify.brushClear");
        expect(data.icon).toBe("icon-clearBrush");
    });

    test("getSteps should return one step", () => {
        const cmd = new ClearBrushCommand();
        const steps = (cmd as any).getSteps();
        expect(steps.length).toBe(1);
    });

    test("executeMainTask should call clearFaceMaterial only on GeometryNode nodes", () => {
        const restoreApp = ensureGlobalStubApp();
        const restoreTx = stubTransactionRun();
        try {
            const cmd = new ClearBrushCommand();
            const { doc } = wireCommand(cmd);

            const { node: geoA, clearSpy: clearA } = makeGeometryNodeSpy(doc);
            const { node: geoB, clearSpy: clearB } = makeGeometryNodeSpy(doc);

            const nonGeo = { id: "plain" };

            // nodeStepResult carries `.nodes` (SelectNodeStep consumer).
            seedStepDatas(cmd, [
                {
                    view: { workplane: undefined, direction: () => XYZ.unitNZ } as any,
                    type: "node",
                    nodes: [geoA, nonGeo, geoB],
                    shapes: [],
                } as any,
            ]);

            (cmd as any).executeMainTask();

            expect(clearA).toHaveBeenCalledTimes(1);
            expect(clearB).toHaveBeenCalledTimes(1);
        } finally {
            restoreTx();
            restoreApp();
        }
    });
});
