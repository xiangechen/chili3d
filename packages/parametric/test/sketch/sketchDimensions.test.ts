// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type DialogButton,
    type I18nKeys,
    type ICameraController,
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
import { DistanceDimensionCommand, RadiusDimensionCommand } from "../../src/sketch/commands/sketchDimensions";
import { SketchEditor } from "../../src/sketch/editor/sketchEditor";
import type { SketchEventHandler } from "../../src/sketch/editor/sketchEventHandler";
import { ConstraintKind } from "../../src/sketch/sketchModel";
import { SketchNode } from "../../src/sketch/sketchNode";
import "./setup";

type DialogCapture = {
    title?: I18nKeys;
    content?: HTMLElement;
    buttons?: DialogButton[] | (() => void);
};

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

    const dialog: DialogCapture = {};
    const originalPub = PubSub.default.pub as unknown as (key: string, ...args: any[]) => void;
    PubSub.default.pub = ((key: string, ...args: any[]) => {
        if (key === "showDialog") {
            [dialog.title, dialog.content, dialog.buttons] = args as [
                I18nKeys,
                HTMLElement,
                DialogButton[] | (() => void),
            ];
            return;
        }
        originalPub.call(PubSub.default, key, ...args);
    }) as any;
    const restorePub = () => {
        PubSub.default.pub = originalPub as any;
    };

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
    return { app, doc, view, dialog, restorePub, restoreFactory };
}

function dialogInput(dialog: DialogCapture): HTMLInputElement {
    const el = dialog.content?.querySelector("input");
    expect(el).not.toBeNull();
    return el as HTMLInputElement;
}

/** Simulates confirming the dialog; returns whether the dialog would close. */
function confirmDialog(dialog: DialogCapture, text: string): boolean {
    const buttons = dialog.buttons as DialogButton[];
    const confirm = buttons.find((b) => b.content === "common.confirm");
    expect(confirm).toBeDefined();
    dialogInput(dialog).value = text;
    const shouldClose = confirm!.shouldClose?.() !== false;
    if (shouldClose) confirm!.onclick?.();
    return shouldClose;
}

function pointerEvent(x: number, y: number): PointerEvent {
    return { offsetX: x, offsetY: y, button: 0, shiftKey: false } as PointerEvent;
}

/** Lets the command's awaited picks advance between simulated clicks. */
async function tick() {
    for (let i = 0; i < 5; i++) await Promise.resolve();
}

/** Runs the distance command through its three picks (point, point, position). */
async function placeDistanceDimension(app: any, doc: any, view: any): Promise<void> {
    const handler = doc.visual.eventHandler as SketchEventHandler;
    const run = new DistanceDimensionCommand().execute(app);
    handler.pointerDown(view, pointerEvent(400, 300));
    await tick();
    handler.pointerDown(view, pointerEvent(500, 300));
    await tick();
    handler.pointerDown(view, pointerEvent(450, 250));
    await run;
}

function cancelDialog(dialog: DialogCapture): void {
    const buttons = dialog.buttons as DialogButton[];
    const cancel = buttons.find((b) => b.content === "common.cancel");
    expect(cancel).toBeDefined();
    cancel!.onclick?.();
}

// mock view maps screen (x, y) -> world (x - 400, 300 - y, 0) on the XY plane:
// a line (0,0)-(100,0) spans screen x 400..500 at y 300
describe("dimension commands", () => {
    test("distance constraint is created at placement, before the dialog is confirmed", async () => {
        const { app, doc, view, dialog, restorePub, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 100, 0);
            editor.solve(true);
            const handler = doc.visual.eventHandler as SketchEventHandler;

            const run = new DistanceDimensionCommand().execute(app);
            handler.pointerDown(view, pointerEvent(400, 300));
            await tick();
            handler.pointerDown(view, pointerEvent(500, 300));
            await tick();
            handler.pointerDown(view, pointerEvent(450, 250));
            await run;

            // the dimension exists and the dialog is open — before any confirm
            expect(dialogInput(dialog).value).toBe("100.00");
            const constraints = editor.solver.toData().constraints;
            expect(constraints.length).toBe(1);
            expect(constraints[0].kind).toBe(ConstraintKind.P2PDistance);
            expect(constraints[0].datum).toBeCloseTo(100);
            expect(editor.dimensionAnchors.has(constraints[0].id)).toBe(true);
            // not committed to the node (and history) until the dialog is confirmed
            expect(node.data.constraints.length).toBe(0);

            // confirming the dialog only updates the datum
            expect(confirmDialog(dialog, "80")).toBe(true);
            expect(editor.solver.toData().constraints[0].datum).toBeCloseTo(80);

            // invalid input keeps the dialog open and the current value
            expect(confirmDialog(dialog, "abc")).toBe(false);
            expect(editor.solver.toData().constraints[0].datum).toBeCloseTo(80);
            editor.exit();
        } finally {
            restorePub();
            restoreFactory();
        }
    });

    test("editDatum re-opens the dialog with the current value and updates it", () => {
        const { doc, dialog, restorePub, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 100, 0);
            const id = editor.solver.addConstraint({
                kind: ConstraintKind.P2PDistance,
                refs: [
                    { entityId: 1, pointIndex: 0 },
                    { entityId: 1, pointIndex: 1 },
                ],
                datum: 100,
            });
            editor.solve(true);

            editor.editDatum(id);
            expect(dialogInput(dialog).value).toBe("100.00");
            expect(confirmDialog(dialog, "75")).toBe(true);
            expect(editor.solver.toData().constraints[0].datum).toBeCloseTo(75);
            editor.exit();
        } finally {
            restorePub();
            restoreFactory();
        }
    });

    test("radius constraint is created at placement, before the dialog is confirmed", async () => {
        const { app, doc, view, dialog, restorePub, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addCircle(0, 0, 30);
            editor.solve(true);
            const handler = doc.visual.eventHandler as SketchEventHandler;

            const run = new RadiusDimensionCommand().execute(app);
            // circle rim at world (30, 0) -> screen (430, 300)
            handler.pointerDown(view, pointerEvent(430, 300));
            await tick();
            handler.pointerDown(view, pointerEvent(500, 250));
            await run;

            expect(dialogInput(dialog).value).toBe("30.00");
            const constraints = editor.solver.toData().constraints;
            expect(constraints.length).toBe(1);
            expect(constraints[0].kind).toBe(ConstraintKind.Radius);
            expect(constraints[0].datum).toBeCloseTo(30);
            expect(editor.dimensionAnchors.has(constraints[0].id)).toBe(true);

            expect(confirmDialog(dialog, "45")).toBe(true);
            expect(editor.solver.toData().constraints[0].datum).toBeCloseTo(45);
            editor.exit();
        } finally {
            restorePub();
            restoreFactory();
        }
    });

    test("confirming the dialog creates a single undo step", async () => {
        const { app, doc, view, dialog, restorePub, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 100, 0);
            editor.solve(true);
            editor.commit();
            const undosBefore = doc.history.undoCount();

            await placeDistanceDimension(app, doc, view);
            expect(confirmDialog(dialog, "80")).toBe(true);
            expect(doc.history.undoCount()).toBe(undosBefore + 1);

            doc.history.undo();
            expect(editor.solver.toData().constraints.length).toBe(0);
            expect(editor.solver.toData().entities.length).toBe(1);
            expect(node.data.constraints.length).toBe(0);
            editor.exit();
        } finally {
            restorePub();
            restoreFactory();
        }
    });

    test("cancelling the dialog rolls the constraint back without a history record", async () => {
        const { app, doc, view, dialog, restorePub, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 100, 0);
            editor.solve(true);
            editor.commit();
            const undosBefore = doc.history.undoCount();

            await placeDistanceDimension(app, doc, view);
            cancelDialog(dialog);

            expect(editor.solver.toData().constraints.length).toBe(0);
            expect(editor.dimensionAnchors.size).toBe(0);
            expect(doc.history.undoCount()).toBe(undosBefore);
            editor.exit();
        } finally {
            restorePub();
            restoreFactory();
        }
    });

    test("dimension between coincident-shared endpoints belongs to the single line", async () => {
        const { app, doc, view, dialog, restorePub, restoreFactory } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            // three lines chained end-to-end: (0,0)-(100,0)-(200,0)-(300,0)
            editor.solver.addLine(0, 0, 100, 0);
            editor.solver.addLine(100, 0, 200, 0);
            editor.solver.addLine(200, 0, 300, 0);
            editor.solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: 1, pointIndex: 1 },
                    { entityId: 2, pointIndex: 0 },
                ],
            });
            editor.solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: 2, pointIndex: 1 },
                    { entityId: 3, pointIndex: 0 },
                ],
            });
            editor.solve(true);
            const handler = doc.visual.eventHandler as SketchEventHandler;

            // dimension the middle line by its endpoints: world (100,0)/(200,0)
            // -> screen (500,300)/(600,300), position at screen (550,250)
            const run = new DistanceDimensionCommand().execute(app);
            handler.pointerDown(view, pointerEvent(500, 300));
            await tick();
            handler.pointerDown(view, pointerEvent(600, 300));
            await tick();
            handler.pointerDown(view, pointerEvent(550, 250));
            await run;

            const distance = editor.solver
                .toData()
                .constraints.find((c) => c.kind === ConstraintKind.P2PDistance);
            expect(distance).toBeDefined();
            expect(distance!.refs).toEqual([
                { entityId: 2, pointIndex: 0 },
                { entityId: 2, pointIndex: 1 },
            ]);
            cancelDialog(dialog);
            editor.exit();
        } finally {
            restorePub();
            restoreFactory();
        }
    });
});
