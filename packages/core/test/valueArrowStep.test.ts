// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { afterAll, beforeAll, describe, expect, rs, test } from "@rstest/core";
import { AsyncController, type INode, Result, ShapeTypes, XYZ } from "../src";
import {
    ValueArrowPickHandler,
    type ValueArrowPickOptions,
    valueArrowNodeFilter,
} from "../src/step/valueArrowStep";
import { createMockDocument, createMockView } from "../test-utils";

const options: ValueArrowPickOptions = { shapeType: ShapeTypes.edge };
const allowAll = { allow: () => true };
const reference = { isReferenceGeometry: true } as unknown as INode;
const body = {} as unknown as INode;

describe("valueArrowNodeFilter", () => {
    test("excludes reference geometry, like SelectShapeStep", () => {
        const filter = valueArrowNodeFilter(options, allowAll);
        expect(filter.allow(reference)).toBe(false);
        expect(filter.allow(body)).toBe(true);
    });

    test("composes the caller's own gate instead of replacing it", () => {
        const filter = valueArrowNodeFilter(options, { allow: (node) => node !== body });
        expect(filter.allow(body)).toBe(false);
        expect(filter.allow({} as unknown as INode)).toBe(true);
    });

    test("allowReferenceGeometry opts out of the exclusion", () => {
        const filter = valueArrowNodeFilter({ ...options, allowReferenceGeometry: true }, allowAll);
        expect(filter.allow(reference)).toBe(true);
    });
});

describe("ValueArrowPickHandler", () => {
    // The arrow is meshed through the global factory, which reaches the current application.
    let restoreApp: () => void;
    beforeAll(() => {
        const previous = Object.getOwnPropertyDescriptor(globalThis, "app");
        const arrowShape = () => Result.ok({ mesh: { faces: {} }, dispose: () => {} } as any);
        Object.defineProperty(globalThis, "app", {
            configurable: true,
            get: () => ({ shapeProvider: { factory: { cylinder: arrowShape, cone: arrowShape } } }),
        });
        restoreApp = () => {
            if (previous) Object.defineProperty(globalThis, "app", previous);
        };
    });
    afterAll(() => restoreApp());

    /** A handler whose arrow sits at the origin along +X with value 1. */
    function scene() {
        const document = createMockDocument();
        const displayMesh = rs.fn(() => 7);
        const removeMesh = rs.fn();
        (document.visual.context as any).displayMesh = displayMesh;
        (document.visual.context as any).removeMesh = removeMesh;
        const removeCamera = rs.fn();
        const view = createMockView({
            cameraController: {
                onPropertyChanged: () => {},
                removePropertyChanged: removeCamera,
            } as any,
        });
        const values: number[] = [];
        const handler = new ValueArrowPickHandler(
            document,
            new AsyncController(),
            { shapeType: ShapeTypes.edge },
            { allow: () => true },
            {
                arrowData: () => ({ anchor: XYZ.zero, direction: XYZ.unitX, value: 1 }),
                setValue: (value) => values.push(value),
            },
        );
        return { handler, view, displayMesh, removeMesh, removeCamera, values };
    }

    const pointer = (offsetX: number, offsetY: number) =>
        ({ button: 0, isPrimary: true, pointerId: 1, offsetX, offsetY }) as unknown as PointerEvent;

    test("dragging the arrow reports the value projected onto its axis", () => {
        const { handler, view, values } = scene();
        handler.refreshArrow(view);

        // The shaft runs from screen x=401 (arrow value 1) to x=481 (value + 80px worth).
        handler.pointerDown(view, pointer(450, 300));
        handler.pointerMove(view, pointer(480, 300));
        handler.pointerUp(view, pointer(480, 300));

        // The ray under x=480 lands at world x=80; the grab offset (49) keeps the drag
        // continuous, so the reported value is 31.
        expect(values).toEqual([31]);
    });

    test("the drag clamps at the minimum value", () => {
        const { handler, view, values } = scene();
        handler.refreshArrow(view);

        handler.pointerDown(view, pointer(450, 300));
        handler.pointerMove(view, pointer(0, 300));

        expect(values).toEqual([0.1]);
    });

    test("disposing releases the arrow meshes and the camera listener", () => {
        const { handler, view, displayMesh, removeMesh, removeCamera } = scene();
        handler.refreshArrow(view);
        handler.pointerDown(view, pointer(450, 300));
        expect(displayMesh).toHaveBeenCalled();

        handler.dispose();

        expect(removeMesh).toHaveBeenCalled();
        expect(removeCamera).toHaveBeenCalled();
    });
});
