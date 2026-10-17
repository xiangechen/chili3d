// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    BoundingBox,
    type IApplication,
    Matrix4,
    PubSub,
    Result,
    type ShapeType,
    ShapeTypes,
    XYZ,
} from "@chili3d/core";
import {
    createHandlerMockView,
    createMockApplication,
    createMockSelection,
    createMockVisualWithDocument,
    nearestOnSegment,
    setupShapeFactoryMock,
    TestDocument,
} from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import "../../src/features"; // registers all feature handlers
import {
    CircularPatternFeatureCommand,
    Direction2Step,
    LinearPatternFeatureCommand,
} from "../../src/commands/patternCommand";
import type {
    PatternDragHandler,
    PatternPreviewHandler,
    PatternSessionStep,
} from "../../src/commands/patternSession";
import badgeStyle from "../../src/commands/patternSession.module.css";
import { ParametricBodyNode } from "../../src/parametricBodyNode";

/** The primitive box every test bodies: (0,0,0)–(10,10,5), so its centre is (5,5,2.5). */
const BOX = () => new BoundingBox({ x: 0, y: 0, z: 0 }, { x: 10, y: 10, z: 5 });

/** A probe point with no symmetry about any test axis, so rotations are distinguishable. */
const PROBE = new XYZ({ x: 3, y: 7, z: 2 });

const fakeMesh = () => ({
    range: [],
    index: new Uint32Array(),
    position: new Float32Array(),
    normal: new Float32Array(),
    uv: new Float32Array(),
});

/** A solid the tests read back: bbox + meshes, and copies that remember their matrix. */
function solidShape(): any {
    const self: any = {
        shapeType: ShapeTypes.solid,
        isEqual: () => false,
        dispose: rs.fn(),
        findSubShapes: () => [],
        boundingBox: BOX,
        mesh: { faces: fakeMesh(), edges: fakeMesh() },
        transformedMul: rs.fn((matrix: Matrix4) => {
            const copy = solidShape();
            copy.transformedBy = matrix;
            return copy;
        }),
    };
    return self;
}

/** The arrow's mesh shapes — only `mesh.faces` is read (arrowHandle.ts). */
const arrowShape = () => ({
    isOk: true,
    value: { mesh: { faces: { range: [], position: new Float32Array() } }, dispose: () => {} },
});

/** A line edge mock — the fields `captureEdgeRef` and the command's `worldLine` read. */
function edge(start: XYZ, end: XYZ) {
    const self: any = {
        shapeType: ShapeTypes.edge,
        curve: {
            basisCurve: { direction: { x: end.x - start.x, y: end.y - start.y, z: end.z - start.z } },
            nearestFromPoint: (point: XYZ) => nearestOnSegment(start, end, point),
        },
        startPoint: () => start,
        endPoint: () => end,
        firstParameter: () => 0,
        lastParameter: () => 1,
        pointAt: (t: number) => start.add(end.sub(start).multiply(t)),
        intersect: () => [],
        boundingBox: () =>
            new BoundingBox(
                { x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), z: Math.min(start.z, end.z) },
                { x: Math.max(start.x, end.x), y: Math.max(start.y, end.y), z: Math.max(start.z, end.z) },
            ),
        isEqual: () => false,
        findSubShapes: (type: ShapeType) => (type === ShapeTypes.edge ? [self] : []),
    };
    return self;
}

/** The reference-edge pick, self-sourced on the body with the identity transform. */
function edgePick(body: ParametricBodyNode, picked: any) {
    return {
        shape: picked,
        owner: { node: body },
        transform: Matrix4.identity(),
        indexes: [0],
        point: picked.startPoint(),
    } as any;
}

/** The +X edge along the box's bottom front — the linear tests' direction reference. */
const directionPick = (body: ParametricBodyNode) =>
    edgePick(body, edge(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 10, y: 0, z: 0 })));

/** The +Z axis through the origin — the circular tests' rotation axis; the box's centre is √50 off it. */
const axisPick = (body: ParametricBodyNode) =>
    edgePick(body, edge(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 0, y: 0, z: 5 })));

/** One captured `view.htmlText` call — the badge the session asked for. */
interface CapturedBadge {
    text: string;
    position: { x: number; y: number; z: number };
    options: any;
    element: HTMLElement;
    disposed: boolean;
}

function setup() {
    const app = createMockApplication();
    const doc = new TestDocument({ application: app });
    doc.visual = createMockVisualWithDocument(doc) as any;
    doc.selection = createMockSelection();
    const view = createHandlerMockView({ document: doc });
    // capture the canvas badges the way `sketchBadges.ts` does: real elements, real events
    const badges: CapturedBadge[] = [];
    (view as any).htmlText = rs.fn(
        (text: string, position: { x: number; y: number; z: number }, options: any) => {
            const element = document.createElement("div");
            element.textContent = text;
            if (options?.className) element.className = options.className;
            document.body.appendChild(element);
            const badge: CapturedBadge = {
                text,
                position: { ...position },
                options,
                element,
                disposed: false,
            };
            badges.push(badge);
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
    (app as any).activeView = view;
    const body = new ParametricBodyNode({
        document: doc,
        features: [{ id: "f1", type: "primitive", primitive: "box", dx: 10, dy: 10, dz: 5 } as any],
    });
    doc.modelManager.addNode(body);
    const booleanFuse = rs.fn((_s1: any[], _tools: any[], _simplify: boolean) => Result.ok(solidShape()));
    const cylinder = rs.fn(arrowShape);
    const cone = rs.fn(arrowShape);
    setupShapeFactoryMock({
        box: rs.fn(() => Result.ok(solidShape())),
        booleanFuse,
        cylinder,
        cone,
    });
    const displayMesh = rs.fn(() => 0);
    (doc.visual.context as any).displayMesh = displayMesh;
    const removeMesh = rs.fn();
    (doc.visual.context as any).removeMesh = removeMesh;
    return { app, doc, view, body, booleanFuse, displayMesh, removeMesh, cylinder, cone, badges };
}

type AnyPatternCommand = LinearPatternFeatureCommand | CircularPatternFeatureCommand;

function seedPicks(
    cmd: AnyPatternCommand,
    app: IApplication,
    body: ParametricBodyNode,
    picked: any,
    picked2?: any,
) {
    (cmd as any)._application = app;
    (cmd as any).stepDatas = [
        { nodes: [body], shapes: [], type: "pick" },
        { shapes: [picked], nodes: [], type: "pick" },
        // Direction 2's slot: empty reads as the pick being skipped (a circular keeps none).
        { shapes: picked2 === undefined ? [] : [picked2], nodes: [], type: "pick" },
        {},
    ];
}

/**
 * Runs the last step with a picker that captures the live handler and settles when the
 * controller does — the test then drives the handler (or the panel) and confirms or cancels.
 */
function openSession(doc: TestDocument, cmd: AnyPatternCommand) {
    let captured: PatternPreviewHandler | PatternDragHandler | undefined;
    doc.picker = {
        pickAsync: rs.fn(
            (
                handler: PatternPreviewHandler | PatternDragHandler,
                _prompt: any,
                controller: AsyncController,
            ) => {
                captured = handler;
                return new Promise<void>((resolve) => {
                    controller.onCompleted(() => resolve());
                    controller.onCancelled(() => resolve());
                    controller.onFailed(() => resolve());
                });
            },
        ),
    } as any;
    // The session step is always the last — a linear run grows the Direction-2 pick before it.
    const steps = (cmd as any).getSteps();
    const step = steps[steps.length - 1] as PatternSessionStep;
    const controller = new AsyncController();
    const promise = step.execute(doc, controller);
    if (captured === undefined) throw new Error("the session never opened");
    return { controller, promise, handler: captured };
}

/** displayMesh calls drawing ghosts — the previews are the only half-opacity meshes. */
function ghostCalls(displayMesh: ReturnType<typeof rs.fn>) {
    return displayMesh.mock.calls.filter((call) => call[1]?.meshOpacity === 0.5).length;
}

/** Captures the datum dialog a badge's double-click publishes (through `showDialog`). */
function captureDialog() {
    let dialog: { title: string; content: HTMLElement; buttons: any[] } | undefined;
    const pub = rs.spyOn(PubSub.default, "pub").mockImplementation((channel: string, ...args: any[]) => {
        if (channel === "showDialog") dialog = { title: args[0], content: args[1], buttons: args[2] };
    });
    return {
        get dialog() {
            return dialog;
        },
        restore: () => pub.mockRestore(),
    };
}

const doubleClick = (badge: CapturedBadge) =>
    badge.element.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));

function expectPoint(point: { x: number; y: number; z: number }, x: number, y: number, z: number) {
    expect(point.x).toBeCloseTo(x);
    expect(point.y).toBeCloseTo(y);
    expect(point.z).toBeCloseTo(z);
}

/** The fused tools' recorded matrices match the preview's placements, probed at two points. */
function expectSamePlacements(preview: Matrix4[], tools: any[]) {
    expect(tools).toHaveLength(preview.length);
    for (let i = 0; i < preview.length; i++) {
        for (const probe of [XYZ.zero, PROBE]) {
            const committed = (tools[i].transformedBy as Matrix4).ofPoint(probe);
            const ghost = preview[i].ofPoint(probe);
            expectPoint(committed, ghost.x, ghost.y, ghost.z);
        }
    }
}

describe("linear pattern preview", () => {
    test("opens on ghosts alone — no arrow, no badges — with the auto spacing converged onto the panel", () => {
        const { app, doc, body, displayMesh, removeMesh, cylinder, cone, badges } = setup();
        const cmd = new LinearPatternFeatureCommand();
        seedPicks(cmd, app, body, directionPick(body));
        expect(cmd.spacing).toBe("");

        openSession(doc, cmd);

        // The box spreads 10 along +X; auto is the extent plus a fifth, converged onto the panel.
        expect(cmd.spacing).toBe(12);
        // Count 3: two ghost copies, faces + edges each — and nothing else on the canvas.
        expect(ghostCalls(displayMesh)).toBe(4);
        expect(cylinder).not.toHaveBeenCalled();
        expect(cone).not.toHaveBeenCalled();
        expect(badges).toHaveLength(0);
        expect(removeMesh).not.toHaveBeenCalled();
    });

    test("the preview's placements are the ones the committed feature rebuilds", async () => {
        const { app, doc, body, booleanFuse } = setup();
        const cmd = new LinearPatternFeatureCommand();
        seedPicks(cmd, app, body, directionPick(body));
        const { controller, promise, handler } = openSession(doc, cmd);
        const preview = handler.placements(3, 12);

        (handler as any).confirm();
        const result = await promise;
        expect(controller.result?.status).toBe("success");
        expect(result?.type).toBe("input");

        (cmd as any).executeMainTask();
        expect(booleanFuse).toHaveBeenCalledTimes(1);
        expectSamePlacements(preview, booleanFuse.mock.calls[0][1] as any[]);
    });

    test("the panel's edits re-ghost the preview", () => {
        const { app, doc, body, displayMesh } = setup();
        const cmd = new LinearPatternFeatureCommand();
        seedPicks(cmd, app, body, directionPick(body));
        openSession(doc, cmd);
        expect(ghostCalls(displayMesh)).toBe(4);

        // A spacing edit reghosts the same copies; a count edit reghosts more of them.
        cmd.spacing = 30;
        expect(ghostCalls(displayMesh)).toBe(8);
        cmd.count = 5;
        expect(ghostCalls(displayMesh)).toBe(16);
    });

    test("an unresolvable expression never reaches the preview; the commit's validation reports it", async () => {
        const { app, doc, body, displayMesh } = setup();
        const cmd = new LinearPatternFeatureCommand();
        seedPicks(cmd, app, body, directionPick(body));
        const { promise, handler } = openSession(doc, cmd);
        expect(ghostCalls(displayMesh)).toBe(4);

        cmd.spacing = "1 +";
        expect(ghostCalls(displayMesh)).toBe(4);
        // The preview's own numbers are still committable — the panel's toast is the report.
        expect((handler as any).canConfirm()).toBe(true);

        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            (handler as any).confirm();
            await promise;
            (cmd as any).executeMainTask();
            expect(body.features).toHaveLength(1);
            expect(pub.mock.calls.some((call) => call[0] === "showToast")).toBe(true);
        } finally {
            pub.mockRestore();
        }
    });

    test("the confirm gate wants a whole count of at least two and a non-zero spacing", () => {
        const { app, doc, body } = setup();
        const cmd = new LinearPatternFeatureCommand();
        seedPicks(cmd, app, body, directionPick(body));
        const { handler } = openSession(doc, cmd);
        expect((handler as any).canConfirm()).toBe(true);

        cmd.count = 1;
        expect((handler as any).canConfirm()).toBe(false);
        cmd.count = 2.5;
        expect((handler as any).canConfirm()).toBe(false);
        cmd.count = 3;
        expect((handler as any).canConfirm()).toBe(true);

        cmd.spacing = 0;
        expect((handler as any).canConfirm()).toBe(false);
    });

    test("the committed feature carries the panel's values", async () => {
        const { app, doc, body, booleanFuse } = setup();
        const cmd = new LinearPatternFeatureCommand();
        seedPicks(cmd, app, body, directionPick(body));
        const { promise, handler } = openSession(doc, cmd);
        cmd.spacing = 25;
        cmd.count = 4;

        (handler as any).confirm();
        await promise;
        (cmd as any).executeMainTask();

        expect(body.features).toHaveLength(2);
        const feature = body.features[1] as any;
        expect(feature.type).toBe("pattern");
        expect(feature.mode).toBe("linear");
        expect(feature.spacing).toBe(25);
        expect(feature.count).toBe(4);
        expectSamePlacements(handler.placements(4, 25), booleanFuse.mock.calls[0][1] as any[]);
    });

    test("ESC cancels the preview: no feature lands, the ghosts come down", async () => {
        const { app, doc, body, booleanFuse, displayMesh, removeMesh } = setup();
        const cmd = new LinearPatternFeatureCommand();
        seedPicks(cmd, app, body, directionPick(body));
        const { controller, promise } = openSession(doc, cmd);
        expect(ghostCalls(displayMesh)).toBe(4);

        controller.cancel();
        const result = await promise;

        expect(result).toBeUndefined();
        expect(body.features).toHaveLength(1);
        expect(booleanFuse).not.toHaveBeenCalled();
        expect((cmd as any).session).toBeUndefined();
        expect(removeMesh).toHaveBeenCalledTimes(4);
    });
});

describe("circular pattern drag session", () => {
    test("sits the turn handle on the rim the centre sweeps, reading arc length as degrees", () => {
        const { app, doc, body } = setup();
        const cmd = new CircularPatternFeatureCommand();
        seedPicks(cmd, app, body, axisPick(body));
        const { handler } = openSession(doc, cmd);

        const radius = Math.sqrt(50);
        const axis = (handler as any).axis() as { origin: XYZ; normal: XYZ };
        expectPoint(axis.origin, 5, 5, 2.5);
        expect(axis.normal.length()).toBeCloseTo(180 / (Math.PI * radius));
        // The default 360° opens committable.
        expect((handler as any).canConfirm()).toBe(true);
    });

    test("an axis through the centre puts the handle on a minimum rim off it", () => {
        const { app, doc, body } = setup();
        const cmd = new CircularPatternFeatureCommand();
        seedPicks(
            cmd,
            app,
            body,
            edgePick(body, edge(new XYZ({ x: 5, y: 5, z: 0 }), new XYZ({ x: 5, y: 5, z: 5 }))),
        );
        const { handler } = openSession(doc, cmd);

        // The bbox diagonal is 15, so the fallback rim has radius 7.5 along +X from the axis.
        const axis = (handler as any).axis() as { origin: XYZ; normal: XYZ };
        expectPoint(axis.origin, 12.5, 5, 2.5);
        expect(axis.normal.length()).toBeCloseTo(180 / (Math.PI * 7.5));
    });

    test("the preview's placements are the ones the committed feature rebuilds", async () => {
        const { app, doc, body, booleanFuse } = setup();
        const cmd = new CircularPatternFeatureCommand();
        seedPicks(cmd, app, body, axisPick(body));
        const { promise, handler } = openSession(doc, cmd);
        cmd.count = 4;
        const preview = handler.placements(4, 360);

        (handler as any).confirm();
        await promise;
        (cmd as any).executeMainTask();

        expectSamePlacements(preview, booleanFuse.mock.calls[0][1] as any[]);
        const feature = body.features[1] as any;
        expect(feature.mode).toBe("circular");
        expect(feature.angle).toBe(360);
        expect(feature.equalSpacing).toBe(true);
    });

    test("the panel's equalSpacing re-spreads the live session", () => {
        const { app, doc, body } = setup();
        const cmd = new CircularPatternFeatureCommand();
        seedPicks(cmd, app, body, axisPick(body));
        const { handler } = openSession(doc, cmd);

        const even = handler.placements(4, 360).map((m) => m.ofPoint(PROBE));
        cmd.equalSpacing = false;
        const spread = handler.placements(4, 360).map((m) => m.ofPoint(PROBE));

        // Even: 90/180/270; spread-to-ends: 120/240/360 — the last a full turn, back on the probe.
        expectPoint(spread[2], PROBE.x, PROBE.y, PROBE.z);
        expect(even[2].x).not.toBeCloseTo(PROBE.x);
    });

    test("the committed feature carries the dragged angle", async () => {
        const { app, doc, body, booleanFuse } = setup();
        const cmd = new CircularPatternFeatureCommand();
        seedPicks(cmd, app, body, axisPick(body));
        const { promise, handler } = openSession(doc, cmd);

        (handler as any).setCurrentValue(180);
        expect(cmd.angle).toBe(180);
        (handler as any).confirm();
        await promise;
        (cmd as any).executeMainTask();

        const feature = body.features[1] as any;
        expect(feature.mode).toBe("circular");
        expect(feature.angle).toBe(180);
        expectSamePlacements(handler.placements(3, 180), booleanFuse.mock.calls[0][1] as any[]);
    });
});

describe("circular pattern session badges", () => {
    test("the angle sits at mid-swing, the count at the last copy", () => {
        const { app, doc, body, badges } = setup();
        const cmd = new CircularPatternFeatureCommand();
        seedPicks(cmd, app, body, axisPick(body));
        openSession(doc, cmd);

        expect(badges).toHaveLength(2);
        expect(badges[0].text).toBe("360.0°");
        // the rim point (5,5,2.5) swung half of 360° about the +Z axis through the origin
        expectPoint(badges[0].position, -5, -5, 2.5);
        expect(badges[1].text).toBe("×3");
        // the even spread's last copy sits at 360·2/3 = 240°
        expectPoint(badges[1].position, 1.8301, -6.8301, 2.5);
        for (const badge of badges) {
            expect(badge.options.interactive).toBe(true);
            expect(badge.options.hideDelete).toBe(true);
        }
    });

    test("the badges follow the value, redrawing on change and reusing on a repaint", () => {
        const { app, doc, view, body, badges } = setup();
        const cmd = new CircularPatternFeatureCommand();
        seedPicks(cmd, app, body, axisPick(body));
        const { handler } = openSession(doc, cmd);
        expect(badges).toHaveLength(2);

        // a drag frame's innards: a new value, then the repaint
        (handler as any).setCurrentValue(180);
        (handler as any).refreshTempShapes(view);
        expect(badges).toHaveLength(4);
        expect(badges[0].disposed).toBe(true);
        expect(badges[1].disposed).toBe(true);
        expect(badges[2].text).toBe("180.0°");
        expectPoint(badges[2].position, -5, 5, 2.5); // the rim point swung half of 180°
        expect(badges[3].text).toBe("×3");
        expectPoint(badges[3].position, -6.8301, 1.8301, 2.5); // the even spread's last at 120°

        // same text, same anchors: the repaint keeps the elements it has
        (handler as any).refreshTempShapes(view);
        expect(badges).toHaveLength(4);
        expect(badges[2].disposed).toBe(false);
        expect(badges[3].disposed).toBe(false);
    });

    test("the value dialog rejects an unresolvable expression and stays open", () => {
        const { app, doc, body, badges } = setup();
        const cmd = new CircularPatternFeatureCommand();
        seedPicks(cmd, app, body, axisPick(body));
        openSession(doc, cmd);
        const dialog = captureDialog();
        try {
            doubleClick(badges[0]);
            expect(dialog.dialog).toBeDefined();
            expect(dialog.dialog!.title).toBe("sketch.arrayAngle");
            const input = dialog.dialog!.content.querySelector("input");
            expect(input).not.toBeNull();

            input!.value = "1 +";
            expect(dialog.dialog!.buttons[0].shouldClose()).toBe(false);
            expect(cmd.angle).toBe(360);
        } finally {
            dialog.restore();
        }
    });

    test("double-clicking the count badge wants a whole number of at least two", () => {
        const { app, doc, body, badges, displayMesh } = setup();
        const cmd = new CircularPatternFeatureCommand();
        seedPicks(cmd, app, body, axisPick(body));
        const { handler } = openSession(doc, cmd);
        expect(ghostCalls(displayMesh)).toBe(4);
        const dialog = captureDialog();
        try {
            doubleClick(badges[1]);
            expect(dialog.dialog).toBeDefined();
            expect(dialog.dialog!.title).toBe("common.count");
            const input = dialog.dialog!.content.querySelector("input");
            expect(input).not.toBeNull();

            input!.value = "2.5";
            expect(dialog.dialog!.buttons[0].shouldClose()).toBe(false);
            expect(cmd.count).toBe(3);
            input!.value = "1";
            expect(dialog.dialog!.buttons[0].shouldClose()).toBe(false);
            expect(cmd.count).toBe(3);

            input!.value = "5";
            expect(dialog.dialog!.buttons[0].shouldClose()).toBe(true);
            expect(cmd.count).toBe(5); // back on the panel
            expect((handler as any)._count).toBe(5); // and in the session
            // the ghosts followed: four copies, faces + edges each
            expect(ghostCalls(displayMesh)).toBe(4 + 8);
        } finally {
            dialog.restore();
        }
    });

    test("double-clicking the angle badge edits the angle through the dialog, signs allowed", () => {
        const { app, doc, body, badges } = setup();
        const cmd = new CircularPatternFeatureCommand();
        seedPicks(cmd, app, body, axisPick(body));
        const { handler } = openSession(doc, cmd);
        const dialog = captureDialog();
        try {
            doubleClick(badges[0]);
            expect(dialog.dialog).toBeDefined();
            expect(dialog.dialog!.title).toBe("sketch.arrayAngle");
            const input = dialog.dialog!.content.querySelector("input");
            expect(input).not.toBeNull();

            // a negative angle runs the pattern the other way — the session and the panel both
            input!.value = "-90";
            expect(dialog.dialog!.buttons[0].shouldClose()).toBe(true);
            expect(cmd.angle).toBe(-90);
            expect((handler as any).currentValue()).toBe(-90);
        } finally {
            dialog.restore();
        }
    });

    test("the badges go inert while the arrow is hovered, and back", () => {
        const { app, doc, view, body, badges } = setup();
        const cmd = new CircularPatternFeatureCommand();
        seedPicks(cmd, app, body, axisPick(body));
        const { handler } = openSession(doc, cmd);

        expect(badges[0].element.classList.contains(badgeStyle.inert)).toBe(false);
        expect(badges[1].element.classList.contains(badgeStyle.inert)).toBe(false);
        (handler as any).setArrowHover(view, true);
        expect(badges[0].element.classList.contains(badgeStyle.inert)).toBe(true);
        expect(badges[1].element.classList.contains(badgeStyle.inert)).toBe(true);
        (handler as any).setArrowHover(view, false);
        expect(badges[0].element.classList.contains(badgeStyle.inert)).toBe(false);
        expect(badges[1].element.classList.contains(badgeStyle.inert)).toBe(false);
    });

    test("a confirm disposes every badge with the session", async () => {
        const { app, doc, body, badges } = setup();
        const cmd = new CircularPatternFeatureCommand();
        seedPicks(cmd, app, body, axisPick(body));
        const { promise, handler } = openSession(doc, cmd);
        expect(badges).toHaveLength(2);

        (handler as any).confirm();
        await promise;
        expect(badges.every((badge) => badge.disposed)).toBe(true);
    });
});

describe("linear pattern direction 2", () => {
    /** The +Y edge along the box's bottom side — the grid's second direction. */
    const direction2Pick = (body: ParametricBodyNode) =>
        edgePick(body, edge(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 0, y: 10, z: 0 })));

    const openGridSession = (
        doc: TestDocument,
        cmd: LinearPatternFeatureCommand,
        app: IApplication,
        body: ParametricBodyNode,
    ) => {
        seedPicks(cmd, app, body, directionPick(body), direction2Pick(body));
        return openSession(doc, cmd);
    };

    test("the direction-2 pick: Enter skips with an empty selection, Escape aborts the run", async () => {
        const { doc } = setup();
        const step = new Direction2Step();
        const clearSelection = rs.fn();
        (doc.selection as any).clearSelection = clearSelection;
        const pickShape = rs.fn((_prompt: any, _controller: any, _options: any) => Promise.resolve([]));
        doc.picker = { pickShape } as any;

        const skipped = await step.execute(doc, { result: { status: "success" } } as any);
        expect(skipped).toBeDefined();
        expect(skipped!.shapes).toHaveLength(0);
        expect(pickShape.mock.calls[0][0]).toBe("prompt.select.direction2Edge");

        const aborted = await step.execute(doc, { result: { status: "cancel" } } as any);
        expect(aborted).toBeUndefined();
        // the leftover selection of direction 1's keeping step is cleared on every entry
        expect(clearSelection).toHaveBeenCalledTimes(2);
    });

    test("the grid previews both directions and commits the trio", async () => {
        const { app, doc, body, booleanFuse, displayMesh, cylinder, badges } = setup();
        const cmd = new LinearPatternFeatureCommand();
        const { promise, handler } = openGridSession(doc, cmd, app, body);

        // both directions converge their auto spacing: the box spreads 10 along each
        expect(cmd.spacing).toBe(12);
        expect(cmd.spacing2).toBe(12);
        // a 3×2 grid: five ghost copies, faces + edges each — and still no arrow, no badges
        expect(ghostCalls(displayMesh)).toBe(10);
        expect(cylinder).not.toHaveBeenCalled();
        expect(badges).toHaveLength(0);

        const preview = handler.placements(3, 12);
        expect(preview).toHaveLength(5);
        (handler as any).confirm();
        await promise;
        (cmd as any).executeMainTask();

        expectSamePlacements(preview, booleanFuse.mock.calls[0][1] as any[]);
        const feature = body.features[1] as any;
        expect(feature.direction2).toBeDefined();
        expect(feature.count2).toBe(2);
        expect(feature.spacing2).toBe(12);
    });

    test("the panel drives both directions' ghosts, and the commit carries them", async () => {
        const { app, doc, body, displayMesh } = setup();
        const cmd = new LinearPatternFeatureCommand();
        const { promise, handler } = openGridSession(doc, cmd, app, body);
        expect(ghostCalls(displayMesh)).toBe(10);

        cmd.spacing = 20;
        expect(ghostCalls(displayMesh)).toBe(20); // the same five copies reghosted
        cmd.spacing2 = 30;
        expect(ghostCalls(displayMesh)).toBe(30);
        cmd.count2 = 4;
        expect(ghostCalls(displayMesh)).toBe(52); // a 3×4 grid: eleven copies, faces + edges each

        (handler as any).confirm();
        await promise;
        (cmd as any).executeMainTask();
        const feature = body.features[1] as any;
        expect(feature.spacing).toBe(20);
        expect(feature.spacing2).toBe(30);
        expect(feature.count).toBe(3);
        expect(feature.count2).toBe(4);
    });

    test("a skipped direction 2 commits a feature without the direction2 trio", async () => {
        const { app, doc, body } = setup();
        const cmd = new LinearPatternFeatureCommand();
        seedPicks(cmd, app, body, directionPick(body));
        const { promise, handler } = openSession(doc, cmd);

        (handler as any).confirm();
        await promise;
        (cmd as any).executeMainTask();

        const feature = body.features[1] as any;
        expect("direction2" in feature).toBe(false);
        expect("count2" in feature).toBe(false);
        expect("spacing2" in feature).toBe(false);
    });

    test("a direction 2 parallel to direction 1 is refused at the commit", async () => {
        const { app, doc, body } = setup();
        const cmd = new LinearPatternFeatureCommand();
        seedPicks(
            cmd,
            app,
            body,
            directionPick(body),
            edgePick(body, edge(new XYZ({ x: 0, y: 0, z: 5 }), new XYZ({ x: 10, y: 0, z: 5 }))),
        );
        const { promise, handler } = openSession(doc, cmd);

        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            (handler as any).confirm();
            await promise;
            (cmd as any).executeMainTask();
            expect(body.features).toHaveLength(1);
            expect(pub.mock.calls.some((call) => call[0] === "showToast")).toBe(true);
        } finally {
            pub.mockRestore();
        }
    });

    test("the preview opens hasDirection2 with the pick, so the panel shows the pair only then", () => {
        const { app, doc, body } = setup();
        const single = new LinearPatternFeatureCommand();
        seedPicks(single, app, body, directionPick(body));
        openSession(doc, single);
        expect((single as any).hasDirection2).toBe(false);

        const grid = new LinearPatternFeatureCommand();
        openGridSession(doc, grid, app, body);
        expect((grid as any).hasDirection2).toBe(true);
    });

    test("ESC cancels the grid preview: no feature lands, the ghosts come down", async () => {
        const { app, doc, body, booleanFuse, displayMesh, removeMesh } = setup();
        const cmd = new LinearPatternFeatureCommand();
        const { controller, promise } = openGridSession(doc, cmd, app, body);
        expect(ghostCalls(displayMesh)).toBe(10);

        controller.cancel();
        const result = await promise;

        expect(result).toBeUndefined();
        expect(body.features).toHaveLength(1);
        expect(booleanFuse).not.toHaveBeenCalled();
        expect((cmd as any).session).toBeUndefined();
        expect(removeMesh).toHaveBeenCalledTimes(10);
    });
});
