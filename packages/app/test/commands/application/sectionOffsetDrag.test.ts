// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    type IShape,
    type IVisualObject,
    type MeshOption,
    Plane,
    Ray,
    Result,
    SectionPlaneNode,
    type ShapeMeshData,
    XY,
    XYZ,
} from "@chili3d/core";
import { createMockDocument, createMockView } from "@chili3d/core/test-utils";
import { afterAll, beforeAll, describe, expect, rs, test } from "@rstest/core";
import { SectionOffsetDragHandler } from "../../../src/commands/application/sectionOffsetDrag";
import {
    projectRotationValue,
    rotationHandleMidpoint,
    SECTION_ARC_RADIUS_RATIO,
    sectionRotationHandle,
} from "../../../src/commands/application/sectionRotationHandles";

const pointer = (offsetX: number, offsetY = 300) =>
    ({ button: 0, isPrimary: true, pointerId: 1, offsetX, offsetY, preventDefault() {} }) as PointerEvent;

describe("SectionOffsetDragHandler", () => {
    let restoreApp: () => void;
    beforeAll(() => {
        const previous = Object.getOwnPropertyDescriptor(globalThis, "app");
        const arrowShape = (direction: XYZ) =>
            Result.ok({ mesh: { faces: { direction } }, dispose: () => {} } as unknown as IShape);
        Object.defineProperty(globalThis, "app", {
            configurable: true,
            get: () => ({ shapeProvider: { factory: { cylinder: arrowShape, cone: arrowShape } } }),
        });
        restoreApp = () => {
            if (previous) Object.defineProperty(globalThis, "app", previous);
            else Reflect.deleteProperty(globalThis, "app");
        };
    });
    afterAll(() => restoreApp());

    function scene(rotation = false, perspective = false) {
        const document = createMockDocument();
        let nextId = 0;
        const displayMesh = rs.fn((_datas: ShapeMeshData[], _options?: MeshOption) => ++nextId);
        const removeMesh = rs.fn();
        document.visual.context.displayMesh = displayMesh;
        document.visual.context.removeMesh = removeMesh;
        const removeCamera = rs.fn();
        let cameraChanged = () => {};
        let pointerCaptured = false;
        const dom = globalThis.document.createElement("div");
        dom.setPointerCapture = rs.fn(() => {
            pointerCaptured = true;
        });
        dom.releasePointerCapture = rs.fn(() => {
            pointerCaptured = false;
        });
        dom.hasPointerCapture = rs.fn(() => pointerCaptured);
        const view = createMockView({
            document,
            dom,
            cameraController: {
                onPropertyChanged: (handler: () => void) => (cameraChanged = handler),
                removePropertyChanged: removeCamera,
            } as never,
        });
        if (rotation) {
            const projected = new Map<string, XYZ>();
            view.worldToScreen = (point: XYZ) => {
                const screen = new XY({ x: point.x + 400, y: 300 - point.y });
                projected.set(`${screen.x},${screen.y}`, point);
                return screen;
            };
            view.rayAt = (mx, my) => {
                const target = projected.get(`${mx},${my}`);
                const direction = new XYZ(1, 1, 1).normalize();
                if (!target || !direction) throw new Error("rotation test has no projected point");
                return new Ray({ point: target.sub(direction.multiply(500)), direction });
            };
        }
        if (perspective) {
            view.direction = () => XYZ.unitNZ;
            view.up = () => XYZ.unitY;
            view.worldToScreen = (point) => {
                const scale = 500 / (500 - point.z);
                return new XY({ x: 400 + point.x * scale, y: 300 - point.y * scale });
            };
        }
        const controller = new AsyncController();
        const values: number[] = [];
        const onDragStart = rs.fn();
        const onDragEnd = rs.fn();
        const angleValues = { x: [] as number[], y: [] as number[] };
        const angles = { x: 0, y: 0 };
        const normal = rotation || perspective ? XYZ.unitZ : XYZ.unitX;
        const xvec = rotation || perspective ? XYZ.unitX : XYZ.unitY;
        const yvec = rotation || perspective ? XYZ.unitY : XYZ.unitZ;
        let offset = 5;
        let flipped = false;
        const direction = () => {
            const x = normal.rotate(xvec, (angles.x * Math.PI) / 180) ?? normal;
            const y = x.rotate(yvec, (angles.y * Math.PI) / 180) ?? x;
            return flipped ? y.reverse() : y;
        };
        const updateOffset = (value: number) => {
            offset = value;
            values.push(value);
            handler.refreshArrow(view);
        };
        const handler = new SectionOffsetDragHandler(document, controller, {
            anchor: XYZ.zero,
            normal,
            xvec,
            yvec,
            direction,
            flipped: () => flipped,
            offset: () => offset,
            setOffset: updateOffset,
            angle: (axis) => angles[axis],
            setAngle: (axis, value) => {
                angles[axis] = value;
                angleValues[axis].push(value);
                handler.refreshArrow(view);
            },
            onDragStart,
            onDragEnd,
        });
        return {
            handler,
            view,
            controller,
            values,
            onDragStart,
            onDragEnd,
            angleValues,
            direction,
            displayMesh,
            dom,
            updateOffset,
            removeMesh,
            removeCamera,
            setFlipped: (value: boolean) => (flipped = value),
            cameraChanged: () => cameraChanged(),
        };
    }

    test("selects the section frame while the edit handles are active", () => {
        const { handler, view } = scene();
        const document = view.document;
        const visual = {} as IVisualObject;
        const node = new SectionPlaneNode({ document, plane: Plane.XY });
        const select = rs.spyOn(document.selection, "setSelectedNodes");
        view.detectVisual = () => [visual];
        document.visual.context.getNode = (candidate) => (candidate === visual ? node : undefined);
        handler.start(view);

        handler.pointerMove(view, pointer(1000));
        handler.pointerDown(view, pointer(1000));
        handler.pointerUp(view, pointer(1000));

        expect(select).toHaveBeenCalledWith([node], false);
        handler.dispose();
        expect(select).toHaveBeenCalledTimes(1);
    });

    test("drags the arrow to a signed offset and shows the current value", () => {
        const { handler, view, values } = scene();
        handler.start(view);

        handler.pointerDown(view, pointer(440));
        handler.pointerMove(view, pointer(460));
        handler.pointerUp(view, pointer(460));

        expect(values).toEqual([25]);
    });

    test("finishes the drag history gesture on release, cancellation, and disposal", () => {
        const { handler, view, onDragStart, onDragEnd } = scene();
        handler.start(view);

        handler.pointerDown(view, pointer(440));
        handler.pointerUp(view, pointer(440));
        handler.pointerDown(view, pointer(440));
        handler.pointerCancel(view, pointer(440));
        handler.pointerDown(view, pointer(440));
        handler.dispose();
        handler.dispose();

        expect(onDragStart).toHaveBeenCalledTimes(3);
        expect(onDragEnd).toHaveBeenCalledTimes(3);
    });

    test("captures the pointer and ends the drag when it was released outside the viewport", () => {
        const { handler, view, values, dom } = scene();
        handler.start(view);
        handler.pointerDown(view, pointer(440));
        expect(dom.setPointerCapture).toHaveBeenCalledWith(1);

        handler.pointerMove(view, { ...pointer(460), buttons: 0 });
        handler.pointerMove(view, { ...pointer(480), buttons: 1 });

        expect(values).toEqual([]);
        expect(dom.releasePointerCapture).toHaveBeenCalledWith(1);
    });

    test("releases the pointer and stops dragging on pointer cancellation", () => {
        const { handler, view, values, dom } = scene();
        handler.start(view);
        handler.pointerDown(view, pointer(440));

        handler.pointerCancel(view, pointer(440));
        handler.pointerMove(view, { ...pointer(460), buttons: 1 });

        expect(values).toEqual([]);
        expect(dom.releasePointerCapture).toHaveBeenCalledWith(1);
    });

    test("allows dragging through zero to a negative offset", () => {
        const { handler, view, values } = scene();
        handler.start(view);

        handler.pointerDown(view, pointer(440));
        handler.pointerMove(view, pointer(430));

        expect(values).toEqual([-5]);
    });

    test("keeps direction across zero and reverses only with the section normal", () => {
        const { handler, view, displayMesh, setFlipped } = scene();
        handler.start(view);
        handler.pointerDown(view, pointer(440));
        handler.pointerMove(view, pointer(430));
        handler.pointerUp(view, pointer(430));

        const negativeCall = displayMesh.mock.calls.at(-5);
        if (!negativeCall) throw new Error("negative offset did not redraw the arrow");
        const negativeMesh = negativeCall[0][0] as ShapeMeshData & { direction: XYZ };
        expect(negativeMesh.direction.isEqualTo(XYZ.unitX)).toBe(true);

        setFlipped(true);
        handler.refreshArrow(view);
        const flippedCall = displayMesh.mock.calls.at(-5);
        if (!flippedCall) throw new Error("flip did not redraw the arrow");
        const flippedMesh = flippedCall[0][0] as ShapeMeshData & { direction: XYZ };
        expect(flippedMesh.direction.isEqualTo(XYZ.unitNX)).toBe(true);
        const flippedMidpoint = displayMesh.mock.calls.at(-3);
        if (!flippedMidpoint) throw new Error("flip did not redraw the arc midpoint");
        expect(Array.from(flippedMidpoint[0][0].position)).toEqual([-49, 0, 0]);
    });

    test("drags both arc handles to change their rotation angles", () => {
        const { handler, view, angleValues } = scene(true);
        handler.start(view);
        const point = (axis: "x" | "y", degrees: number) => {
            const rotationAxis = axis === "x" ? XYZ.unitX : XYZ.unitY;
            const radial = XYZ.unitZ.rotate(rotationAxis, (degrees * Math.PI) / 180);
            if (!radial) throw new Error("rotation test has a degenerate radial direction");
            const center = new XYZ(0, 0, 5);
            return center.add(radial.multiply(80 * SECTION_ARC_RADIUS_RATIO));
        };
        const eventAt = (axis: "x" | "y", degrees: number) => {
            const screen = view.worldToScreen(point(axis, degrees));
            return pointer(screen.x, screen.y);
        };

        for (const axis of ["x", "y"] as const) {
            handler.pointerDown(view, eventAt(axis, 15));
            handler.pointerMove(view, eventAt(axis, 45));
            handler.pointerUp(view, eventAt(axis, 45));
            expect(angleValues[axis]).toHaveLength(1);
            expect(angleValues[axis][0]).toBeCloseTo(30, 6);
        }
    });

    test("keeps rotation continuous across the angle wrap and multiple turns", () => {
        const { handler, view, angleValues } = scene(true);
        handler.start(view);
        const point = (degrees: number) => {
            const radial = XYZ.unitZ.rotate(XYZ.unitX, (degrees * Math.PI) / 180);
            if (!radial) throw new Error("rotation test has a degenerate radial direction");
            return new XYZ(0, 0, 5).add(radial.multiply(80 * SECTION_ARC_RADIUS_RATIO));
        };
        const eventAt = (degrees: number) => {
            const screen = view.worldToScreen(point(degrees));
            return pointer(screen.x, screen.y);
        };

        handler.pointerDown(view, eventAt(15));
        for (const degrees of [190, 270, 360, 400]) handler.pointerMove(view, eventAt(degrees));
        handler.pointerUp(view, eventAt(400));

        expect(angleValues.x).toHaveLength(4);
        const expected = [175, 255, 345, 385];
        for (let i = 0; i < expected.length; i++) expect(angleValues.x[i]).toBeCloseTo(expected[i], 6);
    });

    test("keeps both arc centers at the arrow base after rotation", () => {
        const direction = XYZ.unitZ.rotate(XYZ.unitX, Math.PI / 4);
        if (!direction) throw new Error("rotation test has no direction");
        const tip = new XYZ(1, 2, 3);

        for (const axis of ["x", "y"] as const) {
            const handle = sectionRotationHandle(axis, tip, direction, XYZ.unitX, XYZ.unitY, 80);
            expect(handle.origin.isEqualTo(tip)).toBe(true);
            for (const point of handle.points) {
                expect(point.distanceTo(tip)).toBeCloseTo(handle.radius, 8);
            }
        }
        const x = sectionRotationHandle("x", tip, XYZ.unitZ, XYZ.unitX, XYZ.unitY, 80);
        const y = sectionRotationHandle("y", tip, XYZ.unitZ, XYZ.unitX, XYZ.unitY, 80);
        expect(rotationHandleMidpoint(x).isEqualTo(rotationHandleMidpoint(y))).toBe(true);
        expect(x.radius).toBe(88);
    });

    test("ignores rotation when the pointer ray lies in the rotation plane", () => {
        const view = createMockView();
        const handle = sectionRotationHandle("x", new XYZ(0, 0, 80), XYZ.unitZ, XYZ.unitX, XYZ.unitY, 80);

        expect(projectRotationValue(view, pointer(400, 300), handle)).toBeUndefined();
    });

    test("ignores a press away from the arrow", () => {
        const { handler, view, values } = scene();
        handler.start(view);

        handler.pointerDown(view, pointer(500));
        handler.pointerMove(view, pointer(460));
        handler.pointerUp(view, pointer(460));

        expect(values).toEqual([]);
    });

    test("does not rebuild handles while orbiting with the middle button", () => {
        const { handler, view, displayMesh } = scene();
        handler.start(view);
        displayMesh.mockClear();

        handler.pointerMove(view, { ...pointer(440), buttons: 4 });

        expect(displayMesh).not.toHaveBeenCalled();
    });

    test("measures the screen-sized arrow at its current offset in perspective", () => {
        const { handler, view, updateOffset } = scene(false, true);
        handler.start(view);
        const length = () =>
            (handler as unknown as { arrowHandle: { handleLength: number } }).arrowHandle.handleLength;
        const initial = length();

        updateOffset(100);
        const moved = length();

        expect(initial).toBeGreaterThan(0);
        expect(moved).toBeLessThan(initial);
    });

    test("rescales on camera changes and releases meshes and listeners on dispose", () => {
        const { handler, view, displayMesh, removeMesh, removeCamera, cameraChanged } = scene();
        handler.start(view);
        expect(displayMesh).toHaveBeenCalledTimes(5);

        cameraChanged();
        expect(displayMesh).toHaveBeenCalledTimes(10);
        handler.dispose();

        expect(removeMesh).toHaveBeenCalled();
        expect(removeCamera).toHaveBeenCalledOnce();
        expect(displayMesh.mock.calls.every((call) => call[1]?.onTop === true)).toBe(true);
        expect(displayMesh.mock.calls.every((call) => call[1]?.unlit === true)).toBe(true);
        const center = displayMesh.mock.calls.find((call) => call[1]?.vertexOpacity === 1);
        if (!center) throw new Error("rotation center point is missing");
        expect("size" in center[0][0] && center[0][0].size).toBe(6);
        expect(Array.from(center[0][0].position)).toEqual([49, 0, 0]);
    });

    test("Escape closes the editing session without changing the offset", () => {
        const { handler, view, controller, values } = scene();
        handler.start(view);
        const event = { key: "Escape", preventDefault() {}, stopImmediatePropagation() {} } as KeyboardEvent;

        handler.keyDown(view, event);

        expect(controller.result?.status).toBe("cancel");
        expect(values).toEqual([]);
    });
});
