// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    type IView,
    Matrix4,
    Plane,
    PubSub,
    Ray,
    type ShapeMeshData,
    ShapeTypes,
    VisualStates,
    XY,
    XYZ,
} from "@chili3d/core";
import {
    createHandlerMockView,
    createMockHighlighter,
    createMockSelection,
    createMockVisualWithDocument,
    createPointerEvent,
    TestDocument,
} from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import {
    type ExtrudeDragData,
    ExtrudeDragHandler,
    ExtrudeDragStep,
} from "../../src/commands/extrudeDragStep";
import { ParametricBodyNode } from "../../src/parametricBodyNode";
import { SketchNode } from "../../src/sketch/sketchNode";

const fakeMesh = (): ShapeMeshData => ({ position: new Float32Array(), range: [] });

function faceData(node: unknown, indexes = [0], point?: XYZ, owner?: unknown) {
    return { shape: { shapeType: ShapeTypes.face }, owner: owner ?? { node }, indexes, point } as any;
}

describe("ExtrudeDragHandler", () => {
    let doc: TestDocument;
    let sketch: SketchNode;
    let other: SketchNode;
    let controller: AsyncController;

    const newSketch = (doc: TestDocument, plane: Plane) =>
        new SketchNode({ document: doc, plane, data: { entities: [], constraints: [] } });

    beforeEach(() => {
        doc = new TestDocument();
        doc.visual = createMockVisualWithDocument(doc);
        sketch = newSketch(doc, Plane.XY);
        other = newSketch(doc, new Plane({ origin: XYZ.zero, normal: XYZ.unitX, xvec: XYZ.unitY }));
        controller = new AsyncController();
    });

    afterEach(() => {
        controller.dispose();
    });

    function dragData(faces: any[] = []): ExtrudeDragData {
        return {
            node: sketch,
            faces,
            origin: XYZ.zero,
            normal: XYZ.unitZ,
            anchor: new XYZ({ x: 1, y: 1, z: 0 }),
            buildPreview: rs.fn((_state: any) => [fakeMesh()]),
            meshArrow: rs.fn((_state: any) => [fakeMesh()]),
        };
    }

    function dragView(): IView {
        // The ray through screen x projects to z = mx - 113 on the Z axis.
        return createHandlerMockView({
            document: doc,
            rayAt: (mx: number) =>
                new Ray({ point: new XYZ({ x: 0, y: 0, z: mx - 113 }), direction: XYZ.unitX }),
        });
    }

    test("dragging starts without a jump and commits the projected distance on release", () => {
        const data = dragData();
        const handler = new ExtrudeDragHandler(doc, controller, data);
        const view = dragView();

        handler.pointerDown(view, createPointerEvent({ offsetX: 100, offsetY: 200 }));
        // crossing the drag threshold grabs the current projection: no jump
        handler.pointerMove(view, createPointerEvent({ offsetX: 113, offsetY: 200 }));
        expect(handler.state.dist).toBeCloseTo(0);
        handler.pointerMove(view, createPointerEvent({ offsetX: 120, offsetY: 200 }));
        handler.pointerUp(view, createPointerEvent({ offsetX: 120, offsetY: 200 }));

        expect(controller.result?.status).toBe("success");
        expect(handler.state.dist).toBeCloseTo(7);
        expect(data.buildPreview).toHaveBeenCalled();
    });

    test("a press-release without moving does not commit", () => {
        const handler = new ExtrudeDragHandler(doc, controller, dragData());
        const view = dragView();

        handler.pointerDown(view, createPointerEvent({ offsetX: 100, offsetY: 200 }));
        handler.pointerUp(view, createPointerEvent({ offsetX: 100, offsetY: 200 }));

        expect(controller.result).toBeUndefined();
    });

    // The arrow shaft spans screen (401,300)-(401,220); a ray through (x,y) projects to z = 300-y.
    function twoClickView(): IView {
        return createHandlerMockView({
            document: doc,
            worldToScreen: (p: XYZ) => new XY({ x: p.x + 400, y: 300 - p.z }),
            rayAt: (_mx: number, my: number) =>
                new Ray({ point: new XYZ({ x: 0, y: 0, z: 300 - my }), direction: XYZ.unitX }),
        });
    }

    function clickArrow(handler: ExtrudeDragHandler, view: IView, offsetY = 260) {
        handler.pointerDown(view, createPointerEvent({ offsetX: 401, offsetY }));
        handler.pointerUp(view, createPointerEvent({ offsetX: 401, offsetY }));
    }

    test("clicking the arrow starts click-move mode and the second click commits", () => {
        const handler = new ExtrudeDragHandler(doc, controller, dragData());
        const view = twoClickView();

        handler.pointerMove(view, createPointerEvent({ offsetX: 401, offsetY: 260 }));
        clickArrow(handler, view);
        expect(controller.result).toBeUndefined(); // the first click only arms the gesture

        handler.pointerMove(view, createPointerEvent({ offsetX: 401, offsetY: 240 }));
        expect(handler.state.dist).toBeCloseTo(20); // (300-240) - (300-260), no jump on entry

        clickArrow(handler, view, 240);
        expect(controller.result?.status).toBe("success");
        expect(handler.state.dist).toBeCloseTo(20);
    });

    test("Escape leaves click-move mode before cancelling", () => {
        const handler = new ExtrudeDragHandler(doc, controller, dragData());
        const view = twoClickView();
        const escapeKey = { key: "Escape", preventDefault: () => {}, stopImmediatePropagation: () => {} };

        handler.pointerMove(view, createPointerEvent({ offsetX: 401, offsetY: 260 }));
        clickArrow(handler, view);
        handler.pointerMove(view, createPointerEvent({ offsetX: 401, offsetY: 240 }));
        expect(handler.state.dist).toBeCloseTo(20);

        handler.keyDown(view, escapeKey as KeyboardEvent);
        expect(controller.result).toBeUndefined();
        expect(handler.state.dist).toBe(0);
        // back to idle: moving hovers instead of changing the depth
        handler.pointerMove(view, createPointerEvent({ offsetX: 401, offsetY: 100 }));
        expect(handler.state.dist).toBe(0);

        handler.keyDown(view, escapeKey as KeyboardEvent);
        expect(controller.result?.status).toBe("cancel");
    });

    test("a second click at zero depth only leaves click-move mode", () => {
        const handler = new ExtrudeDragHandler(doc, controller, dragData());
        const view = twoClickView();

        handler.pointerMove(view, createPointerEvent({ offsetX: 401, offsetY: 260 }));
        clickArrow(handler, view);
        clickArrow(handler, view);

        expect(controller.result).toBeUndefined();
        // back to idle: hovering the arrow toggles its highlight again
        handler.pointerMove(view, createPointerEvent({ offsetX: 500, offsetY: 260 }));
        expect(handler.state.arrowHovered).toBe(false);
        handler.pointerMove(view, createPointerEvent({ offsetX: 401, offsetY: 260 }));
        expect(handler.state.arrowHovered).toBe(true);
    });

    test("clicking another sketch's profile face switches the extrude target", () => {
        const setSelectedShapes = rs.fn((_shapes: any, _state: any, _toggle: any) => 0);
        doc.selection = { ...createMockSelection(), setSelectedShapes } as any;
        const face = faceData(other, [3], new XYZ({ x: 0, y: 2, z: 2 }));
        const view = createHandlerMockView({ document: doc, detectShapes: () => [face] });

        const handler = new ExtrudeDragHandler(doc, controller, dragData());
        handler.pointerDown(view, createPointerEvent());
        handler.pointerUp(view, createPointerEvent());

        expect(controller.result).toBeUndefined();
        expect(handler.state.node).toBe(other);
        expect(handler.state.faces).toEqual([face]);
        expect(handler.state.normal.isEqualTo(XYZ.unitX)).toBe(true);
        expect(handler.state.anchor.isEqualTo(new XYZ({ x: 0, y: 2, z: 2 }))).toBe(true);
        expect(handler.state.dist).toBe(0);
        expect(setSelectedShapes).toHaveBeenCalledWith([face], VisualStates.faceSelected, false);
    });

    test("clicking a planar face of a parametric body switches the extrude target", () => {
        const setSelectedShapes = rs.fn((_shapes: any, _state: any, _toggle: any) => 0);
        doc.selection = { ...createMockSelection(), setSelectedShapes } as any;
        const body = new ParametricBodyNode({ document: doc, features: [] });
        const worldFace = {
            shapeType: ShapeTypes.face,
            normal: () => [new XYZ({ x: 0, y: 5, z: 0 }), XYZ.unitY],
            dispose: () => {},
        };
        const face = {
            shape: {
                shapeType: ShapeTypes.face,
                surface: () => ({ isPlanar: () => true }),
                transformedMul: () => worldFace,
            },
            owner: { node: body },
            transform: Matrix4.identity(),
            indexes: [1],
            point: new XYZ({ x: 1, y: 5, z: 2 }),
        } as any;
        const view = createHandlerMockView({ document: doc, detectShapes: () => [face] });

        const handler = new ExtrudeDragHandler(doc, controller, dragData());
        handler.pointerDown(view, createPointerEvent());
        handler.pointerUp(view, createPointerEvent());

        expect(handler.state.node).toBe(body);
        expect(handler.state.faces).toEqual([face]);
        expect(handler.state.normal.isEqualTo(XYZ.unitY)).toBe(true);
        expect(handler.state.origin.isEqualTo(new XYZ({ x: 0, y: 5, z: 0 }))).toBe(true);
        expect(handler.state.anchor.isEqualTo(new XYZ({ x: 1, y: 5, z: 2 }))).toBe(true);
        expect(setSelectedShapes).toHaveBeenCalledWith([face], VisualStates.faceSelected, false);
    });

    test("clicking a non-planar face of a parametric body does nothing", () => {
        const body = new ParametricBodyNode({ document: doc, features: [] });
        const curved = faceData(body, [0]);
        curved.shape.surface = () => ({ isPlanar: () => false });
        const view = createHandlerMockView({ document: doc, detectShapes: () => [curved] });

        const handler = new ExtrudeDragHandler(doc, controller, dragData());
        handler.pointerDown(view, createPointerEvent());
        handler.pointerUp(view, createPointerEvent());

        expect(handler.state.node).toBe(sketch);
        expect(handler.state.faces).toEqual([]);
    });

    test("shift-click toggles faces of the current sketch and keeps at least one", () => {
        doc.selection = createMockSelection();
        const anchorA = new XYZ({ x: 1, y: 0, z: 0 });
        const anchorB = new XYZ({ x: 2, y: 0, z: 0 });
        const faceA = faceData(sketch, [0], anchorA);
        const faceB = faceData(sketch, [1], anchorB);
        // Re-detection on the remove click yields a new object with a slightly different point,
        // but the same owner visual (as in the real viewport).
        const faceBReclicked = faceData(sketch, [1], new XYZ({ x: 2.3, y: 0.2, z: 0 }), faceB.owner);
        const handler = new ExtrudeDragHandler(doc, controller, dragData([faceA]));
        handler.state.anchor = anchorA;
        const viewB = createHandlerMockView({ document: doc, detectShapes: () => [faceB] });
        const viewB2 = createHandlerMockView({ document: doc, detectShapes: () => [faceBReclicked] });
        const viewA = createHandlerMockView({ document: doc, detectShapes: () => [faceA] });
        const down = createPointerEvent({ shiftKey: true });
        const up = createPointerEvent({ shiftKey: true });

        handler.pointerDown(viewB, down);
        handler.pointerUp(viewB, up);
        expect(handler.state.faces).toEqual([faceA, faceB]);
        // adding a profile moves the arrow to the clicked face
        expect(handler.state.anchor).toBe(anchorB);

        handler.pointerDown(viewB2, down);
        handler.pointerUp(viewB2, up);
        expect(handler.state.faces).toEqual([faceA]);
        // removing the profile the arrow is on restores the previous position
        expect(handler.state.anchor).toBe(anchorA);

        handler.pointerDown(viewA, down);
        handler.pointerUp(viewA, up);
        expect(handler.state.faces).toEqual([faceA]);
    });

    test("shift-removing a profile the arrow is not on keeps the anchor", () => {
        doc.selection = createMockSelection();
        const anchorA = new XYZ({ x: 1, y: 0, z: 0 });
        const anchorB = new XYZ({ x: 2, y: 0, z: 0 });
        const faceA = faceData(sketch, [0], anchorA);
        const faceB = faceData(sketch, [1], anchorB);
        const handler = new ExtrudeDragHandler(doc, controller, dragData([faceA, faceB]));
        handler.state.anchor = anchorA;
        const viewB = createHandlerMockView({ document: doc, detectShapes: () => [faceB] });
        const down = createPointerEvent({ shiftKey: true });
        const up = createPointerEvent({ shiftKey: true });

        handler.pointerDown(viewB, down);
        handler.pointerUp(viewB, up);
        expect(handler.state.faces).toEqual([faceA]);
        expect(handler.state.anchor).toBe(anchorA);
    });

    test("hovering a sketch profile face highlights it", () => {
        const { highlighter, addCalls, removeCalls } = createMockHighlighter();
        doc.visual = createMockVisualWithDocument(doc, { highlighter });
        const face = faceData(sketch, [2]);
        const handler = new ExtrudeDragHandler(doc, controller, dragData());

        const over = createHandlerMockView({ document: doc, detectShapes: () => [face] });
        handler.pointerMove(over, createPointerEvent());
        expect(addCalls).toEqual([
            { shape: face.owner, state: VisualStates.faceHighlight, type: ShapeTypes.face, indexes: [2] },
        ]);

        const away = createHandlerMockView({ document: doc, detectShapes: () => [] });
        handler.pointerMove(away, createPointerEvent());
        expect(removeCalls).toEqual([
            { shape: face.owner, state: VisualStates.faceHighlight, type: ShapeTypes.face, indexes: [2] },
        ]);
    });

    test("numeric input commits the exact value and rejects non-numbers", () => {
        const handler = new ExtrudeDragHandler(doc, controller, dragData());
        const view = dragView();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            handler.keyDown(view, { key: "2" } as KeyboardEvent);
            const callback = pub.mock.calls.find((x) => x[0] === "showInput")?.[2] as (text: string) => any;
            expect(callback).toBeDefined();

            const error = callback("abc");
            expect(error.isOk).toBe(false);
            expect(controller.result).toBeUndefined();

            const ok = callback("25");
            expect(ok.isOk).toBe(true);
            expect(controller.result?.status).toBe("success");
            expect(handler.state.dist).toBe(25);
        } finally {
            pub.mockRestore();
        }
    });

    test("hovering the arrow toggles its highlight", () => {
        const handler = new ExtrudeDragHandler(doc, controller, dragData());
        const view = createHandlerMockView({
            document: doc,
            worldToScreen: (p: XYZ) => new XY({ x: p.x + 400, y: 300 - p.z }),
        });

        handler.pointerMove(view, createPointerEvent({ offsetX: 405, offsetY: 280 }));
        expect(handler.state.arrowHovered).toBe(true);
        // the mock view maps 1 world unit to 1 px, so 80 px needs 80 world units
        expect(handler.state.arrowLength).toBeCloseTo(80);

        handler.pointerMove(view, createPointerEvent({ offsetX: 500, offsetY: 280 }));
        expect(handler.state.arrowHovered).toBe(false);
    });

    test("camera changes rescale the arrow after zoom", () => {
        const data = dragData();
        const handler = new ExtrudeDragHandler(doc, controller, data);

        let cameraChanged: (() => void) | undefined;
        let pxPerUnit = 1;
        const view = createHandlerMockView({
            document: doc,
            cameraController: {
                onPropertyChanged: (callback: () => void) => {
                    cameraChanged = callback;
                },
                removePropertyChanged: () => {},
            } as any,
            worldToScreen: (p: XYZ) => new XY({ x: p.x * pxPerUnit + 400, y: p.y * pxPerUnit + 300 }),
        });

        handler.pointerMove(view, createPointerEvent());
        expect(handler.state.arrowLength).toBeCloseTo(80);

        pxPerUnit = 0.5; // zoomed out: one world unit now covers half a pixel
        cameraChanged!();
        expect(handler.state.arrowLength).toBeCloseTo(160);
    });

    test("Escape cancels the step", () => {
        const handler = new ExtrudeDragHandler(doc, controller, dragData());
        handler.keyDown(dragView(), { key: "Escape" } as KeyboardEvent);
        expect(controller.result?.status).toBe("cancel");
    });
});

describe("ExtrudeDragStep", () => {
    test("returns the dragged point with the final face set", async () => {
        const doc = new TestDocument();
        doc.visual = createMockVisualWithDocument(doc);
        const sketch = new SketchNode({
            document: doc,
            plane: Plane.XY,
            data: { entities: [], constraints: [] },
        });
        const face = faceData(sketch, [0]);

        let captured: ExtrudeDragHandler | undefined;
        doc.picker = {
            pickAsync: rs.fn((handler: ExtrudeDragHandler, _prompt: any, controller: AsyncController) => {
                captured = handler;
                return new Promise<void>((resolve) => {
                    controller.onCompleted(() => resolve());
                    controller.onCancelled(() => resolve());
                    controller.onFailed(() => resolve());
                });
            }),
        } as any;

        const step = new ExtrudeDragStep("prompt.dragToExtrude", () => ({
            node: sketch,
            faces: [face],
            origin: XYZ.zero,
            normal: XYZ.unitZ,
            anchor: XYZ.zero,
            buildPreview: () => [fakeMesh()],
            meshArrow: () => [fakeMesh()],
        }));

        const controller = new AsyncController();
        const promise = step.execute(doc, controller);
        const view = createHandlerMockView({
            document: doc,
            rayAt: (mx: number) =>
                new Ray({ point: new XYZ({ x: 0, y: 0, z: mx - 113 }), direction: XYZ.unitX }),
        });
        captured!.pointerDown(view, createPointerEvent({ offsetX: 100, offsetY: 200 }));
        captured!.pointerMove(view, createPointerEvent({ offsetX: 113, offsetY: 200 }));
        captured!.pointerMove(view, createPointerEvent({ offsetX: 120, offsetY: 200 }));
        captured!.pointerUp(view, createPointerEvent({ offsetX: 120, offsetY: 200 }));

        const result = await promise;
        expect(result).toBeDefined();
        expect(result!.point!.z).toBeCloseTo(7);
        expect(result!.distance).toBeCloseTo(7);
        expect(result!.nodes![0]).toBe(sketch);
        expect(result!.shapes).toEqual([face]);
        expect(result!.plane!.normal.isEqualTo(XYZ.unitZ)).toBe(true);
    });

    test("returns undefined when cancelled", async () => {
        const doc = new TestDocument();
        doc.visual = createMockVisualWithDocument(doc);
        const sketch = new SketchNode({
            document: doc,
            plane: Plane.XY,
            data: { entities: [], constraints: [] },
        });

        let captured: ExtrudeDragHandler | undefined;
        doc.picker = {
            pickAsync: rs.fn((handler: ExtrudeDragHandler, _prompt: any, controller: AsyncController) => {
                captured = handler;
                return new Promise<void>((resolve) => {
                    controller.onCompleted(() => resolve());
                    controller.onCancelled(() => resolve());
                    controller.onFailed(() => resolve());
                });
            }),
        } as any;

        const step = new ExtrudeDragStep("prompt.dragToExtrude", () => ({
            node: sketch,
            faces: [],
            origin: XYZ.zero,
            normal: XYZ.unitZ,
            anchor: XYZ.zero,
            buildPreview: () => [],
            meshArrow: () => [fakeMesh()],
        }));

        const controller = new AsyncController();
        const promise = step.execute(doc, controller);
        captured!.keyDown(createHandlerMockView({ document: doc }), { key: "Escape" } as KeyboardEvent);

        expect(await promise).toBeUndefined();
    });
});
