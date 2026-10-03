// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { AsyncController, type IView, Plane, PubSub, Ray, XYZ } from "@chili3d/core";
import {
    createHandlerMockView,
    createMockVisualWithDocument,
    createPointerEvent,
    setupShapeFactoryMock,
    TestDocument,
} from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { DATUM_PREVIEW_SIZE, datumQuad, datumQuadAt } from "../../src/sketch/commands/planePreview";
import {
    type OffsetDragData,
    SketchPlaneOffsetHandler,
    SketchPlaneOffsetStep,
} from "../../src/sketch/commands/sketchPlaneOffsetStep";
import { datumDisplayPlane, datumPlaneOf } from "../../src/sketch/planeRef";

/**
 * The arrow is meshed through `arrowMeshes`, which runs on the shape factory — absent
 * outside the wasm package. A shape that reports a mesh and disposes is all it needs.
 */
function stubArrowGeometry() {
    const shape = () => {
        const value = { mesh: { faces: { position: new Float32Array(), range: [] } }, dispose: () => {} };
        return { isOk: true, value };
    };
    setupShapeFactoryMock({ cylinder: shape, cone: shape });
}

describe("SketchPlaneOffsetHandler", () => {
    let doc: TestDocument;
    let controller: AsyncController;

    beforeEach(() => {
        doc = new TestDocument();
        doc.visual = createMockVisualWithDocument(doc);
        controller = new AsyncController();
        stubArrowGeometry();
    });

    afterEach(() => {
        controller.dispose();
    });

    function offsetData(basePlane = Plane.XY, offset = 0): OffsetDragData {
        return { basePlane, offset };
    }

    /** Enter/Space confirms, so the handler calls preventDefault on the way through. */
    function enterKey(): KeyboardEvent {
        return {
            key: "Enter",
            preventDefault: () => {},
            stopImmediatePropagation: () => {},
        } as unknown as KeyboardEvent;
    }

    /** The ray through screen x projects to z = mx − 113 on the Z axis. */
    function dragView(): IView {
        return createHandlerMockView({
            document: doc,
            rayAt: (mx: number) =>
                new Ray({ point: new XYZ({ x: 0, y: 0, z: mx - 113 }), direction: XYZ.unitX }),
        });
    }

    test("starts at the offset the command handed in", () => {
        const handler = new SketchPlaneOffsetHandler(doc, controller, offsetData(Plane.XY, 7));

        expect(handler.offset).toBe(7);
        expect(handler.plane.origin.z).toBe(7);
        handler.dispose();
    });

    test("the arrow base sits on the offset plane", () => {
        const handler = new SketchPlaneOffsetHandler(doc, controller, offsetData(Plane.XY, 5));

        const { start } = (handler as any).arrowSegment();

        expect(start.z).toBeCloseTo(5);
        handler.dispose();
    });

    test("a negative offset puts the plane below the base and flips the arrow", () => {
        const handler = new SketchPlaneOffsetHandler(doc, controller, offsetData(Plane.XY, -6));

        const { start, end } = (handler as any).arrowSegment();

        expect(handler.plane.origin.z).toBe(-6);
        expect(start.z).toBeCloseTo(-6);
        expect(end.z).toBeLessThan(start.z); // pointing along −Z, back toward the base
        handler.dispose();
    });

    /** The quad the handler previews, as it builds it. */
    function previewQuad(data: OffsetDragData): Float32Array {
        const handler = new SketchPlaneOffsetHandler(doc, controller, data);
        const quad = (handler as any).buildPreview().meshes[0];
        handler.dispose();
        return quad.position;
    }

    test("a face pick previews the quad on the plane's own frame", () => {
        const position = previewQuad({ basePlane: Plane.YZ, offset: 3 });

        const onPlane = datumQuad(Plane.YZ.offsetAlongNormal(3), DATUM_PREVIEW_SIZE);
        expect(Array.from(position)).toEqual(Array.from(onPlane.position));
    });

    test("a datum pick previews the quad in the frame the picker drew it in", () => {
        // The sketch planes are Z-up, so ZX's own frame puts the quad at −X; the picker draws
        // that datum in +X+Z, and the preview has to carry on from there (see `datumDisplayPlane`).
        const position = previewQuad({
            basePlane: datumPlaneOf("ZX"),
            quadPlane: datumDisplayPlane("ZX"),
        });

        const asPicked = datumQuad(datumDisplayPlane("ZX"), DATUM_PREVIEW_SIZE);
        expect(Array.from(position)).toEqual(Array.from(asPicked.position));
        expect(position[0]).toBeGreaterThan(0); // +X, where the picker showed it
    });

    /** The arrow's world segment, as the handler computes it. */
    function arrowOf(handler: SketchPlaneOffsetHandler): { start: XYZ; end: XYZ } {
        return (handler as any).arrowSegment();
    }

    test("a face pick centres the quad and the arrow on the point that was clicked", () => {
        const pickPoint = new XYZ({ x: 30, y: -40, z: 0 });
        const data: OffsetDragData = { basePlane: Plane.XY, pickPoint, offset: 5 };
        const handler = new SketchPlaneOffsetHandler(doc, controller, data);

        const { start } = arrowOf(handler);
        handler.dispose();

        // the handle lands under the pointer that picked the face, lifted by the offset
        expect(start.isEqualTo(new XYZ({ x: 30, y: -40, z: 5 }))).toBe(true);
        const centred = datumQuadAt(
            Plane.XY.offsetAlongNormal(5),
            new XYZ({ x: 30, y: -40, z: 5 }),
            DATUM_PREVIEW_SIZE,
        );
        expect(Array.from(previewQuad(data))).toEqual(Array.from(centred.position));
    });

    test("the picked point only moves along the normal as the offset changes", () => {
        const handler = new SketchPlaneOffsetHandler(doc, controller, {
            basePlane: Plane.XY,
            pickPoint: new XYZ({ x: 30, y: -40, z: 0 }),
            offset: 5,
        });
        const quad = () => (handler as any).buildPreview().meshes[0].position as Float32Array;
        const at5 = Array.from(quad());

        handler.setValue(-2);
        const atMinus2 = Array.from(quad());
        handler.dispose();

        // Plane.XY's frame is the world's, so the x/y components are the in-plane ones: the
        // handle keeps the user's own point there and slides only along the normal.
        expect(atMinus2.filter((_, i) => i % 3 !== 2)).toEqual(at5.filter((_, i) => i % 3 !== 2));
        expect(at5[2] - atMinus2[2]).toBeCloseTo(7);
    });

    test("dragging the arrow sets a signed offset and reports it", () => {
        const onOffset = rs.fn((_offset: number) => {});
        const handler = new SketchPlaneOffsetHandler(doc, controller, { ...offsetData(), onOffset });
        const view = dragView();

        handler.pointerDown(view, createPointerEvent({ offsetX: 100, offsetY: 200 }));
        handler.pointerMove(view, createPointerEvent({ offsetX: 113, offsetY: 200 })); // grabs at z = 0
        handler.pointerMove(view, createPointerEvent({ offsetX: 123, offsetY: 200 }));

        expect(handler.offset).toBeCloseTo(10);
        expect(onOffset).toHaveBeenCalledWith(10);
        expect(handler.plane.origin.z).toBeCloseTo(10);
        handler.dispose();
    });

    test("dragging below the base plane gives a negative offset", () => {
        const handler = new SketchPlaneOffsetHandler(doc, controller, offsetData());
        const view = dragView();

        handler.pointerDown(view, createPointerEvent({ offsetX: 113, offsetY: 200 }));
        // The move that crosses the drag threshold grabs the axis at z = 7.
        handler.pointerMove(view, createPointerEvent({ offsetX: 120, offsetY: 200 }));
        handler.pointerMove(view, createPointerEvent({ offsetX: 110, offsetY: 200 })); // z = −3

        expect(handler.offset).toBeCloseTo(-10);
        handler.dispose();
    });

    test("typing a number enters that exact offset", () => {
        const onOffset = rs.fn((_offset: number) => {});
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        const handler = new SketchPlaneOffsetHandler(doc, controller, { ...offsetData(), onOffset });
        let showInput: ((text: string) => unknown) | undefined;
        pub.mockImplementation((event: string, ...args: any[]) => {
            if (event === "showInput") showInput = args[1] as (text: string) => unknown;
        });

        handler.keyDown(dragView(), { key: "4" } as KeyboardEvent);
        const result = showInput!("42");

        expect(onOffset).toHaveBeenCalledWith(42);
        expect(handler.offset).toBe(42);
        expect((result as any).isOk).toBe(true);
        pub.mockRestore();
        handler.dispose();
    });

    test("a non-numeric entry is rejected and leaves the offset alone", () => {
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        const handler = new SketchPlaneOffsetHandler(doc, controller, offsetData(Plane.XY, 3));
        let showInput: ((text: string) => unknown) | undefined;
        pub.mockImplementation((event: string, ...args: any[]) => {
            if (event === "showInput") showInput = args[1] as (text: string) => unknown;
        });

        handler.keyDown(dragView(), { key: "5" } as KeyboardEvent);
        const result = showInput!("abc");

        expect((result as any).isOk).toBe(false);
        expect(handler.offset).toBe(3);
        pub.mockRestore();
        handler.dispose();
    });

    test("zero offset confirms without any drag", () => {
        const handler = new SketchPlaneOffsetHandler(doc, controller, offsetData());
        const view = dragView();
        // Enter has no pointer event to take a view from, so the handler falls back to
        // the active view — the view the user would be clicking in.
        (doc.application as any).activeView = view;

        handler.keyDown(view, enterKey());

        expect(controller.result?.status).toBe("success");
        expect(handler.commitView).toBe(view);
        handler.dispose();
    });

    test("the command can push a new offset into the live drag", () => {
        const handler = new SketchPlaneOffsetHandler(doc, controller, offsetData());

        handler.setValue(15);

        expect(handler.offset).toBe(15);
        expect(handler.plane.origin.z).toBe(15);
        handler.dispose();
    });

    test("Escape cancels", () => {
        const handler = new SketchPlaneOffsetHandler(doc, controller, offsetData());

        handler.keyDown(dragView(), { key: "Escape" } as KeyboardEvent);

        expect(controller.result?.status).toBe("cancel");
        handler.dispose();
    });

    test("teardown drops every mesh it drew and clears the controls", () => {
        const context = doc.visual.context;
        const displayMesh = rs.spyOn(context, "displayMesh");
        const removeMesh = rs.spyOn(context, "removeMesh");
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        const handler = new SketchPlaneOffsetHandler(doc, controller, offsetData());

        const drawn = displayMesh.mock.calls.length;
        expect(drawn).toBeGreaterThan(0);

        handler.dispose();

        expect(removeMesh.mock.calls.length).toBe(drawn);
        expect(pub).toHaveBeenCalledWith("clearConfirmControl");
        pub.mockRestore();
    });
});

describe("SketchPlaneOffsetStep", () => {
    test("returns the offset plane once the drag is confirmed", async () => {
        const doc = new TestDocument();
        doc.visual = createMockVisualWithDocument(doc);
        stubArrowGeometry();
        const controller = new AsyncController();
        let captured: SketchPlaneOffsetHandler | undefined;
        doc.picker = {
            pickAsync: rs.fn(
                async (handler: SketchPlaneOffsetHandler, _prompt: unknown, c: AsyncController) => {
                    captured = handler;
                    return new Promise<void>((resolve) => c.onCompleted(() => resolve()));
                },
            ),
        } as any;

        const step = new SketchPlaneOffsetStep("prompt.dragToOffset", () => ({
            basePlane: Plane.XY,
            offset: 8,
        }));
        const promise = step.execute(doc, controller);
        const view = createHandlerMockView({ document: doc });
        captured!.commitView = view;
        controller.success();

        const result = await promise;

        expect(result?.view).toBe(view);
        expect(result?.plane?.origin.z).toBe(8);
        expect(controller.result?.status).toBe("success");
    });

    test("returns undefined when the drag is cancelled", async () => {
        const doc = new TestDocument();
        doc.visual = createMockVisualWithDocument(doc);
        stubArrowGeometry();
        const controller = new AsyncController();
        let captured: SketchPlaneOffsetHandler | undefined;
        doc.picker = {
            pickAsync: rs.fn(
                async (handler: SketchPlaneOffsetHandler, _prompt: unknown, c: AsyncController) => {
                    captured = handler;
                    return new Promise<void>((resolve) => c.onCancelled(() => resolve()));
                },
            ),
        } as any;

        const step = new SketchPlaneOffsetStep("prompt.dragToOffset", () => ({ basePlane: Plane.XY }));
        const promise = step.execute(doc, controller);
        captured!.keyDown(createHandlerMockView({ document: doc }), { key: "Escape" } as KeyboardEvent);

        expect(await promise).toBeUndefined();
    });
});
