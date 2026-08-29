// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type IApplication,
    type ICameraController,
    type IDocument,
    Plane,
    PubSub,
    Result,
    XYZ,
} from "@chili3d/core";
import {
    createMockApplication,
    createMockView,
    createMockVisualWithDocument,
    TestDocument,
} from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { SketchEditor } from "../../src/sketch/editor/sketchEditor";
import { SketchEventHandler } from "../../src/sketch/editor/sketchEventHandler";
import { ConstraintKind, type SketchData } from "../../src/sketch/sketchModel";
import { SketchNode } from "../../src/sketch/sketchNode";
import "./setup";

interface TestContext {
    app: IApplication;
    doc: IDocument;
    view: ReturnType<typeof createMockView>;
    camera: {
        cameraPosition: XYZ;
        cameraTarget: XYZ;
        cameraUp: XYZ;
        cameraType: "perspective" | "orthographic";
        lookAt: ReturnType<typeof rs.fn>;
        fitContent: ReturnType<typeof rs.fn>;
    };
    clearSelection: ReturnType<typeof rs.fn>;
    oldHandler: unknown;
    restoreFactory: () => void;
}

function mockShapeFactory() {
    const previous = Object.getOwnPropertyDescriptor(globalThis, "shapeFactory");
    Object.defineProperty(globalThis, "shapeFactory", {
        value: {
            line: () => Result.ok({ isEqual: () => false }),
            circle: () => Result.ok({ isEqual: () => false }),
            wire: () => Result.ok({ isEqual: () => false }),
        },
        writable: true,
        configurable: true,
    });
    return () => {
        if (previous) {
            Object.defineProperty(globalThis, "shapeFactory", previous);
        } else {
            delete (globalThis as any).shapeFactory;
        }
    };
}

function setup(): TestContext {
    const camera = {
        cameraPosition: new XYZ({ x: 0, y: -200, z: 200 }),
        cameraTarget: XYZ.zero,
        cameraUp: XYZ.unitZ,
        cameraType: "perspective" as "perspective" | "orthographic",
        lookAt: rs.fn(),
        fitContent: rs.fn(),
    };
    const app = createMockApplication();
    const clearSelection = rs.fn();
    const doc = new TestDocument({ application: app, selection: { clearSelection } as any });
    doc.visual = createMockVisualWithDocument(doc, {
        viewHandler: { canRotate: true } as any,
    }) as any;
    const view = createMockView({
        document: doc,
        cameraController: camera as unknown as ICameraController,
    });
    (app as any).activeView = view;
    return {
        app,
        doc,
        view,
        camera,
        clearSelection,
        oldHandler: doc.visual.eventHandler,
        restoreFactory: mockShapeFactory(),
    };
}

const DATA: SketchData = {
    entities: [{ id: 1, type: "line", params: [0, 0, 10, 0] }],
    constraints: [],
};

describe("SketchEditor session statics", () => {
    test("enter returns the editor and makes it the active editor", () => {
        const { app, doc, view, camera, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY, data: DATA });
            const editor = SketchEditor.enter(node);

            expect(SketchEditor.getActive()).toBe(editor);
            expect(SketchEditor.getActive()).toBe(editor);
            expect(camera.lookAt).toHaveBeenCalledTimes(1);
            const [eye, target] = camera.lookAt.mock.calls[0] as unknown as [XYZ, XYZ];
            const distance = camera.cameraPosition.distanceTo(camera.cameraTarget);
            expect(eye.x).toBeCloseTo(0, 6);
            expect(eye.y).toBeCloseTo(0, 6);
            expect(eye.z).toBeCloseTo(distance, 6);
            expect(target.x).toBe(0);
            expect(camera.cameraType).toBe("orthographic");
            expect(camera.fitContent).toHaveBeenCalledTimes(1);
            expect(view.workplane).toBe(node.plane);
            expect(doc.visual.eventHandler).toBeInstanceOf(SketchEventHandler);
            expect((doc.visual.viewHandler as any).canRotate).toBe(false);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("enter clears the current selection highlight", () => {
        const { doc, clearSelection, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY, data: DATA });
            const editor = SketchEditor.enter(node);

            expect(clearSelection).toHaveBeenCalledTimes(1);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("entering a second sketch exits the first one", () => {
        const { app, doc, restoreFactory } = setup();
        try {
            const n1 = new SketchNode({ document: doc, plane: Plane.XY });
            const n2 = new SketchNode({ document: doc, plane: Plane.YZ });
            const first = SketchEditor.enter(n1);
            const exitSpy = rs.spyOn(first, "exit");

            const second = SketchEditor.enter(n2);

            expect(exitSpy).toHaveBeenCalledTimes(1);
            expect(SketchEditor.getActive()).toBe(second);
            expect(SketchEditor.getActive()).not.toBe(first);
            second.exit();
            exitSpy.mockRestore();
        } finally {
            restoreFactory();
        }
    });

    test("editor.exit commits node data and restores camera, workplane, handler", () => {
        const { app, doc, view, camera, oldHandler, restoreFactory } = setup();
        try {
            const oldWorkplane = view.workplane;
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 10, 0);
            editor.exit();

            expect(SketchEditor.getActive()).toBeUndefined();
            expect(SketchEditor.getActive()).toBeUndefined();
            expect(node.data.entities).toEqual([{ id: 1, type: "line", params: [0, 0, 10, 0] }]);
            expect(doc.visual.eventHandler).toBe(oldHandler);
            expect(view.workplane).toBe(oldWorkplane);
            expect(camera.cameraType).toBe("perspective");
            expect(camera.lookAt).toHaveBeenCalledTimes(2);
            expect((doc.visual.viewHandler as any).canRotate).toBe(true);
        } finally {
            restoreFactory();
        }
    });

    test("without a session getActive is undefined and exit is a no-op", () => {
        const { app, restoreFactory } = setup();
        try {
            expect(SketchEditor.getActive()).toBeUndefined();
            SketchEditor.exit();
            expect(SketchEditor.getActive()).toBeUndefined();
        } finally {
            restoreFactory();
        }
    });

    test("dimension anchors are committed to node data and restored on re-enter", () => {
        const { doc, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY, data: DATA });
            const editor = SketchEditor.enter(node);
            const id = editor.solver.addConstraint({
                kind: ConstraintKind.P2PDistance,
                refs: [
                    { entityId: 1, pointIndex: 0 },
                    { entityId: 1, pointIndex: 1 },
                ],
                datum: 10,
            });
            editor.dimensionAnchors.set(id, { kind: "offset", offset: 25 });
            editor.exit();

            expect(node.data.anchors).toEqual([{ id, anchor: { kind: "offset", offset: 25 } }]);

            const reopened = SketchEditor.enter(node);
            expect(reopened.dimensionAnchors.get(id)).toEqual({ kind: "offset", offset: 25 });
            reopened.exit();
        } finally {
            restoreFactory();
        }
    });

    test("anchors of deleted constraints are dropped on re-enter", () => {
        const { doc, restoreFactory } = setup();
        try {
            const data: SketchData = {
                entities: [{ id: 1, type: "line", params: [0, 0, 10, 0] }],
                constraints: [],
                anchors: [{ id: 99, anchor: { kind: "offset", offset: 25 } }],
            };
            const node = new SketchNode({ document: doc, plane: Plane.XY, data });

            const editor = SketchEditor.enter(node);

            expect(editor.dimensionAnchors.size).toBe(0);
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("undo/redo during a session resyncs solver and anchors from node data", () => {
        const { doc, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY, data: DATA });
            const editor = SketchEditor.enter(node);
            const id = editor.solver.addConstraint({
                kind: ConstraintKind.P2PDistance,
                refs: [
                    { entityId: 1, pointIndex: 0 },
                    { entityId: 1, pointIndex: 1 },
                ],
                datum: 10,
            });
            editor.dimensionAnchors.set(id, { kind: "offset", offset: 25 });
            editor.commit();
            expect(editor.solver.toData().constraints.length).toBe(1);

            doc.history.undo();
            expect(editor.solver.toData().constraints.length).toBe(0);
            expect(editor.dimensionAnchors.size).toBe(0);

            doc.history.redo();
            expect(editor.solver.toData().constraints.length).toBe(1);
            expect(editor.dimensionAnchors.get(id)).toEqual({ kind: "offset", offset: 25 });
            editor.exit();
        } finally {
            restoreFactory();
        }
    });

    test("exit exits the active session", () => {
        const { app, doc, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            SketchEditor.enter(node);

            SketchEditor.exit();

            expect(SketchEditor.getActive()).toBeUndefined();
        } finally {
            restoreFactory();
        }
    });
});
