// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type ICameraController, type INode, Plane, PubSub, Result, XYZ } from "@chili3d/core";
import {
    createMockApplication,
    createMockView,
    createMockVisualWithDocument,
    TestDocument,
} from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import "../src/index"; // registers the nodeDoubleClicked subscription
import { SketchEditor } from "../src/editor/sketchEditor";
import { SketchNode } from "../src/sketchNode";
import "./setup";

function setup() {
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
    return { doc, restoreFactory };
}

describe("tree double-click entry", () => {
    test("double-clicking a sketch node enters editing; after exit, re-enters", () => {
        const { doc, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });

            PubSub.default.pub("nodeDoubleClicked", node);
            const first = SketchEditor.getActive();
            expect(first?.node).toBe(node);

            first!.exit();
            expect(SketchEditor.getActive()).toBeUndefined();

            PubSub.default.pub("nodeDoubleClicked", node);
            const second = SketchEditor.getActive();
            expect(second?.node).toBe(node);
            second!.exit();
        } finally {
            restoreFactory();
        }
    });

    test("ignores non-sketch nodes and re-entry of the node being edited", () => {
        const { doc, restoreFactory } = setup();
        try {
            PubSub.default.pub("nodeDoubleClicked", {} as INode);
            expect(SketchEditor.getActive()).toBeUndefined();

            const node = new SketchNode({ document: doc, plane: Plane.XY });
            PubSub.default.pub("nodeDoubleClicked", node);
            const editor = SketchEditor.getActive();
            expect(editor).toBeDefined();
            const exitSpy = rs.spyOn(editor!, "exit");

            // double-clicking the node already being edited is a no-op
            PubSub.default.pub("nodeDoubleClicked", node);
            expect(exitSpy).not.toHaveBeenCalled();
            expect(SketchEditor.getActive()).toBe(editor);

            exitSpy.mockRestore();
            editor!.exit();
        } finally {
            restoreFactory();
        }
    });
});
