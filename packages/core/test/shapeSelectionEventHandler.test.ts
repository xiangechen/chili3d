// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { INodeFilter, INodeVisual, ISelection, IShapeFilter, ShapeType, VisualShapeData } from "../src";
import { AsyncController, Matrix4, ShapeTypes, SubshapeSelectionHandler, VisualStates } from "../src";
import {
    createMockHighlighter,
    createMockSelection,
    createMockVisual,
    createPointerEvent,
    MockShape,
    TestDocument,
} from "./mocks";

function createMockNodeVisual(overrides?: Partial<INodeVisual>): INodeVisual {
    return {
        locked: false,
        visible: true,
        transform: Matrix4.identity(),
        worldTransform: () => Matrix4.identity(),
        boundingBox: () => undefined,
        dispose: () => {},
        get node() {
            return {} as any;
        },
        ...overrides,
    };
}

function createVisualShapeData(overrides?: Partial<VisualShapeData>): VisualShapeData {
    return {
        shape: new MockShape(),
        owner: createMockNodeVisual(),
        transform: Matrix4.identity(),
        indexes: [0],
        ...overrides,
    };
}

interface SetupOptions {
    multiMode?: boolean;
    controller?: AsyncController;
    shapeType?: ShapeType;
    shapeFilter?: IShapeFilter;
    nodeFilter?: INodeFilter;
}

function setupSubshapeSelectionHandler(options: SetupOptions = {}) {
    const document = new TestDocument();

    const { highlighter, addCalls, removeCalls } = createMockHighlighter();
    const visual = createMockVisual({
        document,
        highlighter,
    });
    const context = visual.context;
    document.visual = visual;

    const selection: ISelection = createMockSelection();
    document.selection = selection;

    const handler = new SubshapeSelectionHandler(
        document,
        options.shapeType ?? ShapeTypes.face,
        options.multiMode ?? false,
        options.controller,
        options.shapeFilter,
        options.nodeFilter,
    );

    const view = {
        document,
        detectShapes: () => [] as VisualShapeData[],
        detectShapesRect: () => [] as VisualShapeData[],
        update: () => {},
    } as any;

    return { handler, document, view, highlighter, addCalls, removeCalls, selection, context };
}

describe("SubshapeSelectionHandler", () => {
    describe("constructor", () => {
        test("should initialize with defaults", () => {
            const { handler } = setupSubshapeSelectionHandler();
            expect(handler.isEnabled).toBe(true);
            expect(handler.highlightState).toBe(VisualStates.edgeHighlight);
        });

        test("should initialize with custom shapeType", () => {
            const { handler } = setupSubshapeSelectionHandler({ shapeType: ShapeTypes.edge });
            expect(handler.shapeType).toBe(ShapeTypes.edge);
        });

        test("should store shapeFilter and nodeFilter", () => {
            const shapeFilter: IShapeFilter = { allow: () => true };
            const nodeFilter: INodeFilter = { allow: () => true };

            const { handler } = setupSubshapeSelectionHandler({ shapeFilter, nodeFilter });

            expect(handler.shapefilter).toBe(shapeFilter);
            expect(handler.nodeFilter).toBe(nodeFilter);
        });

        test("should register cancellation callback on controller", () => {
            let cancelCount = 0;
            const controller = new AsyncController();
            controller.onCancelled(() => cancelCount++);

            setupSubshapeSelectionHandler({ controller });
            controller.cancel();
            expect(cancelCount).toBe(1);
        });

        test("should clear selection on controller cancel", () => {
            const controller = new AsyncController();
            const { selection } = setupSubshapeSelectionHandler({ controller });

            let cleared = false;
            selection.clearSelection = () => {
                cleared = true;
            };

            controller.cancel();
            expect(cleared).toBe(true);
        });
    });

    describe("selectedState", () => {
        test("should default to edgeSelected", () => {
            const { handler } = setupSubshapeSelectionHandler();
            expect(handler.selectedState).toBe(VisualStates.edgeSelected);
        });
    });

    describe("select", () => {
        test("should return 0 when no highlights", () => {
            const { handler, view } = setupSubshapeSelectionHandler();

            const event = createPointerEvent();
            const count = (handler as any).select(view, event);

            expect(count).toBe(0);
        });

        test("should set selected shapes when highlights exist", () => {
            const { handler, view, selection } = setupSubshapeSelectionHandler();

            const shapeData1 = createVisualShapeData();
            const shapeData2 = createVisualShapeData();

            (handler as any)._highlights = [shapeData1, shapeData2];

            let selectedShapes: VisualShapeData[] | undefined;
            let selectedState: number | undefined;
            let toggleArg: boolean | undefined;

            selection.setSelectedShapes = (shapes, state, toggle) => {
                selectedShapes = shapes;
                selectedState = state;
                toggleArg = toggle;
                return shapes.length;
            };

            const event = createPointerEvent();
            const count = (handler as any).select(view, event);

            expect(count).toBe(2);
            expect(selectedShapes).toEqual([shapeData1, shapeData2]);
            expect(selectedState).toBe(VisualStates.edgeSelected);
            expect(toggleArg).toBe(false); // multiMode is false
        });

        test("should pass multiMode as toggle flag", () => {
            const { handler, view, selection } = setupSubshapeSelectionHandler({ multiMode: true });

            const shapeData = createVisualShapeData();
            (handler as any)._highlights = [shapeData];

            let toggleArg: boolean | undefined;
            selection.setSelectedShapes = (_shapes, _state, toggle) => {
                toggleArg = toggle;
                return 1;
            };

            const event = createPointerEvent();
            (handler as any).select(view, event);

            expect(toggleArg).toBe(true);
        });
    });

    describe("highlightDetecteds", () => {
        test("should add highlight state for each detected shape", () => {
            const { handler, view, addCalls } = setupSubshapeSelectionHandler();

            const shapeData1 = createVisualShapeData({ indexes: [0, 1] });
            const shapeData2 = createVisualShapeData({ indexes: [2] });

            (handler as any).highlightDetecteds(view, [shapeData1, shapeData2]);

            expect(addCalls).toHaveLength(2);

            expect(addCalls[0].shape).toBe(shapeData1.owner);
            expect(addCalls[0].state).toBe(VisualStates.edgeHighlight);
            expect(addCalls[0].type).toBe(shapeData1.shape.shapeType);
            expect(addCalls[0].indexes).toEqual([0, 1]);

            expect(addCalls[1].shape).toBe(shapeData2.owner);
            expect(addCalls[1].indexes).toEqual([2]);

            // Should store highlights
            expect((handler as any)._highlights).toEqual([shapeData1, shapeData2]);
        });

        test("should clean previous highlights before adding new ones", () => {
            const { handler, view, addCalls, removeCalls } = setupSubshapeSelectionHandler();

            const oldShape = createVisualShapeData();
            (handler as any)._highlights = [oldShape];

            const newShape = createVisualShapeData();
            (handler as any).highlightDetecteds(view, [newShape]);

            // Old highlight should be removed
            expect(removeCalls).toHaveLength(1);
            expect(removeCalls[0].shape).toBe(oldShape.owner);

            // New highlight should be added
            expect(addCalls).toHaveLength(1);
            expect(addCalls[0].shape).toBe(newShape.owner);
        });

        test("should call view.update() after highlighting", () => {
            const { handler, view } = setupSubshapeSelectionHandler();

            let updateCalled = false;
            view.update = () => {
                updateCalled = true;
            };

            (handler as any).highlightDetecteds(view, [createVisualShapeData()]);
            expect(updateCalled).toBe(true);
        });
    });

    describe("cleanHighlights", () => {
        test("should remove highlight state from all highlighted shapes", () => {
            const { handler, removeCalls } = setupSubshapeSelectionHandler();

            const shapeData1 = createVisualShapeData({ indexes: [0] });
            const shapeData2 = createVisualShapeData({ indexes: [1, 2] });

            (handler as any)._highlights = [shapeData1, shapeData2];
            (handler as any).cleanHighlights();

            expect(removeCalls).toHaveLength(2);
            expect(removeCalls[0].shape).toBe(shapeData1.owner);
            expect(removeCalls[1].shape).toBe(shapeData2.owner);
            expect(removeCalls[0].indexes).toEqual([0]);
            expect(removeCalls[1].indexes).toEqual([1, 2]);

            // Should clear highlights
            expect((handler as any)._highlights).toBeUndefined();
        });

        test("should be a no-op when no highlights", () => {
            const { handler, removeCalls } = setupSubshapeSelectionHandler();
            (handler as any)._highlights = undefined;

            (handler as any).cleanHighlights();
            expect(removeCalls).toHaveLength(0);
        });
    });

    describe("pointerMove", () => {
        test("should highlight shapes under mouse", () => {
            const { handler, view, addCalls } = setupSubshapeSelectionHandler();

            const shapeData = createVisualShapeData({ indexes: [0] });
            view.detectShapes = () => [shapeData];

            const event = createPointerEvent({ buttons: 0, offsetX: 100, offsetY: 200 });
            handler.pointerMove(view, event);

            expect(addCalls).toHaveLength(1);
            expect(addCalls[0].shape).toBe(shapeData.owner);
            expect(addCalls[0].indexes).toEqual([0]);
        });

        test("should reset lock detected", () => {
            const { handler, view } = setupSubshapeSelectionHandler();

            // Set internal lock state
            (handler as any)._lockDetected = new MockShape();

            const event = createPointerEvent({ buttons: 0 });
            handler.pointerMove(view, event);

            expect((handler as any)._lockDetected).toBeUndefined();
        });

        test("should skip when middle mouse button pressed", () => {
            const { handler, view, addCalls } = setupSubshapeSelectionHandler();

            view.detectShapes = () => [createVisualShapeData()];

            const event = createPointerEvent({ buttons: 4 }); // MOUSE_MIDDLE = 4
            handler.pointerMove(view, event);

            expect(addCalls).toHaveLength(0);
        });

        test("should use shape type in detection", () => {
            const { handler, view } = setupSubshapeSelectionHandler({ shapeType: ShapeTypes.edge });

            let detectedType: number | undefined;
            view.detectShapes = (type: number) => {
                detectedType = type;
                return [];
            };

            handler.pointerMove(view, createPointerEvent());
            expect(detectedType).toBe(ShapeTypes.edge);
        });

        test("should pass filters to point detection", () => {
            const shapeFilter: IShapeFilter = { allow: () => true };
            const nodeFilter: INodeFilter = { allow: () => true };

            const { handler, view } = setupSubshapeSelectionHandler({ shapeFilter, nodeFilter });

            let passedShapeFilter: IShapeFilter | undefined;
            let passedNodeFilter: INodeFilter | undefined;
            view.detectShapes = (
                _type: number,
                _x: number,
                _y: number,
                sf?: IShapeFilter,
                nf?: INodeFilter,
            ) => {
                passedShapeFilter = sf;
                passedNodeFilter = nf;
                return [];
            };

            handler.pointerMove(view, createPointerEvent());
            expect(passedShapeFilter).toBe(shapeFilter);
            expect(passedNodeFilter).toBe(nodeFilter);
        });
    });

    describe("highlightNext (Tab cycling)", () => {
        test("should cycle through detected shapes on Tab", () => {
            const { handler, view, addCalls } = setupSubshapeSelectionHandler();

            const shape1 = createVisualShapeData();
            const shape2 = createVisualShapeData();
            const shape3 = createVisualShapeData();

            // Set detected shapes at mouse position
            (handler as any)._detectAtMouse = [shape1, shape2, shape3];

            // First highlightNext: start at index 1
            addCalls.length = 0;
            (handler as any).highlightNext(view);
            expect(addCalls).toHaveLength(1);
            expect(addCalls[0].shape).toBe(shape2.owner);

            // Second: index 2
            addCalls.length = 0;
            (handler as any).highlightNext(view);
            expect(addCalls[0].shape).toBe(shape3.owner);

            // Third: wrap to index 0
            addCalls.length = 0;
            (handler as any).highlightNext(view);
            expect(addCalls[0].shape).toBe(shape1.owner);
        });

        test("should not cycle when only one detected shape", () => {
            const { handler, view, addCalls } = setupSubshapeSelectionHandler();

            (handler as any)._detectAtMouse = [createVisualShapeData()];

            addCalls.length = 0;
            (handler as any).highlightNext(view);
            expect(addCalls).toHaveLength(0);
        });
    });

    describe("pointerDown", () => {
        test("should set mouse state on primary left button", () => {
            const { handler, view } = setupSubshapeSelectionHandler();

            const event = createPointerEvent({ offsetX: 30, offsetY: 60 });
            handler.pointerDown(view, event);

            expect((handler as any).mouse.isDown).toBe(true);
            expect((handler as any).mouse.x).toBe(30);
            expect((handler as any).mouse.y).toBe(60);
        });

        test("should create selection rect in multiMode", () => {
            const { handler, view } = setupSubshapeSelectionHandler({ multiMode: true });

            const event = createPointerEvent({ clientX: 200, clientY: 300 });
            handler.pointerDown(view, event);

            expect((handler as any).rect).toBeDefined();
            expect((handler as any).rect.clientX).toBe(200);
            expect((handler as any).rect.clientY).toBe(300);
        });
    });

    describe("pointerUp", () => {
        test("should complete selection on primary button release", () => {
            const { handler, view, selection } = setupSubshapeSelectionHandler();

            const shapeData = createVisualShapeData();
            view.detectShapes = () => [shapeData];

            let selectedShapes: VisualShapeData[] = [];
            selection.setSelectedShapes = (shapes) => {
                selectedShapes = shapes;
                return shapes.length;
            };

            // Simulate full click-move-release cycle
            handler.pointerDown(view, createPointerEvent({ pointerId: 1 }));
            handler.pointerMove(view, createPointerEvent({ pointerId: 1, buttons: 1 }));
            handler.pointerUp(view, createPointerEvent({ pointerId: 1 }));

            expect(selectedShapes).toHaveLength(1);
            expect((handler as any).mouse.isDown).toBe(false);
        });

        test("should remove rect on pointer up", () => {
            const { handler, view } = setupSubshapeSelectionHandler({ multiMode: true });

            handler.pointerDown(view, createPointerEvent({ clientX: 100, clientY: 100 }));
            expect((handler as any).rect).toBeDefined();

            handler.pointerUp(view, createPointerEvent({ pointerId: 1 }));
            expect((handler as any).rect).toBeUndefined();
        });

        test("should call controller.success when selection made in non-multi mode", () => {
            const controller = new AsyncController();
            let successCalled = false;
            controller.onCompleted(() => {
                successCalled = true;
            });

            const { handler, view, selection } = setupSubshapeSelectionHandler({ controller });

            const shapeData = createVisualShapeData();
            view.detectShapes = () => [shapeData];
            selection.setSelectedShapes = () => 1; // Return >0 to trigger success

            handler.pointerDown(view, createPointerEvent({ pointerId: 1 }));
            handler.pointerMove(view, createPointerEvent({ pointerId: 1, buttons: 1 }));
            handler.pointerUp(view, createPointerEvent({ pointerId: 1 }));

            expect(successCalled).toBe(true);
        });
    });

    describe("pointerOut", () => {
        test("should clean highlights and reset mouse state on primary pointer out", () => {
            const { handler, view, removeCalls } = setupSubshapeSelectionHandler();

            const shapeData = createVisualShapeData();
            (handler as any)._highlights = [shapeData];
            (handler as any).mouse.isDown = true;

            handler.pointerOut!(view, createPointerEvent({ isPrimary: true, pointerId: 1 }));

            expect((handler as any).mouse.isDown).toBe(false);
            expect(removeCalls).toHaveLength(1);
        });
    });

    describe("keyDown", () => {
        test("should cancel on Escape via controller", () => {
            const controller = new AsyncController();
            let cancelled = false;
            controller.onCancelled(() => {
                cancelled = true;
            });

            const { handler, view } = setupSubshapeSelectionHandler({ controller });

            handler.keyDown(view, { key: "Escape", preventDefault: () => {} } as KeyboardEvent);
            expect(cancelled).toBe(true);
        });

        test("should clear selection on Escape without controller", () => {
            const { handler, view, selection } = setupSubshapeSelectionHandler();

            let cleared = false;
            selection.clearSelection = () => {
                cleared = true;
            };

            handler.keyDown(view, { key: "Escape", preventDefault: () => {} } as KeyboardEvent);
            expect(cleared).toBe(true);
        });

        test("should cycle highlight on Tab", () => {
            const { handler, view, addCalls } = setupSubshapeSelectionHandler();

            const shape1 = createVisualShapeData();
            const shape2 = createVisualShapeData();
            (handler as any)._detectAtMouse = [shape1, shape2];

            addCalls.length = 0;
            handler.keyDown(view, { key: "Tab", preventDefault: () => {} } as KeyboardEvent);

            expect(addCalls).toHaveLength(1);
            expect(addCalls[0].shape).toBe(shape2.owner);
        });

        test("should complete on Enter and call controller.success", () => {
            const controller = new AsyncController();
            let completed = false;
            controller.onCompleted(() => {
                completed = true;
            });

            const { handler, view } = setupSubshapeSelectionHandler({ controller });

            handler.keyDown(view, {
                key: "Enter",
                preventDefault: () => {},
                stopImmediatePropagation: () => {},
            } as KeyboardEvent);

            expect(completed).toBe(true);
        });
    });

    describe("dispose", () => {
        test("should only dispose once", () => {
            const { handler } = setupSubshapeSelectionHandler();
            handler.dispose();
            handler.dispose(); // second call should not throw
        });
    });

    describe("integration: rectangle selection", () => {
        test("should use rect detection when mouse is dragged", () => {
            const { handler, view, addCalls } = setupSubshapeSelectionHandler({ multiMode: true });

            const shapeData = createVisualShapeData();
            view.detectShapesRect = () => [shapeData];

            // pointerDown at (100, 100)
            handler.pointerDown(
                view,
                createPointerEvent({ pointerId: 1, offsetX: 100, offsetY: 100, clientX: 150, clientY: 150 }),
            );

            // pointerMove far away — should trigger rect detection (>3px threshold)
            handler.pointerMove(
                view,
                createPointerEvent({
                    pointerId: 1,
                    offsetX: 200,
                    offsetY: 200,
                    clientX: 250,
                    clientY: 250,
                    buttons: 1,
                }),
            );

            expect(addCalls).toHaveLength(1);
            expect(addCalls[0].shape).toBe(shapeData.owner);
        });
    });

    describe("integration: complete subshape selection flow", () => {
        test("should select a subshape (face) from click to release", () => {
            const { handler, view, selection } = setupSubshapeSelectionHandler({
                shapeType: ShapeTypes.face,
            });

            const shapeData = createVisualShapeData({ indexes: [0] });
            view.detectShapes = () => [shapeData];

            let selectedShapes: VisualShapeData[] = [];
            let passedState: number | undefined;
            selection.setSelectedShapes = (shapes, state) => {
                selectedShapes = shapes;
                passedState = state;
                return shapes.length;
            };

            // Full interaction
            handler.pointerDown(view, createPointerEvent({ pointerId: 1, offsetX: 50, offsetY: 50 }));
            handler.pointerMove(
                view,
                createPointerEvent({ pointerId: 1, offsetX: 50, offsetY: 50, buttons: 1 }),
            );
            handler.pointerUp(view, createPointerEvent({ pointerId: 1 }));

            expect(selectedShapes).toHaveLength(1);
            expect(selectedShapes[0]).toBe(shapeData);
            expect(passedState).toBe(VisualStates.edgeSelected);
        });
    });
});
