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
import { SketchEditor } from "../../src/sketch/editor/sketchEditor";
import { ConstraintKind, entityRadius, type RadiusDisplay } from "../../src/sketch/sketchModel";
import { SketchNode } from "../../src/sketch/sketchNode";
import "./setup";

interface MockBadge {
    text: string;
    element: HTMLElement;
}

type DialogCapture = { content?: HTMLElement; buttons?: DialogButton[] };

/**
 * A radius constraint presented as a diameter: the sketch has no diameter kind, so a
 * diameter is a radius read sideways — the reading rides on the constraint, which is
 * where the solver picks up the halving its datum needs.
 */
function setup(display: RadiusDisplay = "radius") {
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
    // the scope every expression datum resolves against; `w` is the diameter the tests type
    doc.variables.setItems([{ id: "v1", name: "w", type: "length", expression: "100" }]);
    doc.visual = createMockVisualWithDocument(doc) as any;
    const view = createMockView({ document: doc, cameraController: camera as unknown as ICameraController });
    (app as any).activeView = view;

    const badges: MockBadge[] = [];
    (view as any).htmlText = rs.fn((text: string, _position: unknown, options: any) => {
        const element = document.createElement("div");
        document.body.appendChild(element);
        const badge: MockBadge = { text, element };
        badges.push(badge);
        if (options?.interactive) {
            element.addEventListener("pointerdown", (e) => e.stopPropagation());
            element.addEventListener("pointerup", (e) => e.stopPropagation());
            if (options.onDoubleClick) element.addEventListener("dblclick", options.onDoubleClick);
        }
        options?.onCreated?.(element);
        return { dispose: rs.fn(() => element.remove()) };
    });
    (doc.visual.context as any).displayMesh = rs.fn(() => 1);
    (doc.visual.context as any).removeMesh = rs.fn();

    const dialog: DialogCapture = {};
    const originalPub = PubSub.default.pub as unknown as (key: string, ...args: any[]) => void;
    PubSub.default.pub = ((key: string, ...args: any[]) => {
        if (key === "showDialog") {
            [, dialog.content, dialog.buttons] = args as [I18nKeys, HTMLElement, DialogButton[]];
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

    const node = new SketchNode({ document: doc, plane: Plane.XY });
    const editor = SketchEditor.enter(node);
    const circle = editor.solver.addCircle(50, 0, 30);
    const id = editor.solver.addConstraint({
        kind: ConstraintKind.Radius,
        refs: [{ entityId: circle, pointIndex: 0 }],
        datum: 30,
        ...(display === "diameter" ? { display } : {}),
    });
    editor.dimensionAnchors.set(id, { kind: "vector", dx: 20, dy: 0 });
    editor.solve(true);
    // happy-dom needs a dom element for the label drag to read client coordinates against
    (view as any).dom = document.createElement("div");

    return {
        editor,
        node,
        id,
        circle,
        badges,
        dialog,
        restore: () => {
            PubSub.default.pub = originalPub as any;
            if (previous) Object.defineProperty(globalThis, "shapeFactory", previous);
            else delete (globalThis as any).shapeFactory;
        },
    };
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

const badgeTexts = (badges: MockBadge[]) => badges.map((b) => b.text);

/** The radius garlic currently holds for the circle — what the datum actually drove. */
function radiusOf(editor: SketchEditor, circleId: number): number {
    const entity = editor.solver.entity(circleId);
    if (entity === undefined) throw new Error(`no entity ${circleId}`);
    return entityRadius(entity);
}

describe("a diameter dimension", () => {
    test("reads as Ø over a radius constraint", () => {
        const { badges, editor, restore } = setup("diameter");
        try {
            expect(badgeTexts(badges)).toContain("Ø60.00");
            expect(editor.solver.toData().constraints[0].kind).toBe(ConstraintKind.Radius);
            expect(editor.solver.toData().constraints[0].datum).toBeCloseTo(30);
            editor.exit();
        } finally {
            restore();
        }
    });

    test("a constraint without the reading still shows a radius", () => {
        // absent has to mean radius: every other kind, and every archive written before
        // the reading existed, carries no display field at all
        const { badges, editor, restore } = setup();
        try {
            expect(badgeTexts(badges)).toContain("R30.00");
            expect(badgeTexts(badges)).not.toContain("Ø60.00");
            expect(editor.solver.toData().constraints[0].datum).toBeCloseTo(30);
            editor.exit();
        } finally {
            restore();
        }
    });

    test("dragging the label keeps it a diameter", () => {
        const { editor, id, badges, node, restore } = setup("diameter");
        try {
            // the last one is the live badge; earlier refreshes left disposed copies behind
            const badge = badges.filter((b) => b.text === "Ø60.00").at(-1);
            expect(badge).toBeDefined();
            // happy-dom rects are zero-origin, so client coordinates map straight to view offsets
            badge?.element.dispatchEvent(
                new MouseEvent("pointerdown", { clientX: 470, clientY: 300, button: 0, buttons: 1 }),
            );
            // dropped at uv (100, 100) — the vector is measured from the center at (50, 0).
            // `buttons: 1` is the button still being held: the drag treats a move with
            // none held as the release it never saw
            window.dispatchEvent(new MouseEvent("pointermove", { clientX: 500, clientY: 200, buttons: 1 }));
            window.dispatchEvent(new MouseEvent("pointerup", { clientX: 500, clientY: 200, buttons: 0 }));

            // rebuilt from the drop position, and still reading as a diameter — the reading
            // is not the anchor's to lose, so a drag cannot turn a Ø back into an R
            expect(editor.dimensionAnchors.get(id)).toEqual({ kind: "vector", dx: 50, dy: 100 });
            expect(node.data.anchors).toEqual([{ id, anchor: { kind: "vector", dx: 50, dy: 100 } }]);
            expect(editor.solver.toData().constraints[0].display).toBe("diameter");
            expect(badgeTexts(badges)).toContain("Ø60.00");
            editor.exit();
        } finally {
            restore();
        }
    });

    test("the dialog opens on the diameter and stores the radius", () => {
        const { editor, id, dialog, restore } = setup("diameter");
        try {
            editor.editDatum(id);
            // twice the stored radius: what the user reads is what they edit
            expect(dialogInput(dialog).value).toBe("60.00");

            confirmDialog(dialog, "50");
            // ...and half of what they typed is what the radius constraint keeps
            expect(editor.solver.toData().constraints[0].datum).toBeCloseTo(25);
            editor.exit();
        } finally {
            restore();
        }
    });

    test("a radius dimension still edits as the radius", () => {
        const { editor, id, dialog, restore } = setup();
        try {
            editor.editDatum(id);
            expect(dialogInput(dialog).value).toBe("30.00");

            confirmDialog(dialog, "50");
            expect(editor.solver.toData().constraints[0].datum).toBeCloseTo(50);
            editor.exit();
        } finally {
            restore();
        }
    });
});

describe("a diameter written as an expression", () => {
    // `w` is 100, so a diameter dimension reading Øw means a radius of 50.
    test("stores the radius the expression names, and reads back as written", () => {
        const { editor, id, circle, badges, dialog, restore } = setup("diameter");
        try {
            editor.editDatum(id);
            confirmDialog(dialog, "w");

            expect(editor.solver.toData().constraints[0].datum).toBe("w");
            expect(editor.solver.toData().constraints[0].display).toBe("diameter");
            // the radius garlic holds is half the expression's 100
            expect(radiusOf(editor, circle)).toBeCloseTo(50, 6);
            expect(badgeTexts(badges)).toContain("w");
            editor.exit();
        } finally {
            restore();
        }
    });

    test("re-opening it and confirming unchanged leaves the radius alone", () => {
        const { editor, id, circle, dialog, restore } = setup("diameter");
        try {
            editor.editDatum(id);
            confirmDialog(dialog, "w");

            // what the dialog opens on is what the user wrote — not the halved storage
            editor.editDatum(id);
            expect(dialogInput(dialog).value).toBe("w");
            confirmDialog(dialog, dialogInput(dialog).value);

            expect(editor.solver.toData().constraints[0].datum).toBe("w");
            expect(radiusOf(editor, circle)).toBeCloseTo(50, 6);
            editor.exit();
        } finally {
            restore();
        }
    });

    test("a radius expression is stored and read exactly as written", () => {
        const { editor, id, circle, badges, dialog, restore } = setup();
        try {
            editor.editDatum(id);
            confirmDialog(dialog, "w");

            expect(editor.solver.toData().constraints[0].datum).toBe("w");
            expect(radiusOf(editor, circle)).toBeCloseTo(100, 6);
            expect(badgeTexts(badges)).toContain("w");

            editor.editDatum(id);
            expect(dialogInput(dialog).value).toBe("w");
            editor.exit();
        } finally {
            restore();
        }
    });
});
