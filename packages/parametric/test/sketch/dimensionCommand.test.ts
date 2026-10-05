// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    CancelableCommand,
    CommandStore,
    type DialogButton,
    type I18nKeys,
    type ICameraController,
    type IView,
    Plane,
    PropertyUtils,
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
import { DimensionCommand } from "../../src/sketch/commands/sketchDimensions";
import { SketchEditor } from "../../src/sketch/editor/sketchEditor";
import type { SketchEventHandler } from "../../src/sketch/editor/sketchEventHandler";
import { ConstraintKind } from "../../src/sketch/sketchModel";
import { SketchNode } from "../../src/sketch/sketchNode";
import "./setup";

type DialogCapture = { title?: I18nKeys; content?: HTMLElement; buttons?: DialogButton[] };

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
            [dialog.title, dialog.content, dialog.buttons] = args as [I18nKeys, HTMLElement, DialogButton[]];
            return;
        }
        originalPub.call(PubSub.default, key, ...args);
    }) as any;

    const previous = Object.getOwnPropertyDescriptor(globalThis, "shapeFactory");
    Object.defineProperty(globalThis, "shapeFactory", {
        value: {
            line: () => Result.ok({ isEqual: () => false }),
            circle: () => Result.ok({ isEqual: () => false }),
            arc: () => Result.ok({ isEqual: () => false }),
            wire: () => Result.ok({ isEqual: () => false }),
            combine: () => Result.ok({ isEqual: () => false }),
        },
        writable: true,
        configurable: true,
    });

    return {
        app,
        doc,
        view,
        dialog,
        restore: () => {
            PubSub.default.pub = originalPub as any;
            if (previous) Object.defineProperty(globalThis, "shapeFactory", previous);
            else delete (globalThis as any).shapeFactory;
        },
    };
}

function pointerEvent(x: number, y: number): PointerEvent {
    return { offsetX: x, offsetY: y, button: 0, shiftKey: false } as PointerEvent;
}

/** The same click, added to the selection instead of replacing it. */
function shiftPointerEvent(x: number, y: number): PointerEvent {
    return { ...pointerEvent(x, y), shiftKey: true } as PointerEvent;
}

/** Lets the command's awaited pick (and any awaited dialog) advance between clicks. */
async function tick() {
    for (let i = 0; i < 6; i++) await Promise.resolve();
}

function dialogInput(dialog: DialogCapture): HTMLInputElement {
    const el = dialog.content?.querySelector("input");
    expect(el).not.toBeNull();
    return el as HTMLInputElement;
}

function confirmDialog(dialog: DialogCapture, text: string): void {
    const confirm = (dialog.buttons ?? []).find((b) => b.content === "common.confirm");
    expect(confirm).toBeDefined();
    dialogInput(dialog).value = text;
    expect(confirm?.shouldClose?.()).toBe(true);
    confirm?.onclick?.();
}

function cancelDialog(dialog: DialogCapture): void {
    const cancel = (dialog.buttons ?? []).find((b) => b.content === "common.cancel");
    expect(cancel).toBeDefined();
    cancel?.onclick?.();
}

/**
 * Primes an option the way the command bar does: `beforeExecute` reads the value back
 * from the static cache, so one assigned on the instance would be overwritten by whatever
 * the last run saved. Returns the call that puts the cache back — the cache is shared by
 * every command, so a test that leaves a value in it changes the next test's run.
 */
function primeOption(name: string, value: unknown): () => void {
    const cache: Map<string, unknown> = (
        CancelableCommand as unknown as { _propertiesCache: Map<string, unknown> }
    )._propertiesCache;
    const had = cache.has(name);
    const previous = cache.get(name);
    cache.set(name, value);
    return () => {
        if (had) cache.set(name, previous);
        else cache.delete(name);
    };
}

/** Escape, which is how the tool is told to stop — it stays up after every placement. */
function pressEscape(handler: SketchEventHandler, view: IView) {
    handler.keyDown(view, { key: "Escape" } as KeyboardEvent);
}

// The mock view maps screen (x, y) to world (x - 400, 300 - y, 0) on the XY plane, one
// world unit per pixel: a line (0,0)–(100,0) spans screen x 400..500 along y 300.
describe("DimensionCommand", () => {
    test("registers the key the sketch ribbon points at, under its own icon", () => {
        const data = CommandStore.getComandData("dimension");
        expect(data?.key).toBe("dimension");
        expect(data?.icon).toBe("icon-dimension");
    });

    test("a line reads as its length, created before the dialog is confirmed", async () => {
        const { app, doc, view, dialog, restore } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 100, 0);
            editor.solve(true);
            const handler = doc.visual.eventHandler as SketchEventHandler;

            const run = new DimensionCommand().execute(app);
            handler.pointerDown(view, pointerEvent(450, 300)); // the line's middle: the entity itself
            await tick();
            handler.pointerDown(view, pointerEvent(450, 250)); // empty space: place it
            await tick();

            // the dimension exists and the dialog is open, before any confirm
            expect(dialogInput(dialog).value).toBe("100.00");
            const constraints = editor.solver.toData().constraints;
            expect(constraints.length).toBe(1);
            expect(constraints[0].kind).toBe(ConstraintKind.P2PDistance);
            expect(constraints[0].datum).toBeCloseTo(100);
            // both endpoints of that one line, so the dimension belongs to it
            expect(constraints[0].refs.map((ref) => ref.pointIndex)).toEqual([0, 1]);
            expect(new Set(constraints[0].refs.map((ref) => ref.entityId)).size).toBe(1);
            expect(node.data.constraints.length).toBe(0); // not committed until confirmed

            confirmDialog(dialog, "80");
            await tick();
            expect(editor.solver.toData().constraints[0].datum).toBeCloseTo(80);

            pressEscape(handler, view);
            await run;
            editor.exit();
        } finally {
            restore();
        }
    });

    test("a circle reads as a diameter, over a radius constraint", async () => {
        const { app, doc, view, dialog, restore } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addCircle(50, 0, 30);
            editor.solve(true);
            const handler = doc.visual.eventHandler as SketchEventHandler;

            const run = new DimensionCommand().execute(app);
            handler.pointerDown(view, pointerEvent(480, 300)); // on the rim, which is what picks a circle
            await tick();
            handler.pointerDown(view, pointerEvent(450, 200)); // place
            await tick();

            const constraints = editor.solver.toData().constraints;
            expect(constraints.length).toBe(1);
            // the constraint underneath is a radius — the sketch has no diameter kind
            expect(constraints[0].kind).toBe(ConstraintKind.Radius);
            expect(constraints[0].datum).toBeCloseTo(30);
            // ...and the reading is what carries the diameter
            expect(dialogInput(dialog).value).toBe("60.00");
            expect(constraints[0].display).toBe("diameter");

            // typing the diameter sets the radius: half of it reaches the constraint
            confirmDialog(dialog, "50");
            await tick();
            expect(editor.solver.toData().constraints[0].datum).toBeCloseTo(25);

            pressEscape(handler, view);
            await run;
            editor.exit();
        } finally {
            restore();
        }
    });

    test("two lines that meet at an angle read as the angle, not as a distance", async () => {
        const { app, doc, view, dialog, restore } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 100, 0);
            editor.solver.addLine(0, 0, 100, 100);
            editor.solve(true);
            const handler = doc.visual.eventHandler as SketchEventHandler;

            const run = new DimensionCommand().execute(app);
            handler.pointerDown(view, pointerEvent(450, 300)); // the horizontal line
            await tick();
            handler.pointerDown(view, pointerEvent(450, 250)); // the diagonal one
            await tick();
            handler.pointerDown(view, pointerEvent(460, 280)); // inside the 45° sector
            await tick();

            const constraints = editor.solver.toData().constraints;
            expect(constraints.length).toBe(1);
            expect(constraints[0].kind).toBe(ConstraintKind.Angle);
            expect(constraints[0].refs.length).toBe(4);
            expect(dialogInput(dialog).value).toBe("45.00");

            cancelDialog(dialog);
            await tick();
            pressEscape(handler, view);
            await run;
            editor.exit();
        } finally {
            restore();
        }
    });

    test("two points read as whichever distance the label is dragged into", async () => {
        const { app, doc, view, dialog, restore } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            // the endpoints are what will be picked, not the line. Its ends differ on both
            // axes by different amounts, so Δx, Δy and the aligned length cannot be mistaken
            // for one another — a square pair would pass whichever one a reading reached for.
            editor.solver.addLine(0, 0, 100, 40);
            editor.solve(true);
            const handler = doc.visual.eventHandler as SketchEventHandler;

            const run = new DimensionCommand().execute(app);

            /**
             * Both endpoints, then a placement. Placing consumes the selection, so each
             * reading has to be picked again — which is also what the loop is there for.
             */
            const dimension = async (label: [number, number]): Promise<ConstraintKind> => {
                handler.pointerDown(view, pointerEvent(400, 300)); // the (0,0) endpoint
                await tick();
                // the mock's `worldToScreen` does not flip y while its `screenToWorld` does,
                // and point hits go through the former and placements through the latter — so
                // a point off the y = 0 line is clicked at its unflipped y, an empty spot at
                // its flipped one. The endpoints sit at screen (400, 300) and (500, 340).
                handler.pointerDown(view, pointerEvent(500, 340)); // the (100,40) endpoint
                await tick();
                handler.pointerDown(view, pointerEvent(label[0] + 400, 300 - label[1]));
                await tick();
                const constraints = editor.solver.toData().constraints;
                return constraints[constraints.length - 1].kind;
            };

            // above the two points: the horizontal distance, Δx = 100
            expect(await dimension([40, 90])).toBe(ConstraintKind.HorizontalDistance);
            expect(dialogInput(dialog).value).toBe("100.00");
            confirmDialog(dialog, "100");
            await tick();

            // to the side: the vertical distance, Δy = 40
            expect(await dimension([150, 20])).toBe(ConstraintKind.VerticalDistance);
            expect(dialogInput(dialog).value).toBe("40.00");
            confirmDialog(dialog, "40");
            await tick();

            // dragged diagonally: the aligned distance, √(100² + 40²). It is what the
            // other two already fix, so the solve sends it in as a reference rather than
            // as a third constraint saying nothing new
            expect(await dimension([90, 60])).toBe(ConstraintKind.P2PDistance);

            const constraints = editor.solver.toData().constraints;
            expect(constraints.map((c) => c.kind)).toEqual([
                ConstraintKind.HorizontalDistance,
                ConstraintKind.VerticalDistance,
                ConstraintKind.P2PDistance,
            ]);
            expect(constraints[2].driven).toBe(true);
            expect(constraints[2].datum).toBeCloseTo(Math.hypot(100, 40), 1);
            pressEscape(handler, view);
            await run;
            editor.exit();
        } finally {
            restore();
        }
    });

    test("entities selected before the command ran seed it, so only placement is left", async () => {
        const { app, doc, view, dialog, restore } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 100, 0);
            editor.solve(true);
            const handler = doc.visual.eventHandler as SketchEventHandler;

            // a plain click with no command running is a selection
            handler.pointerDown(view, pointerEvent(450, 300));
            expect(editor.selectedEntityIds().length).toBe(1);

            const run = new DimensionCommand().execute(app);
            await tick();
            // the command consumed the selection rather than leaving it highlighted
            expect(editor.selectedEntityIds()).toEqual([]);

            handler.pointerDown(view, pointerEvent(450, 250)); // straight to placing
            await tick();

            expect(dialogInput(dialog).value).toBe("100.00");
            expect(editor.solver.toData().constraints[0].kind).toBe(ConstraintKind.P2PDistance);

            cancelDialog(dialog);
            await tick();
            pressEscape(handler, view);
            await run;
            editor.exit();
        } finally {
            restore();
        }
    });

    test("a preselection too long to read is handed back, and said so", async () => {
        const { app, doc, view, restore } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 100, 0);
            editor.solver.addLine(0, 0, 0, 100);
            editor.solver.addLine(0, 100, 100, 100);
            editor.solve(true);
            const handler = doc.visual.eventHandler as SketchEventHandler;

            const tips: string[] = [];
            const onTip = (key: I18nKeys) => tips.push(key);
            PubSub.default.sub("statusBarTip", onTip);
            try {
                handler.pointerDown(view, pointerEvent(450, 300));
                handler.pointerDown(view, shiftPointerEvent(400, 250));
                handler.pointerDown(view, shiftPointerEvent(450, 200));
                expect(editor.selectedEntityIds().length).toBe(3);

                const run = new DimensionCommand().execute(app);
                await tick();

                // three entities is one more than the inference table ever reads, so the
                // tool says why it did nothing and leaves the user's selection standing
                expect(tips).toContain("sketch.dimensionSelectionTooMany");
                expect(editor.selectedEntityIds().length).toBe(3);
                expect(editor.solver.toData().constraints).toEqual([]);

                pressEscape(handler, view);
                await run;
                editor.exit();
            } finally {
                PubSub.default.remove("statusBarTip", onTip);
            }
        } finally {
            restore();
        }
    });

    test("a preselection with no reading between them is handed back, and said so", async () => {
        const { app, doc, view, restore } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 100, 0);
            editor.solver.addCircle(200, 0, 30);
            editor.solve(true);
            const handler = doc.visual.eventHandler as SketchEventHandler;

            const tips: string[] = [];
            const onTip = (key: I18nKeys) => tips.push(key);
            PubSub.default.sub("statusBarTip", onTip);
            try {
                // a line against a circle: the only distance a circle offers is to its
                // center, which the user can pick directly — so there is no reading here
                handler.pointerDown(view, pointerEvent(450, 300));
                handler.pointerDown(view, shiftPointerEvent(600, 270));
                expect(editor.selectedEntityIds().length).toBe(2);

                const run = new DimensionCommand().execute(app);
                await tick();

                expect(tips).toContain("sketch.dimensionSelectionUnsupported");
                expect(editor.selectedEntityIds().length).toBe(2);
                expect(editor.solver.toData().constraints).toEqual([]);

                pressEscape(handler, view);
                await run;
                editor.exit();
            } finally {
                PubSub.default.remove("statusBarTip", onTip);
            }
        } finally {
            restore();
        }
    });

    test("cancelling the dialog rolls the dimension back out of the sketch", async () => {
        const { app, doc, view, dialog, restore } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 100, 0);
            editor.solve(true);
            const handler = doc.visual.eventHandler as SketchEventHandler;

            const run = new DimensionCommand().execute(app);
            handler.pointerDown(view, pointerEvent(450, 300));
            await tick();
            handler.pointerDown(view, pointerEvent(450, 250));
            await tick();

            const id = editor.solver.toData().constraints[0].id;
            expect(editor.dimensionAnchors.has(id)).toBe(true);

            cancelDialog(dialog);
            await tick();

            expect(editor.solver.toData().constraints).toEqual([]);
            expect(editor.dimensionAnchors.has(id)).toBe(false);

            pressEscape(handler, view);
            await run;
            editor.exit();
        } finally {
            restore();
        }
    });

    test("Escape throws away the picks before it ends the tool", async () => {
        const { app, doc, view, restore } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            const line = editor.solver.addLine(0, 0, 100, 0);
            editor.solve(true);
            const handler = doc.visual.eventHandler as SketchEventHandler;

            const run = new DimensionCommand().execute(app);
            handler.pointerDown(view, pointerEvent(450, 300));
            await tick();
            expect(editor.isPicking).toBe(true);

            // the first Escape drops the line and leaves the tool asking for another pick
            pressEscape(handler, view);
            await tick();
            expect(editor.isPicking).toBe(true);

            // ...and with nothing in hand, the next one ends it
            pressEscape(handler, view);
            await run;
            expect(editor.solver.toData().constraints).toEqual([]);
            expect(editor.solver.entity(line)).toBeDefined();
            editor.exit();
        } finally {
            restore();
        }
    });

    test("the tool's own option places a reference instead of a driving dimension", async () => {
        const { app, doc, view, restore } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 100, 0);
            editor.solve(true);
            const handler = doc.visual.eventHandler as SketchEventHandler;
            const free = editor.solver.dofs();

            const command = new DimensionCommand();
            // the command bar renders a boolean `@property` as a checkbox, so declaring
            // it is the whole of what makes the option appear (`CommandContext`)
            expect(PropertyUtils.getProperties(command).some((p) => p.name === "driven")).toBe(true);

            const dialogs: string[] = [];
            const onDialog = (title: string) => dialogs.push(title);
            PubSub.default.sub("showDialog", onDialog);
            const unprime = primeOption("driven", true);
            try {
                const run = command.execute(app);
                handler.pointerDown(view, pointerEvent(450, 300));
                await tick();
                handler.pointerDown(view, pointerEvent(450, 250));
                await tick();

                const constraint = editor.solver.toData().constraints[0];
                expect(constraint.driven).toBe(true);
                // it measures without holding anything, and nothing is asked: a reference
                // has no value of its own to type
                expect(editor.solver.dofs()).toBe(free);
                expect(dialogs).toEqual([]);

                pressEscape(handler, view);
                await run;
            } finally {
                unprime();
                PubSub.default.remove("showDialog", onDialog);
            }
            editor.exit();
        } finally {
            restore();
        }
    });

    test("a line measured twice becomes a reference rather than a duplicate", async () => {
        const { app, doc, view, dialog, restore } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            editor.solver.addLine(0, 0, 100, 0);
            editor.solve(true);
            const handler = doc.visual.eventHandler as SketchEventHandler;

            const run = new DimensionCommand().execute(app);
            handler.pointerDown(view, pointerEvent(450, 300));
            await tick();
            handler.pointerDown(view, pointerEvent(450, 250));
            await tick();
            confirmDialog(dialog, "100");
            await tick();

            expect(editor.solver.toData().constraints[0].driven).toBeUndefined();
            const free = editor.solver.dofs();

            const dialogs: string[] = [];
            const onDialog = (title: string) => dialogs.push(title);
            PubSub.default.sub("showDialog", onDialog);
            try {
                // The same line again. The reading is true either way — the sketch
                // already says it — so it arrives as a reference: no dialog, and the
                // dimension that does drive keeps its degree of freedom.
                handler.pointerDown(view, pointerEvent(450, 300));
                await tick();
                handler.pointerDown(view, pointerEvent(450, 250));
                await tick();

                expect(dialogs).toEqual([]);
                const constraints = editor.solver.toData().constraints;
                expect(constraints.length).toBe(2);
                expect(constraints[1].driven).toBe(true);
                expect(editor.solver.dofs()).toBe(free);
                // and the sketch is not left carrying a redundancy it did not have before
                expect(editor.diagnostics.redundant).toEqual([]);
            } finally {
                PubSub.default.remove("showDialog", onDialog);
            }

            pressEscape(handler, view);
            await run;
            editor.exit();
        } finally {
            restore();
        }
    });

    test("a reading the sketch already implies becomes a reference", async () => {
        const { app, doc, view, restore } = setup();
        try {
            const node = new SketchNode({ document: doc, plane: Plane.XY });
            const editor = SketchEditor.enter(node);
            const line = editor.solver.addLine(0, 0, 100, 0);
            const refs = [
                { entityId: line, pointIndex: 0 },
                { entityId: line, pointIndex: 1 },
            ];
            // horizontal, and 100 long: a horizontal *distance* of 100 between the same
            // two points is a different kind saying exactly what these two already say
            editor.solver.addConstraint({ kind: ConstraintKind.Horizontal, refs });
            editor.solver.addConstraint({ kind: ConstraintKind.P2PDistance, refs, datum: 100 });
            editor.solve(true);
            const handler = doc.visual.eventHandler as SketchEventHandler;

            const dialogs: string[] = [];
            const onDialog = (title: string) => dialogs.push(title);
            PubSub.default.sub("showDialog", onDialog);
            try {
                const run = new DimensionCommand().execute(app);
                handler.pointerDown(view, pointerEvent(400, 300));
                await tick();
                handler.pointerDown(view, pointerEvent(500, 300));
                await tick();
                handler.pointerDown(view, pointerEvent(450, 200)); // placed above: Δx
                await tick();

                const constraints = editor.solver.toData().constraints;
                expect(constraints.length).toBe(3);
                expect(constraints[2].kind).toBe(ConstraintKind.HorizontalDistance);
                expect(constraints[2].driven).toBe(true);
                expect(dialogs).toEqual([]);
                expect(editor.diagnostics.redundant).toEqual([]);

                pressEscape(handler, view);
                await run;
            } finally {
                PubSub.default.remove("showDialog", onDialog);
            }
            editor.exit();
        } finally {
            restore();
        }
    });
});
