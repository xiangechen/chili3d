// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { AsyncController, ShapeTypes } from "../../src";
import type { INodeFilter, IShapeFilter } from "../../src/selectionFilter";
import { GetOrSelectNodeStep, GetOrSelectShapeStep, SelectNodeStep, SelectShapeStep } from "../../src/step";
import type { IView, VisualShapeData } from "../../src/visual";
import { createMockPicker, createMockSelection, TestDocument } from "../mocks";

function tip(): string {
    return "test.tip" as unknown as string;
}

function createMockShapeData(overrides?: Partial<VisualShapeData>): VisualShapeData {
    return {
        shape: { id: "s1", shapeType: ShapeTypes.edge } as never,
        owner: { node: { id: "n1" } } as never,
        transform: {} as never,
        indexes: [],
        point: undefined,
        ...overrides,
    } as unknown as VisualShapeData;
}

// ============================================================================
// SelectShapeStep
// ============================================================================

describe("SelectShapeStep", () => {
    test("should return undefined when pickShape returns empty", async () => {
        const picker = createMockPicker({ pickShapeResult: [] });
        const selection = createMockSelection();
        const doc = new TestDocument({ picker, selection });
        const controller = new AsyncController();

        const step = new SelectShapeStep(ShapeTypes.edge, tip() as never);
        const result = await step.execute(doc, controller);
        expect(result).toBeUndefined();
        controller.dispose();
    });

    test("should return SnapResult with type shape when pickShape returns data", async () => {
        const shapeData = createMockShapeData();
        const picker = createMockPicker({ pickShapeResult: [shapeData] });
        const selection = createMockSelection();
        const doc = new TestDocument({
            picker,
            selection,
            application: { activeView: {} as IView } as never,
        });
        const controller = new AsyncController();

        const step = new SelectShapeStep(ShapeTypes.edge, tip() as never);
        const result = await step.execute(doc, controller);
        expect(result).toBeDefined();
        expect(result!.type).toBe("shape");
        expect(result!.shapes.length).toBe(1);
        expect(result!.shapes[0]).toBe(shapeData);
        controller.dispose();
    });

    test("should call beforeSelection and afterSelection callbacks", async () => {
        let beforeCalled = false;
        let afterCalled = false;
        const picker = createMockPicker({ pickShapeResult: [createMockShapeData()] });
        const selection = createMockSelection();
        const doc = new TestDocument({
            picker,
            selection,
            application: { activeView: {} as IView } as never,
        });
        const controller = new AsyncController();

        const step = new SelectShapeStep(ShapeTypes.edge, tip() as never, {
            beforeSelection: () => {
                beforeCalled = true;
            },
            afterSelection: () => {
                afterCalled = true;
            },
        });
        await step.execute(doc, controller);
        expect(beforeCalled).toBe(true);
        expect(afterCalled).toBe(true);
        controller.dispose();
    });

    test("should clear selection when keepSelection is not set", async () => {
        let cleared = false;
        const selection = createMockSelection();
        selection.clearSelection = () => {
            cleared = true;
        };
        const picker = createMockPicker({ pickShapeResult: [createMockShapeData()] });
        const doc = new TestDocument({
            picker,
            selection,
            application: { activeView: {} as IView } as never,
        });
        const controller = new AsyncController();

        const step = new SelectShapeStep(ShapeTypes.edge, tip() as never);
        await step.execute(doc, controller);
        expect(cleared).toBe(true);
        controller.dispose();
    });

    test("should not clear selection when keepSelection is true", async () => {
        let cleared = false;
        const selection = createMockSelection();
        selection.clearSelection = () => {
            cleared = true;
        };
        const picker = createMockPicker({ pickShapeResult: [createMockShapeData()] });
        const doc = new TestDocument({
            picker,
            selection,
            application: { activeView: {} as IView } as never,
        });
        const controller = new AsyncController();

        const step = new SelectShapeStep(ShapeTypes.edge, tip() as never, { keepSelection: true });
        await step.execute(doc, controller);
        expect(cleared).toBe(false);
        controller.dispose();
    });

    test("should pass filter options to pickShape", async () => {
        let capturedOptions: any;
        const picker = createMockPicker({ pickShapeResult: [createMockShapeData()] });
        picker.pickShape = (_prompt, _ctrl, options) => {
            capturedOptions = options;
            return Promise.resolve([createMockShapeData()]);
        };
        const selection = createMockSelection();
        const doc = new TestDocument({
            picker,
            selection,
            application: { activeView: {} as IView } as never,
        });
        const controller = new AsyncController();

        const shapeFilter: IShapeFilter = { allow: () => true };
        const nodeFilter: INodeFilter = { allow: () => true };

        const step = new SelectShapeStep(ShapeTypes.edge, tip() as never, {
            shapeFilter,
            nodeFilter,
        });
        await step.execute(doc, controller);

        expect(capturedOptions).toBeDefined();
        expect(capturedOptions.shapeType).toBe(ShapeTypes.edge);
        expect(capturedOptions.shapeFilter).toBe(shapeFilter);
        expect(capturedOptions.nodeFilter).toBe(nodeFilter);
        controller.dispose();
    });
});

// ============================================================================
// GetOrSelectShapeStep
// ============================================================================

describe("GetOrSelectShapeStep", () => {
    test("should return existing selected shapes when they match", async () => {
        const shapeData = createMockShapeData();
        const selection = createMockSelection();
        selection.getSelectedShapes = () => [shapeData];
        const picker = createMockPicker();
        const doc = new TestDocument({
            picker,
            selection,
            application: { activeView: {} as IView } as never,
        });
        const controller = new AsyncController();

        let pickCalled = false;
        picker.pickShape = () => {
            pickCalled = true;
            return Promise.resolve([]);
        };

        const step = new GetOrSelectShapeStep(ShapeTypes.edge, tip() as never);
        const result = await step.execute(doc, controller);

        expect(result).toBeDefined();
        expect(result!.type).toBe("shape");
        expect(result!.shapes[0]).toBe(shapeData);
        expect(pickCalled).toBe(false);
        expect(controller.result?.status).toBe("success");
        controller.dispose();
    });

    test("should call pickShape when no shapes are selected", async () => {
        const selection = createMockSelection();
        selection.getSelectedShapes = () => [];
        let pickCalled = false;
        const picker = createMockPicker({ pickShapeResult: [createMockShapeData()] });
        picker.pickShape = () => {
            pickCalled = true;
            return Promise.resolve([createMockShapeData()]);
        };
        const doc = new TestDocument({
            picker,
            selection,
            application: { activeView: {} as IView } as never,
        });
        const controller = new AsyncController();

        const step = new GetOrSelectShapeStep(ShapeTypes.edge, tip() as never);
        await step.execute(doc, controller);

        expect(pickCalled).toBe(true);
        controller.dispose();
    });

    test("should call pickShape when selected shape has wrong shapeType", async () => {
        const vertexShape = createMockShapeData();
        // Override shapeType to vertex (not edge)
        (vertexShape.shape as { shapeType: number }).shapeType = ShapeTypes.vertex;

        const selection = createMockSelection();
        selection.getSelectedShapes = () => [vertexShape];
        let pickCalled = false;
        const picker = createMockPicker({ pickShapeResult: [createMockShapeData()] });
        picker.pickShape = () => {
            pickCalled = true;
            return Promise.resolve([createMockShapeData()]);
        };
        const doc = new TestDocument({
            picker,
            selection,
            application: { activeView: {} as IView } as never,
        });
        const controller = new AsyncController();

        const step = new GetOrSelectShapeStep(ShapeTypes.edge, tip() as never);
        await step.execute(doc, controller);

        expect(pickCalled).toBe(true);
        controller.dispose();
    });

    test("should call pickShape when shapeFilter rejects selected shape", async () => {
        const shapeData = createMockShapeData();
        const selection = createMockSelection();
        selection.getSelectedShapes = () => [shapeData];
        let pickCalled = false;
        const picker = createMockPicker({ pickShapeResult: [createMockShapeData()] });
        picker.pickShape = () => {
            pickCalled = true;
            return Promise.resolve([createMockShapeData()]);
        };
        const doc = new TestDocument({
            picker,
            selection,
            application: { activeView: {} as IView } as never,
        });
        const controller = new AsyncController();

        const step = new GetOrSelectShapeStep(ShapeTypes.edge, tip() as never, {
            shapeFilter: { allow: () => false },
        });
        await step.execute(doc, controller);

        expect(pickCalled).toBe(true);
        controller.dispose();
    });

    test("should call pickShape when nodeFilter rejects selected shape's node", async () => {
        const shapeData = createMockShapeData();
        const selection = createMockSelection();
        selection.getSelectedShapes = () => [shapeData];
        let pickCalled = false;
        const picker = createMockPicker({ pickShapeResult: [createMockShapeData()] });
        picker.pickShape = () => {
            pickCalled = true;
            return Promise.resolve([createMockShapeData()]);
        };
        const doc = new TestDocument({
            picker,
            selection,
            application: { activeView: {} as IView } as never,
        });
        const controller = new AsyncController();

        const step = new GetOrSelectShapeStep(ShapeTypes.edge, tip() as never, {
            nodeFilter: { allow: () => false },
        });
        await step.execute(doc, controller);

        expect(pickCalled).toBe(true);
        controller.dispose();
    });
});

// ============================================================================
// SelectNodeStep
// ============================================================================

describe("SelectNodeStep", () => {
    test("should return undefined when pickNode returns empty", async () => {
        const picker = createMockPicker({ pickNodeResult: [] });
        const selection = createMockSelection();
        const doc = new TestDocument({ picker, selection });
        const controller = new AsyncController();

        const step = new SelectNodeStep(tip() as never);
        const result = await step.execute(doc, controller);
        expect(result).toBeUndefined();
        controller.dispose();
    });

    test("should return SnapResult with type node", async () => {
        const mockNode = { id: "n1" } as never;
        const picker = createMockPicker({ pickNodeResult: [mockNode] });
        const selection = createMockSelection();
        const doc = new TestDocument({
            picker,
            selection,
            application: { activeView: {} as IView } as never,
        });
        const controller = new AsyncController();

        const step = new SelectNodeStep(tip() as never);
        const result = await step.execute(doc, controller);
        expect(result).toBeDefined();
        expect(result!.type).toBe("node");
        expect(result!.nodes!.length).toBe(1);
        expect(result!.nodes![0]).toBe(mockNode);
        controller.dispose();
    });

    test("should clear selection when keepSelection is not set", async () => {
        let cleared = false;
        const selection = createMockSelection();
        selection.clearSelection = () => {
            cleared = true;
        };
        const picker = createMockPicker({ pickNodeResult: [{ id: "n1" } as never] });
        const doc = new TestDocument({
            picker,
            selection,
            application: { activeView: {} as IView } as never,
        });
        const controller = new AsyncController();

        const step = new SelectNodeStep(tip() as never);
        await step.execute(doc, controller);
        expect(cleared).toBe(true);
        controller.dispose();
    });

    test("should not clear selection when keepSelection is true", async () => {
        let cleared = false;
        const selection = createMockSelection();
        selection.clearSelection = () => {
            cleared = true;
        };
        const picker = createMockPicker({ pickNodeResult: [{ id: "n1" } as never] });
        const doc = new TestDocument({
            picker,
            selection,
            application: { activeView: {} as IView } as never,
        });
        const controller = new AsyncController();

        const step = new SelectNodeStep(tip() as never, { keepSelection: true });
        await step.execute(doc, controller);
        expect(cleared).toBe(false);
        controller.dispose();
    });
});

// ============================================================================
// GetOrSelectNodeStep
// ============================================================================

describe("GetOrSelectNodeStep", () => {
    test("should return existing selected nodes when they exist", async () => {
        const mockNode = { id: "n1" } as never;
        const selection = createMockSelection();
        selection.getSelectedNodes = () => [mockNode];
        const picker = createMockPicker();
        const doc = new TestDocument({
            picker,
            selection,
            application: { activeView: {} as IView } as never,
        });
        const controller = new AsyncController();

        let pickCalled = false;
        picker.pickNode = () => {
            pickCalled = true;
            return Promise.resolve([]);
        };

        const step = new GetOrSelectNodeStep(tip() as never);
        const result = await step.execute(doc, controller);

        expect(result).toBeDefined();
        expect(result!.type).toBe("node");
        expect(pickCalled).toBe(false);
        expect(controller.result?.status).toBe("success");
        controller.dispose();
    });

    test("should call pickNode when no nodes are selected", async () => {
        const selection = createMockSelection();
        selection.getSelectedNodes = () => [];
        let pickCalled = false;
        const picker = createMockPicker({ pickNodeResult: [{ id: "n2" } as never] });
        picker.pickNode = () => {
            pickCalled = true;
            return Promise.resolve([{ id: "n2" } as never]);
        };
        const doc = new TestDocument({
            picker,
            selection,
            application: { activeView: {} as IView } as never,
        });
        const controller = new AsyncController();

        const step = new GetOrSelectNodeStep(tip() as never);
        await step.execute(doc, controller);

        expect(pickCalled).toBe(true);
        controller.dispose();
    });

    test("should call pickNode when nodeFilter rejects selected node", async () => {
        const mockNode = { id: "n1" } as never;
        const selection = createMockSelection();
        selection.getSelectedNodes = () => [mockNode];
        let pickCalled = false;
        const picker = createMockPicker({ pickNodeResult: [{ id: "n2" } as never] });
        picker.pickNode = () => {
            pickCalled = true;
            return Promise.resolve([{ id: "n2" } as never]);
        };
        const doc = new TestDocument({
            picker,
            selection,
            application: { activeView: {} as IView } as never,
        });
        const controller = new AsyncController();

        const step = new GetOrSelectNodeStep(tip() as never, { filter: { allow: () => false } });
        await step.execute(doc, controller);

        expect(pickCalled).toBe(true);
        controller.dispose();
    });

    test("GetOrSelectNodeStep should keep selected node when filter passes", async () => {
        const mockNode = { id: "n1" } as never;
        const selection = createMockSelection();
        selection.getSelectedNodes = () => [mockNode];
        let pickCalled = false;
        const picker = createMockPicker();
        picker.pickNode = () => {
            pickCalled = true;
            return Promise.resolve([]);
        };
        const doc = new TestDocument({
            picker,
            selection,
            application: { activeView: {} as IView } as never,
        });
        const controller = new AsyncController();

        const step = new GetOrSelectNodeStep(tip() as never, { filter: { allow: () => true } });
        const result = await step.execute(doc, controller);

        expect(result).toBeDefined();
        expect(pickCalled).toBe(false);
        controller.dispose();
    });
});
