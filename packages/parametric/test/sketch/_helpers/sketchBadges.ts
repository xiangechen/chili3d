// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * The sketch badge harness: a document with an active view whose `htmlText` is captured
 * instead of drawn, so a test can read the badges an annotation refresh produced and drive
 * them with real DOM events.
 *
 * Shared by the constraint-badge tests and the array-badge ones — the two assert on
 * different faces of the same machinery, and a second copy of the capture would let them
 * drift apart (`_helpers/sketchHover.ts` is the same bargain for hover previews).
 */

import { type ICameraController, Result, XYZ } from "@chili3d/core";
import {
    createMockApplication,
    createMockView,
    createMockVisualWithDocument,
    TestDocument,
} from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";

/** One captured `view.htmlText` call: the badge the annotation layer asked for. */
export interface MockBadge {
    text: string;
    position: { x: number; y: number; z: number };
    options: any;
    element: HTMLElement;
    disposed: boolean;
}

export function badgeView() {
    const camera = {
        cameraPosition: new XYZ({ x: 0, y: 0, z: 500 }),
        cameraTarget: XYZ.zero,
        cameraUp: XYZ.unitY,
        cameraType: "perspective" as "perspective" | "orthographic",
        lookAt: rs.fn(),
        fitContent: rs.fn(),
    };
    const app = createMockApplication();
    const doc = new TestDocument({ application: app, selection: { clearSelection: rs.fn() } as any });
    doc.visual = createMockVisualWithDocument(doc) as any;
    const view = createMockView({ document: doc, cameraController: camera as unknown as ICameraController });
    (app as any).activeView = view;

    const badges: MockBadge[] = [];
    (view as any).htmlText = rs.fn(
        (text: string, position: { x: number; y: number; z: number }, options: any) => {
            const element = document.createElement("div");
            if (options?.className) element.className = options.className;
            // attach like the real CSS2DRenderer so event propagation reaches window
            document.body.appendChild(element);
            const badge: MockBadge = { text, position, options, element, disposed: false };
            badges.push(badge);
            // wire the same listeners threeView.htmlText does, so a test can drive a badge
            // with real events instead of reaching into the options object it was given
            if (options?.interactive) {
                element.addEventListener("pointerdown", (e) => e.stopPropagation());
                element.addEventListener("pointerup", (e) => e.stopPropagation());
                if (options.onClick) element.addEventListener("click", options.onClick);
                if (options.onDoubleClick) element.addEventListener("dblclick", options.onDoubleClick);
                if (options.onMouseEnter) element.addEventListener("mouseenter", options.onMouseEnter);
                if (options.onMouseLeave) element.addEventListener("mouseleave", options.onMouseLeave);
            }
            options?.onCreated?.(element);
            return {
                dispose: rs.fn(() => {
                    badge.disposed = true;
                    element.remove();
                }),
            };
        },
    );
    const displayed: { id: number; colors: number[]; datas: any[]; meshOption?: any }[] = [];
    let nextMeshId = 1;
    (doc.visual.context as any).displayMesh = rs.fn((datas: any[], meshOption?: any) => {
        displayed.push({ id: nextMeshId, colors: datas.map((d) => d.color), datas, meshOption });
        return nextMeshId++;
    });
    const removeMesh = rs.fn();
    (doc.visual.context as any).removeMesh = removeMesh;

    const previous = Object.getOwnPropertyDescriptor(globalThis, "shapeFactory");
    Object.defineProperty(globalThis, "shapeFactory", {
        value: {
            // an edge the kernel can offset (the offset-curve entity build asks it to)
            line: () =>
                Result.ok({ isEqual: () => false, offset: () => Result.ok({ isEqual: () => false }) }),
            circle: () => Result.ok({ isEqual: () => false }),
            ellipse: () =>
                Result.ok({ isEqual: () => false, offset: () => Result.ok({ isEqual: () => false }) }),
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
    return { app, doc, view, badges, displayed, removeMesh, restoreFactory };
}

export function pointerEvent(x: number, y: number, shiftKey = false): PointerEvent {
    // client and offset agree in these tests — happy-dom rects are zero-origin — and the label
    // drag reads `clientX/Y` for its origin while the plane mapping reads `offsetX/Y`.
    return {
        offsetX: x,
        offsetY: y,
        clientX: x,
        clientY: y,
        button: 0,
        shiftKey,
        preventDefault: () => {},
        stopPropagation: () => {},
    } as unknown as PointerEvent;
}
