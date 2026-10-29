// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    ARROW_COLOR,
    ARROW_HOVER_COLOR,
    AsyncController,
    BoundingBox,
    CancelableCommand,
    type IApplication,
    type IView,
    type IVisualObject,
    Matrix4,
    PubSub,
    Ray,
    Result,
    type ShapeType,
    ShapeTypes,
    Signal,
    VisualStates,
    XY,
    XYZ,
} from "@chili3d/core";
import {
    createHandlerMockView,
    createMockApplication,
    createMockHighlighter,
    createMockSelection,
    createMockVisualWithDocument,
    createPointerEvent,
    nearestOnSegment,
    setupShapeFactoryMock,
    TestDocument,
} from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import "../../src/features"; // registers all feature handlers
import {
    CircularPatternFeatureCommand,
    CurvePatternFeatureCommand,
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

/** A line edge mock — the fields `captureEdgeRef`, `worldLine` and the path sampler read. */
function edge(start: XYZ, end: XYZ) {
    const direction = end.sub(start);
    const length = direction.length();
    const self: any = {
        shapeType: ShapeTypes.edge,
        curve: {
            basisCurve: { direction: { x: end.x - start.x, y: end.y - start.y, z: end.z - start.z } },
            nearestFromPoint: (point: XYZ) => nearestOnSegment(start, end, point),
            uniformAbscissaByCount: (count: number) =>
                Array.from({ length: count + 1 }, (_, index) => start.add(direction.multiply(index / count))),
            parameter: (point: XYZ) =>
                length === 0 ? undefined : point.sub(start).dot(direction) / (length * length),
            value: (parameter: number) => start.add(direction.multiply(parameter)),
            d1: (parameter: number) => ({
                point: start.add(direction.multiply(parameter)),
                vec: direction,
            }),
            period: () => 0,
            isPeriodic: () => false,
        },
        length: () => length,
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
    // ids are unique so a re-colour can be told apart from a re-draw: the arrows are drawn
    // once and then only recoloured (`setMeshColor`), and both land in `paintLog`
    let meshId = 0;
    const paintLog: { id: number; color: number | undefined }[] = [];
    const displayMesh = rs.fn((datas: any[], options: any) => {
        const id = ++meshId;
        if (options?.meshOpacity === 1) paintLog.push({ id, color: datas[0]?.color });
        return id;
    });
    (doc.visual.context as any).displayMesh = displayMesh;
    const setMeshColor = rs.fn((id: number, color: number) => paintLog.push({ id, color }));
    (doc.visual.context as any).setMeshColor = setMeshColor;
    const removeMesh = rs.fn();
    (doc.visual.context as any).removeMesh = removeMesh;
    return {
        app,
        doc,
        view,
        body,
        booleanFuse,
        displayMesh,
        setMeshColor,
        paintLog,
        removeMesh,
        cylinder,
        cone,
        badges,
    };
}

type AnyPatternCommand =
    | LinearPatternFeatureCommand
    | CircularPatternFeatureCommand
    | CurvePatternFeatureCommand;

function seedPicks(cmd: AnyPatternCommand, app: IApplication, body: ParametricBodyNode, picked: any) {
    seedShapePicks(cmd, app, body, [picked]);
}

function seedShapePicks(cmd: AnyPatternCommand, app: IApplication, body: ParametricBodyNode, picked: any[]) {
    (cmd as any)._application = app;
    (cmd as any).stepDatas = [
        { nodes: [body], shapes: [], type: "pick" },
        { shapes: picked, nodes: [], type: "pick" },
        {},
    ];
}

/** The second-direction pick's stub: what the nested `pickShape` reports and how it settles. */
type Direction2PickStub = (controller: AsyncController) => Promise<any[]>;

/**
 * Runs the last step with a picker that captures the live handler and settles when the
 * controller does — the test then drives the handler (or the panel) and confirms or cancels.
 * `pickShape` is the nested second-direction pick, only reachable once the preview is up.
 */
function openSession(doc: TestDocument, cmd: AnyPatternCommand, pickShape?: Direction2PickStub) {
    let captured: PatternPreviewHandler | PatternDragHandler | undefined;
    doc.picker = {
        ...(pickShape === undefined ? {} : { pickShape: rs.fn((_p: any, c: any) => pickShape(c)) }),
        pickAsync: rs.fn(
            (
                handler: PatternPreviewHandler | PatternDragHandler,
                _prompt: any,
                controller: AsyncController,
            ) => {
                captured = handler;
                // The real picker installs the handler before its first await and puts the
                // previous one back when the session settles — emulate both, so a nested pick
                // started at the wrong moment is visible to the tests (it would run while
                // this handler is NOT the event target, and the outer install would cover it).
                const previous = (doc.visual as any).eventHandler;
                (doc.visual as any).eventHandler = handler;
                let resolve!: () => void;
                const done = new Promise<void>((r) => (resolve = r));
                const settle = () => {
                    if ((doc.visual as any).eventHandler === handler) {
                        (doc.visual as any).eventHandler = previous;
                    }
                    resolve();
                };
                controller.onCompleted(settle);
                controller.onCancelled(settle);
                controller.onFailed(settle);
                return done;
            },
        ),
    } as any;
    // The session step is always the last: body → edge → session.
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

/** The colour the arrows were last drawn OR recoloured with — both land in the paint log. */
function lastArrowColor(paintLog: { color: number | undefined }[]) {
    return paintLog.at(-1)?.color;
}

/** A view whose camera controller can be fired, for the zoom/pan path. */
function cameraDrivenView(doc: TestDocument) {
    const listeners = new Set<() => void>();
    const view = createHandlerMockView({
        document: doc,
        cameraController: {
            onPropertyChanged: (cb: () => void) => listeners.add(cb),
            removePropertyChanged: (cb: () => void) => listeners.delete(cb),
        } as any,
    });
    return { view, fire: () => listeners.forEach((cb) => cb()) };
}

/** Captures the numeric box a typed digit publishes (through `showInput`). */
function captureInput() {
    let apply: ((text: string) => Result<string, any>) | undefined;
    const pub = rs.spyOn(PubSub.default, "pub").mockImplementation((channel: string, ...args: any[]) => {
        if (channel === "showInput") apply = args[1];
    });
    return {
        get apply() {
            return apply;
        },
        restore: () => pub.mockRestore(),
    };
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

/**
 * Aim the view's rays along -Z through the body's centre plane (z = 2.5, y = 5): a ray at
 * screen `x` meets the +X arrow's own line, so its projection reads `x - 405`.
 */
function raysAlongX(view: IView) {
    (view as any).rayAt = (mx: number) =>
        new Ray({ point: new XYZ({ x: mx - 400, y: 5, z: 2.5 }), direction: XYZ.unitZ.reverse() });
}

const escapeKey = () =>
    ({ key: "Escape", preventDefault: () => {}, stopImmediatePropagation: () => {} }) as KeyboardEvent;

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
    test("this command ghosts its target for the edge pick, and puts it back when the run ends", () => {
        const { app, doc, body } = setup();
        const { highlighter, addCalls, removeCalls } = createMockHighlighter();
        const visual = {} as IVisualObject;
        (doc.visual as any).highlighter = highlighter;
        (doc.visual.context as any).getVisual = () => visual;
        const cmd = new LinearPatternFeatureCommand();
        seedPicks(cmd, app, body, directionPick(body));

        // the edge step's own hook: the node selection's whole outline becomes a ghost tint
        (cmd as any).getSteps()[1].options.beforeSelection();
        expect(removeCalls.map((call) => call.state)).toContain(VisualStates.edgeSelected);
        expect(addCalls).toContainEqual({
            shape: visual,
            state: VisualStates.faceTransparent,
            type: ShapeTypes.shape,
            indexes: [],
        });

        // `afterExecute` saves the command's options into the process-wide cache; whatever
        // this test adds goes with it, or the next test reads a stale spacing/count.
        const cache = (CancelableCommand as unknown as { _propertiesCache: Map<string, unknown> })
            ._propertiesCache;
        const before = new Set(cache.keys());
        try {
            (cmd as any).afterExecute();
            expect(removeCalls.at(-1)?.state).toBe(VisualStates.faceTransparent);
        } finally {
            for (const key of cache.keys()) {
                if (!before.has(key)) cache.delete(key);
            }
        }
    });

    test("opens on the ghosts plus one spacing arrow, the auto spacing converged onto the panel", () => {
        const { app, doc, body, displayMesh, removeMesh, cylinder, cone, badges } = setup();
        const cmd = new LinearPatternFeatureCommand();
        seedPicks(cmd, app, body, directionPick(body));
        expect(cmd.spacing).toBe("");

        openSession(doc, cmd);

        // The box spreads 10 along +X; auto is the extent plus a fifth, converged onto the panel.
        expect(cmd.spacing).toBe(12);
        // Count 3: two ghost copies, faces + edges each.
        expect(ghostCalls(displayMesh)).toBe(4);
        // One arrow — a shaft and a head — for the one direction the run has.
        expect(cylinder).toHaveBeenCalledTimes(1);
        expect(cone).toHaveBeenCalledTimes(1);
        expect(badges).toHaveLength(0);
        expect(removeMesh).not.toHaveBeenCalled();
    });

    test("dragging the spacing arrow edits the spacing, and the panel follows", async () => {
        const { app, doc, body, view } = setup();
        const cmd = new LinearPatternFeatureCommand();
        seedPicks(cmd, app, body, directionPick(body));
        const { controller, promise, handler } = openSession(doc, cmd);
        expect(cmd.spacing).toBe(12);
        raysAlongX(view);

        // the arrow runs from the body's centre (screen 405,305) 80px along +X
        handler.pointerDown(view, createPointerEvent({ offsetX: 440, offsetY: 305 }));
        // crossing the drag threshold grabs the projection: the first frame does not jump
        handler.pointerMove(view, createPointerEvent({ offsetX: 470, offsetY: 305 }));
        expect(cmd.spacing).toBe(12);
        handler.pointerMove(view, createPointerEvent({ offsetX: 490, offsetY: 305 }));
        expect(cmd.spacing).toBe(32);

        controller.cancel();
        await promise;
    });

    test("a press away from the arrow is not a drag", async () => {
        const { app, doc, body, view } = setup();
        const cmd = new LinearPatternFeatureCommand();
        seedPicks(cmd, app, body, directionPick(body));
        const { controller, promise, handler } = openSession(doc, cmd);
        raysAlongX(view);

        handler.pointerDown(view, createPointerEvent({ offsetX: 100, offsetY: 100 }));
        handler.pointerMove(view, createPointerEvent({ offsetX: 300, offsetY: 100 }));

        expect(cmd.spacing).toBe(12);
        controller.cancel();
        await promise;
    });

    test("a click-move drag is left back at the spacing it started from", async () => {
        const { app, doc, body, view } = setup();
        const cmd = new LinearPatternFeatureCommand();
        seedPicks(cmd, app, body, directionPick(body));
        const { controller, promise, handler } = openSession(doc, cmd);
        expect(cmd.spacing).toBe(12);
        raysAlongX(view);

        // a click on the arrow opens the click-move gesture; the next move drags it
        handler.pointerDown(view, createPointerEvent({ offsetX: 440, offsetY: 305 }));
        handler.pointerUp(view, createPointerEvent({ offsetX: 440, offsetY: 305 }));
        handler.pointerMove(view, createPointerEvent({ offsetX: 490, offsetY: 305 }));
        expect(cmd.spacing).toBe(62);

        handler.keyDown(view, escapeKey());

        expect(cmd.spacing).toBe(12);
        controller.cancel();
        await promise;
    });

    test("leaving a click-move gesture with Escape takes the arrow's highlight with it", async () => {
        const { app, doc, body, view, paintLog } = setup();
        const cmd = new LinearPatternFeatureCommand();
        seedPicks(cmd, app, body, directionPick(body));
        const { controller, promise, handler } = openSession(doc, cmd);
        raysAlongX(view);

        handler.pointerDown(view, createPointerEvent({ offsetX: 440, offsetY: 305 }));
        handler.pointerUp(view, createPointerEvent({ offsetX: 440, offsetY: 305 }));
        handler.pointerMove(view, createPointerEvent({ offsetX: 490, offsetY: 305 }));
        expect(lastArrowColor(paintLog)).toBe(ARROW_HOVER_COLOR);

        handler.keyDown(view, escapeKey());
        expect(cmd.spacing).toBe(12);
        expect(lastArrowColor(paintLog)).toBe(ARROW_COLOR);

        controller.cancel();
        await promise;
    });

    test("a press on empty canvas takes the arrow's highlight with it", async () => {
        const { app, doc, body, view, paintLog } = setup();
        const cmd = new LinearPatternFeatureCommand();
        seedPicks(cmd, app, body, directionPick(body));
        const { controller, promise, handler } = openSession(doc, cmd);

        handler.pointerMove(view, createPointerEvent({ offsetX: 440, offsetY: 305 }));
        expect(lastArrowColor(paintLog)).toBe(ARROW_HOVER_COLOR);

        handler.pointerDown(view, createPointerEvent({ offsetX: 100, offsetY: 100 }));

        expect(lastArrowColor(paintLog)).toBe(ARROW_COLOR);
        controller.cancel();
        await promise;
    });

    test("a second press inside a click-move gesture does not re-stamp its starting value", async () => {
        const { app, doc, body, view } = setup();
        const cmd = new LinearPatternFeatureCommand();
        seedPicks(cmd, app, body, directionPick(body));
        const { controller, promise, handler } = openSession(doc, cmd);
        expect(cmd.spacing).toBe(12);
        raysAlongX(view);

        handler.pointerDown(view, createPointerEvent({ offsetX: 440, offsetY: 305 }));
        handler.pointerUp(view, createPointerEvent({ offsetX: 440, offsetY: 305 }));
        handler.pointerMove(view, createPointerEvent({ offsetX: 490, offsetY: 305 }));
        expect(cmd.spacing).toBe(62);

        // the press that settles the gesture is not a new grab: Escape still returns to 12
        handler.pointerDown(view, createPointerEvent({ offsetX: 490, offsetY: 305 }));
        handler.keyDown(view, escapeKey());

        expect(cmd.spacing).toBe(12);
        controller.cancel();
        await promise;
    });

    test("hovering an arrow repaints the arrows only, never the ghosts", async () => {
        const { app, doc, body, view, displayMesh, setMeshColor } = setup();
        const cmd = new LinearPatternFeatureCommand();
        seedPicks(cmd, app, body, directionPick(body));
        const { controller, promise, handler } = openSession(doc, cmd);
        expect(ghostCalls(displayMesh)).toBe(4);
        const arrowDraws = () => displayMesh.mock.calls.filter((call) => call[1]?.meshOpacity === 1).length;
        const drawnOnce = arrowDraws();

        handler.pointerMove(view, createPointerEvent({ offsetX: 440, offsetY: 305 }));
        expect((handler as any)._hoveredHandle).toBe("spacing");
        expect(ghostCalls(displayMesh)).toBe(4);
        // the arrows are recoloured in place, not re-uploaded
        expect(arrowDraws()).toBe(drawnOnce);
        expect(setMeshColor).toHaveBeenCalled();

        handler.pointerMove(view, createPointerEvent({ offsetX: 100, offsetY: 100 }));
        expect((handler as any)._hoveredHandle).toBeUndefined();
        expect(ghostCalls(displayMesh)).toBe(4);
        expect(arrowDraws()).toBe(drawnOnce);

        controller.cancel();
        await promise;
    });

    test("a zoom resizes the arrows once, through the camera listener", async () => {
        const { app, doc, body } = setup();
        const cmd = new LinearPatternFeatureCommand();
        seedPicks(cmd, app, body, directionPick(body));
        const { controller, promise, handler } = openSession(doc, cmd);
        const camera = cameraDrivenView(doc);
        // a move subscribes the session to this view's camera
        handler.pointerMove(camera.view, createPointerEvent({ offsetX: 100, offsetY: 100 }));

        // the production chain is handleCameraChanged → refreshArrow → onCameraChanged, so a
        // second rescale inside the hook would show up as a second call here
        const refresh = rs.spyOn(handler as any, "refreshArrow");
        try {
            camera.fire();
            expect(refresh).toHaveBeenCalledTimes(1);
        } finally {
            refresh.mockRestore();
        }

        controller.cancel();
        await promise;
    });

    test("a right-button press does not retarget the arrow under a gesture", async () => {
        const { app, doc, body, view } = setup();
        const cmd = new LinearPatternFeatureCommand();
        seedPicks(cmd, app, body, directionPick(body));
        const { controller, promise, handler } = openSession(doc, cmd);
        raysAlongX(view);

        handler.pointerDown(view, createPointerEvent({ offsetX: 440, offsetY: 305 }));
        handler.pointerUp(view, createPointerEvent({ offsetX: 440, offsetY: 305 }));
        expect((handler as any)._activeHandle).toBe("spacing");

        // the base rejects it; the gesture must not be retargeted before that rejection
        handler.pointerDown(
            view,
            createPointerEvent({ offsetX: 440, offsetY: 305, button: 2, isPrimary: true }),
        );
        expect((handler as any)._activeHandle).toBe("spacing");

        controller.cancel();
        await promise;
    });

    test("a typed number with no arrow under the pointer still edits the first spacing", async () => {
        const { app, doc, body, view } = setup();
        const cmd = new LinearPatternFeatureCommand();
        seedPicks(cmd, app, body, directionPick(body));
        const { controller, promise, handler } = openSession(doc, cmd);
        const typed = captureInput();
        try {
            handler.keyDown(view, {
                key: "2",
                preventDefault: () => {},
                stopImmediatePropagation: () => {},
            } as KeyboardEvent);
            expect(typed.apply).toBeDefined();
            expect(typed.apply!("25").isOk).toBe(true);
            expect(cmd.spacing).toBe(25);
        } finally {
            typed.restore();
        }
        controller.cancel();
        await promise;
    });

    test("the arrow keeps its pixel size instead of being floored at a world length", async () => {
        const { app, doc, body } = setup();
        const cmd = new LinearPatternFeatureCommand();
        seedPicks(cmd, app, body, directionPick(body));
        const { controller, promise, handler } = openSession(doc, cmd);

        // 10 world units per screen pixel squeezes the 80 px arrow into 8 world units; a
        // floor of ARROW_LENGTH (40) would draw it 400 px wide and aim the hit test at it.
        const zoomed = createHandlerMockView({
            document: doc,
            // looking down -Z, so the arrow's perpendicular measures along screen y
            direction: () => XYZ.unitZ.reverse(),
            worldToScreen: (point: XYZ) => new XY({ x: point.x * 10 + 400, y: point.y * 10 + 300 }),
        });
        (handler as any).refreshHandle(zoomed);

        expect((handler as any).arrowLength).toBeCloseTo(8);
        expect((handler as any).handleLength).toBeCloseTo(8);

        controller.cancel();
        await promise;
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
        expect((cmd as any)._session).toBeUndefined();
        // the four ghosts and the arrow's two meshes
        expect(removeMesh).toHaveBeenCalledTimes(6);
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
        expect(badges[0].text).toBe("360°");
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
        expect(badges[2].text).toBe("180°");
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

    /** Lets a promise continuation run — the nested pick reports through promises. */
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    /** A pick that answers with `shapes` and settles as a success (a click on an edge). */
    const pickOf =
        (shapes: any[]): Direction2PickStub =>
        (controller) => {
            controller.success();
            return Promise.resolve(shapes);
        };

    /** Opens the single-direction preview, then ticks the switch against a stubbed pick. */
    const openGridSession = async (
        doc: TestDocument,
        cmd: LinearPatternFeatureCommand,
        app: IApplication,
        body: ParametricBodyNode,
        pick: Direction2PickStub = pickOf([direction2Pick(body)]),
    ) => {
        seedPicks(cmd, app, body, directionPick(body));
        const session = openSession(doc, cmd, pick);
        cmd.direction2Enabled = true;
        await flush();
        return session;
    };

    test("the switch starts off on every run, however the last run left it", () => {
        // The options cache is process-wide; a remembered "on" would open the next preview
        // straight into a second-direction edge pick.
        const cache = (CancelableCommand as unknown as { _propertiesCache: Map<string, unknown> })
            ._propertiesCache;
        cache.set("feature.patternLinear:direction2Enabled", true);
        try {
            const cmd = new LinearPatternFeatureCommand();
            (cmd as any)._application = createMockApplication();
            (cmd as any).beforeExecute();
            expect(cmd.direction2Enabled).toBe(false);
        } finally {
            cache.delete("feature.patternLinear:direction2Enabled");
        }
    });

    test("the switch is off by default: the preview is one row and no pick is asked", async () => {
        const { app, doc, body, displayMesh } = setup();
        const cmd = new LinearPatternFeatureCommand();
        seedPicks(cmd, app, body, directionPick(body));
        const { controller, promise, handler } = openSession(doc, cmd);

        expect(cmd.direction2Enabled).toBe(false);
        expect(cmd.hasDirection2).toBe(false);
        expect(ghostCalls(displayMesh)).toBe(4);
        expect(handler.placements(3, 12)).toHaveLength(2);
        expect((doc.picker as any).pickShape).toBeUndefined();

        controller.cancel();
        await promise;
    });

    test("ticking the switch asks for the second edge and grows the grid", async () => {
        const { app, doc, body, booleanFuse, displayMesh, cylinder, badges } = setup();
        const cmd = new LinearPatternFeatureCommand();
        const { promise, handler } = await openGridSession(doc, cmd, app, body);

        expect(cmd.hasDirection2).toBe(true);
        // both directions converge their auto spacing: the box spreads 10 along each
        expect(cmd.spacing).toBe(12);
        expect(cmd.spacing2).toBe(12);
        // the pick is the second direction's, asked through the nested pick
        const pickShape = (doc.picker as any).pickShape as ReturnType<typeof rs.fn>;
        expect(pickShape.mock.calls[0][0]).toBe("prompt.select.direction2Edge");
        // a 3×2 grid: five ghost copies on top of the row the preview already drew
        expect(ghostCalls(displayMesh)).toBe(4 + 10);
        // and an arrow for each direction: the first was meshed at the open and re-placed
        // from the cache when the pair was redrawn, so only the second's is a new one
        expect(cylinder).toHaveBeenCalledTimes(2);
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

    test("the second direction's arrow drags its own spacing, not the first's", async () => {
        const { app, doc, body, view } = setup();
        const cmd = new LinearPatternFeatureCommand();
        const { controller, promise, handler } = await openGridSession(doc, cmd, app, body);
        // rays along +X meet the +Y arrow's own line, so a screen y reads the world y on it
        (view as any).rayAt = (_mx: number, my: number) =>
            new Ray({ point: new XYZ({ x: 5, y: my - 300, z: 2.5 }), direction: XYZ.unitX });

        // the second arrow runs from the same centre (405,305) down to (405,385)
        handler.pointerDown(view, createPointerEvent({ offsetX: 405, offsetY: 340 }));
        handler.pointerMove(view, createPointerEvent({ offsetX: 405, offsetY: 360 }));
        handler.pointerMove(view, createPointerEvent({ offsetX: 405, offsetY: 380 }));

        expect(cmd.spacing2).toBe(32);
        expect(cmd.spacing).toBe(12);
        controller.cancel();
        await promise;
    });

    test("Enter under the second-direction pick skips it and keeps the preview open", async () => {
        const { app, doc, body, displayMesh } = setup();
        const cmd = new LinearPatternFeatureCommand();
        seedPicks(cmd, app, body, directionPick(body));
        // the edge picker answers Enter/Space with an empty SUCCESS, not a cancel
        const { controller, promise } = openSession(doc, cmd, pickOf([]));

        cmd.direction2Enabled = true;
        await flush();

        expect(cmd.direction2Enabled).toBe(false);
        expect(cmd.hasDirection2).toBe(false);
        // the run is NOT committed: the preview is still open for its own Enter
        expect(controller.result).toBeUndefined();
        expect(ghostCalls(displayMesh)).toBe(4);

        controller.cancel();
        await promise;
    });

    test("a cancelled second-direction pick puts the target's node selection back", async () => {
        const { app, doc, body } = setup();
        const cmd = new LinearPatternFeatureCommand();
        seedPicks(cmd, app, body, directionPick(body));
        const reference = directionPick(body);
        let nodes: any[] = [body];
        let shapes: any[] = [reference];
        (doc.selection as any).getSelectedNodes = () => nodes;
        (doc.selection as any).getSelectedShapes = () => shapes;
        const setNodes = rs.fn((selected: any[]) => {
            nodes = selected;
            return selected.length;
        });
        (doc.selection as any).setSelectedNodes = setNodes;
        (doc.selection as any).setSelectedShapes = rs.fn((selected: any[]) => {
            shapes = selected;
            return selected.length;
        });
        // what SubshapeSelectionHandler does on cancel: everything goes
        (doc.selection as any).clearSelection = () => {
            nodes = [];
            shapes = [];
        };
        const cancelPick: Direction2PickStub = (controller) => {
            controller.cancel();
            (doc.selection as any).clearSelection();
            return Promise.resolve([]);
        };

        const { controller, promise } = openSession(doc, cmd, cancelPick);
        cmd.direction2Enabled = true;
        await flush();

        expect(setNodes).toHaveBeenCalledWith([body], false);
        expect(nodes).toEqual([body]);
        expect(shapes).toEqual([reference]);

        controller.cancel();
        await promise;
    });

    test("unticking keeps the reference edge when direction 2 picked the same edge", async () => {
        const { app, doc, body } = setup();
        const cmd = new LinearPatternFeatureCommand();
        seedPicks(cmd, app, body, directionPick(body));
        const reference = directionPick(body);
        let current: any[] = [reference];
        (doc.selection as any).getSelectedShapes = () => current;
        (doc.selection as any).setSelectedShapes = rs.fn((selected: any[]) => {
            current = selected;
            return selected.length;
        });
        // the second pick answers with the first direction's own edge
        const pick: Direction2PickStub = (controller) => {
            controller.success();
            current = [reference];
            return Promise.resolve([reference]);
        };

        const { controller, promise } = openSession(doc, cmd, pick);
        cmd.direction2Enabled = true;
        await flush();
        expect(current).toEqual([reference]);

        cmd.direction2Enabled = false;

        expect(current).toEqual([reference]);
        controller.cancel();
        await promise;
    });

    test("the nested pick restores the target tint, reference edge and cursor", async () => {
        const { app, doc, body } = setup();
        const cmd = new LinearPatternFeatureCommand();
        seedPicks(cmd, app, body, directionPick(body));
        const reference = [directionPick(body)];
        const picked = direction2Pick(body);
        let current: any[] = reference;
        (doc.selection as any).getSelectedShapes = () => current;
        const setShapes = rs.fn((shapes: any[]) => {
            current = shapes;
            return shapes.length;
        });
        (doc.selection as any).setSelectedShapes = setShapes;
        const cursors: string[] = [];
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation((channel: string, ...args: any[]) => {
            if (channel === "viewCursor") cursors.push(args[0]);
        });
        try {
            const pick: Direction2PickStub = (controller) => {
                controller.success();
                current = [picked];
                return Promise.resolve([picked]);
            };
            const { controller, promise } = openSession(doc, cmd, pick);
            cmd.direction2Enabled = true;
            await flush();

            // first the shapes are cleared (the pick must not read the old edge), then the
            // old edge and the newly picked one come back together
            expect(setShapes.mock.calls[0][0]).toEqual([]);
            expect(setShapes.mock.calls[1][0]).toEqual([reference[0], picked]);
            expect(cursors).toContain("draw");

            controller.cancel();
            await promise;
        } finally {
            pub.mockRestore();
        }
    });

    test("a number typed right after dragging the second arrow edits that arrow", async () => {
        const { app, doc, body, view } = setup();
        const cmd = new LinearPatternFeatureCommand();
        const { controller, promise, handler } = await openGridSession(doc, cmd, app, body);
        (view as any).rayAt = (_mx: number, my: number) =>
            new Ray({ point: new XYZ({ x: 5, y: my - 300, z: 2.5 }), direction: XYZ.unitX });

        handler.pointerDown(view, createPointerEvent({ offsetX: 405, offsetY: 340 }));
        handler.pointerMove(view, createPointerEvent({ offsetX: 405, offsetY: 360 }));
        handler.pointerMove(view, createPointerEvent({ offsetX: 405, offsetY: 380 }));
        handler.pointerUp(view, createPointerEvent({ offsetX: 405, offsetY: 380 }));
        expect(cmd.spacing2).toBe(32);

        // the pointer is still on the second arrow; the release cleared the drag's hover
        const typed = captureInput();
        try {
            handler.keyDown(view, {
                key: "5",
                preventDefault: () => {},
                stopImmediatePropagation: () => {},
            } as KeyboardEvent);
            expect(typed.apply!("5").isOk).toBe(true);
            expect(cmd.spacing2).toBe(5);
            expect(cmd.spacing).toBe(12);
        } finally {
            typed.restore();
        }

        controller.cancel();
        await promise;
    });

    test("a right-button release does not drop the arrow the drag is still holding", async () => {
        const { app, doc, body, view } = setup();
        const cmd = new LinearPatternFeatureCommand();
        const { controller, promise, handler } = await openGridSession(doc, cmd, app, body);
        (view as any).rayAt = (_mx: number, my: number) =>
            new Ray({ point: new XYZ({ x: 5, y: my - 300, z: 2.5 }), direction: XYZ.unitX });

        handler.pointerDown(view, createPointerEvent({ offsetX: 405, offsetY: 340 }));
        handler.pointerMove(view, createPointerEvent({ offsetX: 405, offsetY: 360 }));
        handler.pointerMove(view, createPointerEvent({ offsetX: 405, offsetY: 380 }));
        expect(cmd.spacing2).toBe(32);

        // the base ignores this release; the gesture must ignore it just the same
        handler.pointerUp(view, createPointerEvent({ offsetX: 405, offsetY: 380, button: 2 }));
        handler.pointerMove(view, createPointerEvent({ offsetX: 405, offsetY: 385 }));

        expect(cmd.spacing2).toBe(37);
        expect(cmd.spacing).toBe(12);

        controller.cancel();
        await promise;
    });

    test("unticking the switch mid-drag stops writing instead of pouring into direction 1", async () => {
        const { app, doc, body, view } = setup();
        const cmd = new LinearPatternFeatureCommand();
        const { controller, promise, handler } = await openGridSession(doc, cmd, app, body);
        (view as any).rayAt = (_mx: number, my: number) =>
            new Ray({ point: new XYZ({ x: 5, y: my - 300, z: 2.5 }), direction: XYZ.unitX });

        handler.pointerDown(view, createPointerEvent({ offsetX: 405, offsetY: 340 }));
        handler.pointerMove(view, createPointerEvent({ offsetX: 405, offsetY: 360 }));
        handler.pointerMove(view, createPointerEvent({ offsetX: 405, offsetY: 380 }));
        expect(cmd.spacing2).toBe(32);

        // the arrow under the gesture is gone; the remaining motion has no number to write
        cmd.direction2Enabled = false;
        handler.pointerMove(view, createPointerEvent({ offsetX: 405, offsetY: 390 }));

        expect(cmd.spacing).toBe(12);
        expect(cmd.spacing2).toBe(32);

        controller.cancel();
        await promise;
    });

    test("dropping the second direction under a click-move gives the pointer back", async () => {
        const { app, doc, body, view } = setup();
        const cmd = new LinearPatternFeatureCommand();
        const { controller, promise, handler } = await openGridSession(doc, cmd, app, body);
        raysAlongX(view);

        // a click on the second arrow opens its click-move gesture
        handler.pointerDown(view, createPointerEvent({ offsetX: 405, offsetY: 340 }));
        handler.pointerUp(view, createPointerEvent({ offsetX: 405, offsetY: 340 }));
        expect((handler as any).awaitingClick).toBe(true);

        cmd.direction2Enabled = false;
        // the gesture's arrow is gone: the base must not keep waiting for its settling click
        expect((handler as any).awaitingClick).toBe(false);

        // the very next press has to start a fresh drag on the first arrow
        handler.pointerDown(view, createPointerEvent({ offsetX: 440, offsetY: 305 }));
        handler.pointerMove(view, createPointerEvent({ offsetX: 470, offsetY: 305 }));
        handler.pointerMove(view, createPointerEvent({ offsetX: 490, offsetY: 305 }));

        expect(cmd.spacing).toBe(32);

        controller.cancel();
        await promise;
    });

    test("unticking the switch drops the second edge from the selection", async () => {
        const { app, doc, body } = setup();
        const cmd = new LinearPatternFeatureCommand();
        seedPicks(cmd, app, body, directionPick(body));
        const reference = directionPick(body);
        const picked = direction2Pick(body);
        let current: any[] = [reference];
        (doc.selection as any).getSelectedShapes = () => current;
        const setShapes = rs.fn((shapes: any[]) => {
            current = shapes;
            return shapes.length;
        });
        (doc.selection as any).setSelectedShapes = setShapes;
        const pick: Direction2PickStub = (controller) => {
            controller.success();
            current = [reference, picked];
            return Promise.resolve([picked]);
        };

        const { controller, promise } = openSession(doc, cmd, pick);
        cmd.direction2Enabled = true;
        await flush();
        expect(current).toEqual([reference, picked]);

        cmd.direction2Enabled = false;

        expect(current).toEqual([reference]);
        controller.cancel();
        await promise;
    });

    test("the arrows' shared root belongs to the first direction", async () => {
        const { app, doc, body, view } = setup();
        const cmd = new LinearPatternFeatureCommand();
        const { controller, promise, handler } = await openGridSession(doc, cmd, app, body);
        raysAlongX(view);

        // both shafts start at the body's centre (405,305), where both distances are zero
        expect((handler as any).handleAt(view, createPointerEvent({ offsetX: 405, offsetY: 305 }))).toBe(
            "spacing",
        );

        handler.pointerDown(view, createPointerEvent({ offsetX: 405, offsetY: 305 }));
        handler.pointerMove(view, createPointerEvent({ offsetX: 445, offsetY: 305 }));
        handler.pointerMove(view, createPointerEvent({ offsetX: 455, offsetY: 305 }));

        expect(cmd.spacing).toBe(22);
        expect(cmd.spacing2).toBe(12);
        controller.cancel();
        await promise;
    });

    test("the panel drives both directions' ghosts, and the commit carries them", async () => {
        const { app, doc, body, displayMesh, cylinder } = setup();
        const cmd = new LinearPatternFeatureCommand();
        const { promise, handler } = await openGridSession(doc, cmd, app, body);
        expect(ghostCalls(displayMesh)).toBe(14);
        // the first arrow was meshed at the open; the second direction's is the only other
        expect(cylinder).toHaveBeenCalledTimes(2);

        cmd.spacing = 20;
        expect(ghostCalls(displayMesh)).toBe(24); // the same five copies reghosted
        cmd.spacing2 = 30;
        expect(ghostCalls(displayMesh)).toBe(34);
        cmd.count2 = 4;
        expect(ghostCalls(displayMesh)).toBe(56); // a 3×4 grid: eleven copies, faces + edges each
        // every one of those refreshes re-placed the cached arrows: no kernel meshing again
        expect(cylinder).toHaveBeenCalledTimes(2);

        (handler as any).confirm();
        await promise;
        (cmd as any).executeMainTask();
        const feature = body.features[1] as any;
        expect(feature.spacing).toBe(20);
        expect(feature.spacing2).toBe(30);
        expect(feature.count).toBe(3);
        expect(feature.count2).toBe(4);
    });

    test("unticking the switch drops the grid and commits without the trio", async () => {
        const { app, doc, body, displayMesh } = setup();
        const cmd = new LinearPatternFeatureCommand();
        const { promise, handler } = await openGridSession(doc, cmd, app, body);
        expect(ghostCalls(displayMesh)).toBe(14);

        cmd.direction2Enabled = false;
        expect(cmd.hasDirection2).toBe(false);
        // the ghosts fall back to the row: two copies, faces + edges each
        expect(ghostCalls(displayMesh)).toBe(18);

        (handler as any).confirm();
        await promise;
        (cmd as any).executeMainTask();

        const feature = body.features[1] as any;
        expect("direction2" in feature).toBe(false);
        expect("count2" in feature).toBe(false);
        expect("spacing2" in feature).toBe(false);
    });

    test("a cancelled second-direction pick leaves the switch off and the preview single", async () => {
        const { app, doc, body, displayMesh } = setup();
        const cmd = new LinearPatternFeatureCommand();
        seedPicks(cmd, app, body, directionPick(body));
        const cancelPick: Direction2PickStub = (controller) => {
            controller.cancel();
            return Promise.resolve([]);
        };
        const { controller, promise } = openSession(doc, cmd, cancelPick);

        cmd.direction2Enabled = true;
        await flush();

        expect(cmd.direction2Enabled).toBe(false);
        expect(cmd.hasDirection2).toBe(false);
        expect(ghostCalls(displayMesh)).toBe(4);

        controller.cancel();
        await promise;
    });

    test("the pair shows only once the pick comes back — the switch alone is not the cue", async () => {
        const { app, doc, body } = setup();
        const cmd = new LinearPatternFeatureCommand();
        seedPicks(cmd, app, body, directionPick(body));
        let settle!: (shapes: any[]) => void;
        const deferred: Direction2PickStub = (controller) => {
            controller.success();
            return new Promise<any[]>((resolve) => (settle = resolve));
        };
        const { controller, promise } = openSession(doc, cmd, deferred);

        cmd.direction2Enabled = true;
        await flush();
        expect(cmd.hasDirection2).toBe(false);

        settle([direction2Pick(body)]);
        await flush();
        expect(cmd.hasDirection2).toBe(true);

        controller.cancel();
        await promise;
    });

    test("a switch ticked before the preview picks once the preview owns the viewport", async () => {
        const { app, doc, body, displayMesh } = setup();
        const cmd = new LinearPatternFeatureCommand();
        seedPicks(cmd, app, body, directionPick(body));
        // No session yet: the tick is remembered rather than picked against nothing.
        cmd.direction2Enabled = true;
        expect(cmd.hasDirection2).toBe(false);

        // The pick records WHO the viewport was dispatching to when it started. Started from
        // `createSession`, that would be the pre-session handler: the session's own pick then
        // installs over it, never lets it see a click, and the second direction is lost.
        const targetAtPick: unknown[] = [];
        const recordingPick: Direction2PickStub = (controller) => {
            targetAtPick.push((doc.visual as any).eventHandler);
            controller.success();
            return Promise.resolve([direction2Pick(body)]);
        };
        const before = (doc.visual as any).eventHandler;
        const { controller, promise, handler } = openSession(doc, cmd, recordingPick);
        await flush();

        expect(targetAtPick).toHaveLength(1);
        expect(targetAtPick[0]).toBe(handler);
        expect(cmd.hasDirection2).toBe(true);
        expect(ghostCalls(displayMesh)).toBe(14);

        controller.cancel();
        await promise;
        // and the viewport goes back to what it had before the session, not to either picker
        expect((doc.visual as any).eventHandler).toBe(before);
    });

    test("a direction 2 parallel to direction 1 is refused at the commit", async () => {
        const { app, doc, body } = setup();
        const cmd = new LinearPatternFeatureCommand();
        const parallel = edgePick(body, edge(new XYZ({ x: 0, y: 0, z: 5 }), new XYZ({ x: 10, y: 0, z: 5 })));
        const { promise, handler } = await openGridSession(doc, cmd, app, body, pickOf([parallel]));

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

    test("ESC cancels the grid preview: no feature lands, the ghosts come down", async () => {
        const { app, doc, body, booleanFuse, displayMesh, removeMesh } = setup();
        const cmd = new LinearPatternFeatureCommand();
        const { controller, promise } = await openGridSession(doc, cmd, app, body);
        expect(ghostCalls(displayMesh)).toBe(14);

        controller.cancel();
        const result = await promise;

        expect(result).toBeUndefined();
        expect(body.features).toHaveLength(1);
        expect(booleanFuse).not.toHaveBeenCalled();
        expect((cmd as any)._session).toBeUndefined();
        // the ten ghosts and the two arrows (shaft + head each), plus what the redraw of the
        // first arrow cost when the second direction joined
        expect(removeMesh).toHaveBeenCalledTimes(14 + 2 + 4);
    });
});

describe("curve pattern command", () => {
    /** A straight path of two 10mm edges, so the copies sit on known abscissas. */
    const straightPath = () => [
        edge(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 10, y: 0, z: 0 })),
        edge(new XYZ({ x: 10, y: 0, z: 0 }), new XYZ({ x: 20, y: 0, z: 0 })),
    ];

    /**
     * The path lives on its own node (a sketch or another body), whose mock shape exposes the
     * picked edges — the feature re-matches the stored refs against that shape on every rebuild.
     */
    function seedPath(
        cmd: CurvePatternFeatureCommand,
        app: IApplication,
        doc: TestDocument,
        body: ParametricBodyNode,
        path = straightPath(),
    ) {
        const source = new ParametricBodyNode({
            document: doc,
            features: [{ id: "s1", type: "primitive", primitive: "box", dx: 10, dy: 10, dz: 5 } as any],
        });
        doc.modelManager.addNode(source);
        source.shape.unchecked()!.findSubShapes = ((type: ShapeType) =>
            type === ShapeTypes.edge ? path : []) as any;
        (cmd as any)._application = app;
        (cmd as any).stepDatas = [{ nodes: [body], shapes: [], type: "pick" }];
        const picks = path.map((picked, index) => ({ ...edgePick(source, picked), indexes: [index] }));
        return { source, path, picks };
    }

    /**
     * Drives the ONE combined step: a live selection the test sets directly (the real handler
     * writes it), a picker that settles when the controller does, and the selection bar's
     * confirm standing in for the commit.
     */
    function openPathPick(doc: TestDocument, cmd: CurvePatternFeatureCommand, picks: any[]) {
        let shapes: any[] = [];
        const clearSelection = rs.fn(() => {
            shapes = [];
        });
        const onShapeChanged = new Signal<(selected: any[]) => void>();
        doc.selection = {
            clearSelection,
            setSelectedNodes: () => 0,
            setSelectedShapes: () => 0,
            getSelectedNodes: () => [],
            getSelectedNodeLength: () => 0,
            getSelectedShapes: () => shapes,
            getSelectedVisualNodes: () => [],
            onNodeChanged: new Signal(),
            onShapeChanged,
            dispose: () => {},
        } as any;
        let captured = false;
        doc.picker = {
            pickAsync: rs.fn((_handler: any, _prompt: any, controller: AsyncController) => {
                captured = true;
                const previous = (doc.visual as any).eventHandler;
                let resolve!: () => void;
                const done = new Promise<void>((r) => (resolve = r));
                const settle = () => {
                    if ((doc.visual as any).eventHandler === _handler) {
                        (doc.visual as any).eventHandler = previous;
                    }
                    resolve();
                };
                (doc.visual as any).eventHandler = _handler;
                controller.onCompleted(settle);
                controller.onCancelled(settle);
                controller.onFailed(settle);
                return done;
            }),
        } as any;
        const steps = (cmd as any).getSteps();
        const step = steps[steps.length - 1];
        const controller = new AsyncController();
        const promise = step.execute(doc, controller);
        if (!captured) throw new Error("the path pick never opened");
        return {
            controller,
            promise,
            clearSelection,
            select(next: any[]) {
                shapes = next;
                onShapeChanged.emit(next);
            },
            /** The selection bar's confirm (or Enter): the one and only commit control. */
            async commit() {
                controller.success();
                const result = await promise;
                if (result !== undefined) (cmd as any).stepDatas.push(result);
                return result;
            },
        };
    }

    test("the path pick ghosts the copies as the edges are selected", () => {
        const { app, doc, body, displayMesh } = setup();
        const cmd = new CurvePatternFeatureCommand();
        const { picks } = seedPath(cmd, app, doc, body);
        cmd.count = 3;

        const pick = openPathPick(doc, cmd, picks);
        pick.select(picks);

        // Two copies, each a face mesh and an edge mesh — the preview appeared with the pick,
        // before any confirm.
        expect(ghostCalls(displayMesh)).toBe(4);
        cmd.count = 4;
        expect(ghostCalls(displayMesh)).toBe(10);

        pick.controller.cancel();
        void pick.promise;
    });

    test("the selection confirm commits the panel's values", async () => {
        const { app, doc, body, booleanFuse } = setup();
        const cmd = new CurvePatternFeatureCommand();
        const { source, picks } = seedPath(cmd, app, doc, body);
        cmd.count = 3;
        cmd.equalSpacing = false;
        cmd.spacing = 4;
        cmd.orientation = "feature.pattern.orientation.locked";
        const pick = openPathPick(doc, cmd, picks);
        pick.select(picks);

        const result = await pick.commit();
        expect(result?.type).toBe("shape");
        (cmd as any).executeMainTask();

        expect(body.features).toHaveLength(2);
        const feature = body.features[1] as any;
        expect(feature.type).toBe("pattern");
        expect(feature.mode).toBe("curve");
        expect(feature.count).toBe(3);
        expect(feature.equalSpacing).toBe(false);
        expect(feature.spacing).toBe(4);
        expect(feature.orientation).toBe("locked");
        expect(feature.path.nodeId).toBe(source.id);
        expect(feature.path.edges).toHaveLength(2);
        // Fixed distance 4 along a straight path: copies at x = 4 and 8.
        const tools = booleanFuse.mock.calls[0][1] as any[];
        expect(tools.map((tool) => Math.round(tool.transformedBy.ofPoint(XYZ.zero).x))).toEqual([4, 8]);
    });

    test("a blank distance converges to the equal-spacing step as the path appears", async () => {
        const { app, doc, body, booleanFuse } = setup();
        const cmd = new CurvePatternFeatureCommand();
        const { picks } = seedPath(cmd, app, doc, body);
        cmd.count = 3;
        cmd.spacing = "";
        cmd.equalSpacing = false;
        const pick = openPathPick(doc, cmd, picks);

        expect(cmd.spacing).toBe("");
        pick.select(picks);
        // The panel is written the step the ghosts opened with, 10mm on a 20mm path.
        expect(cmd.spacing).toBe(10);

        cmd.equalSpacing = true;
        await pick.commit();
        (cmd as any).executeMainTask();

        const feature = body.features[1] as any;
        expect(feature.equalSpacing).toBe(true);
        // Equal spacing ignores the distance, so no spacing is stored.
        expect(feature.spacing).toBeUndefined();
        const tools = booleanFuse.mock.calls[0][1] as any[];
        expect(tools.map((tool) => Math.round(tool.transformedBy.ofPoint(XYZ.zero).x))).toEqual([10, 20]);
    });

    test("a tangent curve pattern turns a copy with the path", async () => {
        const { app, doc, body, booleanFuse } = setup();
        const cmd = new CurvePatternFeatureCommand();
        const { picks } = seedPath(cmd, app, doc, body, [
            edge(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 10, y: 0, z: 0 })),
            edge(new XYZ({ x: 10, y: 0, z: 0 }), new XYZ({ x: 10, y: 20, z: 0 })),
        ]);
        cmd.count = 3;
        cmd.equalSpacing = true;
        cmd.orientation = "feature.pattern.orientation.tangent";
        const pick = openPathPick(doc, cmd, picks);
        pick.select(picks);

        await pick.commit();
        (cmd as any).executeMainTask();

        // The L is 30 long, so the first copy sits at 15 — halfway up the +Y segment. The seed
        // is turned a quarter turn there, so its own +X probe points along the path.
        const tools = booleanFuse.mock.calls[0][1] as any[];
        const mapped = tools[0].transformedBy.ofPoint(new XYZ({ x: 1, y: 0, z: 0 }));
        expect([Math.round(mapped.x), Math.round(mapped.y)]).toEqual([10, 6]);
    });

    test("ESC cancels the pick — and its ghosts — with nothing written", async () => {
        const { app, doc, body, booleanFuse, removeMesh } = setup();
        const cmd = new CurvePatternFeatureCommand();
        const { picks } = seedPath(cmd, app, doc, body);
        cmd.count = 3;
        const pick = openPathPick(doc, cmd, picks);
        pick.select(picks);

        pick.controller.cancel();
        const result = await pick.promise;

        expect(result).toBeUndefined();
        expect(body.features).toHaveLength(1);
        expect(booleanFuse).not.toHaveBeenCalled();
        expect(removeMesh).toHaveBeenCalledTimes(4);
    });

    test("an unresolvable distance never reaches the preview; the commit reports it", async () => {
        const { app, doc, body } = setup();
        const cmd = new CurvePatternFeatureCommand();
        const { picks } = seedPath(cmd, app, doc, body);
        cmd.count = 3;
        cmd.equalSpacing = false;
        cmd.spacing = "";
        const pick = openPathPick(doc, cmd, picks);
        pick.select(picks);
        cmd.spacing = "1 +";

        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            await pick.commit();
            (cmd as any).executeMainTask();
            expect(body.features).toHaveLength(1);
            expect(pub.mock.calls.some((call) => call[0] === "showToast")).toBe(true);
        } finally {
            pub.mockRestore();
        }
    });

    test("a distance that overruns the path is refused by the commit", async () => {
        const { app, doc, body } = setup();
        const cmd = new CurvePatternFeatureCommand();
        const { picks } = seedPath(cmd, app, doc, body);
        cmd.count = 3;
        cmd.equalSpacing = false;
        cmd.spacing = "";
        const pick = openPathPick(doc, cmd, picks);
        pick.select(picks);
        // The path is 20mm; two gaps of 15 need 30.
        cmd.spacing = 15;

        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            await pick.commit();
            (cmd as any).executeMainTask();
            expect(body.features).toHaveLength(1);
            expect(
                pub.mock.calls.some(
                    (call) =>
                        call[0] === "showToast" &&
                        call[2] === "Pattern path is too short for the count and spacing",
                ),
            ).toBe(true);
        } finally {
            pub.mockRestore();
        }
    });

    test("picks from two different nodes ghost nothing and are refused", () => {
        const { app, doc, body, displayMesh } = setup();
        const other = new ParametricBodyNode({
            document: doc,
            features: [{ id: "f2", type: "primitive", primitive: "box", dx: 5, dy: 5, dz: 5 } as any],
        });
        doc.modelManager.addNode(other);
        const cmd = new CurvePatternFeatureCommand();
        const { source, picks } = seedPath(cmd, app, doc, body);
        const mixed = [
            picks[0],
            {
                ...edgePick(other, edge(new XYZ({ x: 20, y: 0, z: 0 }), new XYZ({ x: 30, y: 0, z: 0 }))),
                indexes: [0],
            },
        ];

        const pick = openPathPick(doc, cmd, picks);
        pick.select(mixed);

        expect(ghostCalls(displayMesh)).toBe(0);
        expect((cmd as any).buildFeature(body)).toBeUndefined();
        expect(source.shape.isOk).toBe(true);
        pick.controller.cancel();
        void pick.promise;
    });

    test("the path pick starts from an empty selection", () => {
        const { app, doc, body } = setup();
        const cmd = new CurvePatternFeatureCommand();
        const { picks } = seedPath(cmd, app, doc, body);
        cmd.count = 3;
        const pick = openPathPick(doc, cmd, picks);

        // A body picked as a NODE does not clear shapes left selected beside it; those are not
        // path edges and the sorter would read them as curves.
        expect(pick.clearSelection).toHaveBeenCalledTimes(1);
        pick.controller.cancel();
        void pick.promise;
    });

    test("equal spacing still refuses a disconnected path at the commit", async () => {
        const { app, doc, body } = setup();
        const cmd = new CurvePatternFeatureCommand();
        const { source, picks } = seedPath(cmd, app, doc, body);
        cmd.count = 3;
        cmd.equalSpacing = true;
        const detached = {
            ...edgePick(source, edge(new XYZ({ x: 30, y: 0, z: 0 }), new XYZ({ x: 40, y: 0, z: 0 }))),
            indexes: [9],
        };
        const pick = openPathPick(doc, cmd, picks);
        pick.select([picks[0], detached]);

        // No ghosts could be drawn, but the confirm bar still settles — the commit is the
        // guard that must not store a chain the rebuild will refuse.
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            await pick.commit();
            (cmd as any).executeMainTask();
            expect(body.features).toHaveLength(1);
            expect(
                pub.mock.calls.some(
                    (call) =>
                        call[0] === "showToast" && call[2] === "Pattern path edges must connect end to end",
                ),
            ).toBe(true);
        } finally {
            pub.mockRestore();
        }
    });
});
