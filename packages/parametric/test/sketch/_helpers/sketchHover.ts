// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type ICameraController, Result, XYZ } from "@chili3d/core";
import {
    createMockApplication,
    createMockView,
    createMockVisualWithDocument,
    TestDocument,
} from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import type { SketchEventHandler } from "../../../src/sketch/editor/sketchEventHandler";

/**
 * A sketch session on a mock view for the hover-preview tests: what a pick displays under
 * the cursor is what those tests are about, so the view records every mesh handed to it
 * and the whole shape layer is stubbed out.
 *
 * The view maps world (x, y, 0) to screen (400 + x, 300 − y), so a hover's screen
 * coordinates are the sketch's own plus that offset.
 */
export function setupSketchHover() {
    const camera = {
        cameraPosition: new XYZ({ x: 0, y: 0, z: 500 }),
        cameraTarget: XYZ.zero,
        cameraUp: XYZ.unitY,
        cameraType: "orthographic" as "perspective" | "orthographic",
        lookAt: rs.fn(),
        fitContent: rs.fn(),
    };
    const app = createMockApplication();
    const doc = new TestDocument({ application: app, selection: { clearSelection: rs.fn() } as any });
    doc.visual = createMockVisualWithDocument(doc) as any;
    const view = createMockView({ document: doc, cameraController: camera as unknown as ICameraController });
    (app as any).activeView = view;

    const displayed: { colors: number[]; datas: any[] }[] = [];
    let nextMeshId = 1;
    (doc.visual.context as any).displayMesh = rs.fn((datas: any[]) => {
        displayed.push({ colors: datas.map((d) => d.color), datas });
        return nextMeshId++;
    });
    (doc.visual.context as any).removeMesh = rs.fn();

    const previous = Object.getOwnPropertyDescriptor(globalThis, "shapeFactory");
    Object.defineProperty(globalThis, "shapeFactory", {
        value: {
            line: () => Result.ok({ isEqual: () => false }),
            circle: () => Result.ok({ isEqual: () => false }),
            wire: () => Result.ok({ isEqual: () => false }),
            combine: () => Result.ok({ isEqual: () => false }),
        },
        writable: true,
        configurable: true,
    });
    const restoreFactory = () => {
        if (previous) {
            Object.defineProperty(globalThis, "shapeFactory", previous);
        } else {
            delete (globalThis as any).shapeFactory;
        }
    };
    return { doc, view, displayed, restoreFactory };
}

export function pointerEvent(x: number, y: number): PointerEvent {
    return { offsetX: x, offsetY: y, button: 0, shiftKey: false } as PointerEvent;
}

/** The meshes the last hover displayed, or an empty list when the hover showed nothing. */
export function lastHoverMeshes(displayed: { colors: number[]; datas: any[] }[]): any[] {
    return displayed.at(-1)?.datas ?? [];
}

/** The hover handler of a session that is already up. */
export function hoverHandler(setup: ReturnType<typeof setupSketchHover>): SketchEventHandler {
    return setup.doc.visual.eventHandler as SketchEventHandler;
}
