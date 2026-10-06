// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type AsyncController,
    CancelableCommand,
    CommandStore,
    type I18nKeys,
    type ICommand,
    type IEventHandler,
    Plane,
    PropertyUtils,
    PubSub,
    Ray,
    type ShowInputOptions,
    XYZ,
} from "@chili3d/core";
import { createMockDocument, setupShapeFactoryMock } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { ARROW_LENGTH } from "../../src/commands/arrowHandle";
import {
    SketchTransformCommand,
    type SketchTransformSession,
} from "../../src/sketch/commands/sketchTransform";
import { SketchEditor } from "../../src/sketch/editor/sketchEditor";
import { additivePick } from "../../src/sketch/editor/sketchEventHandler";
import { ConstraintKind } from "../../src/sketch/sketchModel";
import { SketchSolver } from "../../src/sketch/solver";
import { transformPoint } from "../../src/sketch/transformOps";
import "./setup";

/**
 * The handles are flat, so they are built through `polygon` + `face` rather than the solid
 * primitives — all of which run on the shape factory, absent outside the wasm package. A wire
 * that disposes, and a face that reports a mesh and disposes, is all either one needs.
 *
 * `runs` keeps every point list handed to `polygon`, because what the kernel does with a run
 * is not a black box: an open one meshes to something else entirely when it is short enough,
 * and a stub that throws the points away cannot tell that had happened.
 */
function stubGizmoGeometry(): { colors: (number | number[])[]; runs: XYZ[][] } {
    /** Every colour the shapes were painted with, in order. */
    const colors: (number | number[])[] = [];
    /** Every point run `polygon` was asked for, in order. */
    const runs: XYZ[][] = [];
    const wire = (points: XYZ[]) => {
        runs.push(points);
        return { isOk: true, value: { dispose: () => {} } };
    };
    const face = () => {
        const faces: { position: Float32Array; range: number[]; color?: number | number[] } = {
            position: new Float32Array(),
            range: [],
        };
        Object.defineProperty(faces, "color", {
            get: () => undefined,
            set: (value: number | number[]) => colors.push(value),
        });
        return { isOk: true, value: { mesh: { faces }, dispose: () => {} } };
    };
    setupShapeFactoryMock({ polygon: wire, face });
    return { colors, runs };
}

/** One handle as the session lays it out, read back off the session itself. */
interface HandleView {
    role: string;
    start: XYZ;
    end: XYZ;
    origin: XYZ;
    normal: XYZ;
}

interface FakeEditor {
    node: { plane: Plane };
    document: ReturnType<typeof createMockDocument>;
    solver: SketchSolver;
    /** The sketch's selection — what the user picks with. */
    selected: number[];
    /** The sketch's own event handler, which the session forwards to. */
    picking: IEventHandler;
    /** Every session the command opened, in order. */
    sessions: SketchTransformSession[];
    /** Every event the session handed on to the sketch's handler. */
    forwarded: string[];
    /** The `shiftKey` each of those pointer events carried. */
    forwardedShift: boolean[];
    /** The annotations' two switches, and every value they were set to. */
    annotations: { suppressConstraintSymbols: boolean; inertConstraintSymbols: boolean };
    suppressTimeline: boolean[];
    inertTimeline: boolean[];
    /** Every colour the handles have been painted with, oldest first. */
    arrowColors: (number | number[])[];
    /** Every point run the handles asked `polygon` for, oldest first. */
    glyphRuns: XYZ[][];
    /** The user's actions, one script per session; running out cancels the session. */
    scripts: ((session: SketchTransformSession, editor: FakeEditor) => void)[];
    solve: ReturnType<typeof rs.fn>;
    commit: ReturnType<typeof rs.fn>;
    forgetConstraints: ReturnType<typeof rs.fn>;
    screenTolerance: () => number;
    selectedEntityIds: () => number[];
    clearEntitySelection: ReturnType<typeof rs.fn>;
    endSession: () => void;
    isSessionAlive: () => boolean;
}

function fakeEditor(): FakeEditor {
    const { colors: arrowColors, runs: glyphRuns } = stubGizmoGeometry();
    const solver = new SketchSolver(Plane.XY);
    // no active view: the handles size themselves in pixels from one when there is one,
    // and fall back to their world length without — a headless test has no camera
    const document = createMockDocument({
        id: "transform-test",
        name: "transform-test",
        application: { activeView: undefined } as any,
    });

    const selected: number[] = [];
    const forwarded: string[] = [];
    const forwardedShift: boolean[] = [];
    const record = (kind: string) => (_view: unknown, event?: { shiftKey?: boolean }) => {
        forwarded.push(kind);
        if (kind !== "key") forwardedShift.push(event?.shiftKey === true);
    };
    const picking: IEventHandler = {
        isEnabled: true,
        pointerDown: rs.fn(record("down")),
        pointerMove: rs.fn(record("move")),
        pointerUp: rs.fn(record("up")),
        keyDown: rs.fn(record("key")),
        dispose: () => {},
    };

    const suppressTimeline: boolean[] = [];
    const inertTimeline: boolean[] = [];
    let suppressed = false;
    let inert = false;
    const annotations = {
        get suppressConstraintSymbols() {
            return suppressed;
        },
        set suppressConstraintSymbols(value: boolean) {
            if (value === suppressed) return;
            suppressed = value;
            suppressTimeline.push(value);
        },
        get inertConstraintSymbols() {
            return inert;
        },
        set inertConstraintSymbols(value: boolean) {
            if (value === inert) return;
            inert = value;
            inertTimeline.push(value);
        },
    };

    const sessions: SketchTransformSession[] = [];
    const scripts: ((session: SketchTransformSession, editor: FakeEditor) => void)[] = [];
    let sessionAlive = true;

    const fake: FakeEditor = {
        node: { plane: Plane.XY },
        document,
        solver,
        selected,
        picking,
        sessions,
        scripts,
        forwarded,
        forwardedShift,
        annotations,
        suppressTimeline,
        inertTimeline,
        arrowColors,
        glyphRuns,
        solve: rs.fn((_fine: boolean) => {}),
        commit: rs.fn(() => {}),
        forgetConstraints: rs.fn((_ids: Iterable<number>) => {}),
        screenTolerance: () => 1e-6,
        selectedEntityIds: () => [...selected],
        clearEntitySelection: rs.fn(() => {
            selected.length = 0;
        }),
        endSession: () => {
            sessionAlive = false;
        },
        isSessionAlive: () => sessionAlive,
    };

    (document as any).visual.eventHandler = picking;
    (document as any).picker = {
        pickAsync: rs.fn(
            async (
                session: SketchTransformSession,
                _tip: I18nKeys,
                controller: AsyncController,
                _control: unknown,
                cursor: string,
            ) => {
                sessions.push(session);
                expect(cursor).toBe("select.default");
                const script = scripts.shift();
                if (script === undefined) {
                    controller.cancel();
                    return;
                }
                script(session, fake);
                // a script that committed or cancelled has settled it already
                if (controller.result === undefined) controller.cancel();
            },
        ),
    };

    return fake;
}

async function runCommand(command: ICommand, editor: FakeEditor): Promise<void> {
    const getActive = rs
        .spyOn(SketchEditor, "getActive")
        .mockImplementation(() => (editor.isSessionAlive() ? (editor as any) : undefined));
    try {
        await command.execute({ activeView: { document: {} } } as any);
    } finally {
        getActive.mockRestore();
    }
}

/**
 * A view just rich enough for the paths that measure the handles: the handler tracks the
 * camera and sizes them in pixels off the viewport. One screen pixel per world unit, so a
 * handle's world position doubles as where the pointer has to go to grab it.
 */
function fakeView(cameraController?: {
    onPropertyChanged(callback: () => void): void;
    removePropertyChanged(callback: () => void): void;
}) {
    return {
        document: {
            visual: {
                context: { displayMesh: () => 1, removeMesh: () => {}, setVisible: () => {} },
                update: () => {},
            },
        },
        cameraController: cameraController ?? {
            onPropertyChanged: () => {},
            removePropertyChanged: () => {},
        },
        update: () => {},
        direction: () => XYZ.unitZ,
        up: () => XYZ.unitY,
        // looks straight down at the sketch plane, so a pointer at (x, y) lands on (x, y, 0)
        // and the plane's own (u, v) is just the screen position — see the drag test below
        rayAt: (x: number, y: number) =>
            new Ray({ point: new XYZ({ x, y, z: 100 }), direction: XYZ.unitZ.reverse() }),
        worldToScreen: (point: XYZ) => ({
            x: point.x,
            y: point.y,
            distanceTo: (other: { x: number; y: number }) => Math.hypot(other.x - point.x, other.y - point.y),
        }),
        width: 800,
        height: 600,
    } as never;
}

const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 6);

/** A pointer event at a screen position, with the fields the handlers read. */
function pointerAt(x: number, y: number): PointerEvent {
    return {
        button: 0,
        pointerType: "mouse",
        isPrimary: true,
        offsetX: x,
        offsetY: y,
        shiftKey: false,
    } as PointerEvent;
}

/** A pointer release far from every handle, which is what a session re-reads the selection on. */
function releaseEvent(): PointerEvent {
    return { button: 0, pointerType: "mouse", offsetX: -1000, offsetY: -1000 } as PointerEvent;
}

/** The handles the session has laid out, read off it rather than recomputed. */
function handlesOf(session: SketchTransformSession): HandleView[] {
    return (session as any).handles() as HandleView[];
}

/** The world length the session is drawing its handles at, which is what their axes are scaled to. */
function handleLength(session: SketchTransformSession): number {
    return (session as any).arrowLength ?? ARROW_LENGTH;
}

/** Presses on a handle, which is what freezes it as the gesture's axis. */
function grab(session: SketchTransformSession, role: string): void {
    const handle = handlesOf(session).find((candidate) => candidate.role === role);
    if (handle === undefined) throw new Error(`no handle ${role}`);
    const mid = handle.start.add(handle.end).multiply(0.5);
    session.pointerDown(fakeView(), pointerAt(mid.x, mid.y));
}

/** The axis the session would drag on, with the handle under the gesture grabbed first. */
function axisOf(session: SketchTransformSession, role: string): { origin: XYZ; normal: XYZ } {
    grab(session, role);
    return (session as any).axis() as { origin: XYZ; normal: XYZ };
}

/** Selects `ids` the way the sketch's own click path would, then re-anchors the triad. */
function select(session: SketchTransformSession, editor: FakeEditor, ids: readonly number[]): void {
    editor.selected.push(...ids);
    session.pointerUp(fakeView(), releaseEvent());
}

describe("SketchTransformCommand", () => {
    beforeEach(() => {
        // A command's options are cached statically, keyed by property name
        // (`CancelableCommand._propertiesCache`), and restored in `beforeExecute`. Left
        // alone, a value one case typed would reach the next command instance and turn
        // that case's transform into this one's — so the cache starts empty every time.
        (CancelableCommand as unknown as { _propertiesCache: Map<string, unknown> })._propertiesCache.clear();
    });

    test("registers the key the sketch ribbon points at", () => {
        const data = CommandStore.getComandData("sketch.transform");
        expect(data?.key).toBe("sketch.transform");
        expect(data?.icon).toBe("icon-transform");
    });

    test("puts nothing on the options bar but the cancel it inherits", () => {
        // The bar renders one field per `@property`, and the base class contributes a `cancel`
        // of its own. The four values are deliberately not declared: they are edited in the box
        // that rides the pointer, over the handle that moves them, and a field here would be a
        // second place to type the number the hand just moved the geometry to.
        const fields = PropertyUtils.getProperties(new SketchTransformCommand()).map((p) => p.name);

        expect(fields).toEqual(["cancel"]);
    });

    test("shows no handles until something is selected", async () => {
        const editor = fakeEditor();
        try {
            editor.solver.addLine(0, 0, 4, 0);
            editor.scripts.push((session) => {
                expect(handlesOf(session)).toEqual([]);
                expect((session as any).buildPreview().meshes).toEqual([]);
            });

            await runCommand(new SketchTransformCommand(), editor);
        } finally {
            editor.solver.dispose();
        }
    });

    test("lays a frame on the selection's centre, every handle measured from it", async () => {
        const editor = fakeEditor();
        try {
            const line = editor.solver.addLine(0, 0, 4, 0);
            editor.scripts.push((session) => {
                select(session, editor, [line]);
                const handles = handlesOf(session);

                expect(handles.map((handle) => handle.role).sort()).toEqual([
                    "free",
                    "origin",
                    "rotate",
                    "scale",
                    "translateU",
                    "translateV",
                ]);
                // the base is the selection's bounding-box centre, in world coordinates
                const base = handles.find((handle) => handle.role === "translateU")!.origin;
                expect(base.x).toBeCloseTo(2, 9);
                expect(base.y).toBeCloseTo(0, 9);

                // a triad, not scattered arrows: every arrow's drag is measured from the one
                // base. The three that point somewhere, that is — the square and the origin are
                // marks without a direction, and the dial rides out on its own arc.
                const pointing = ["translateU", "translateV", "scale"];
                const arrows = handles.filter((h) => pointing.includes(h.role));
                for (const arrow of arrows) {
                    expect(arrow.origin.distanceTo(base)).toBeCloseTo(0, 9);
                    // each tail starts a gap out, clear of the disc on the origin, and the head
                    // is further along the same ray
                    const tail = arrow.start.distanceTo(base);
                    expect(tail).toBeGreaterThan(0);
                    expect(arrow.end.distanceTo(base)).toBeGreaterThan(tail);
                }
                const along = (role: string) => {
                    const arrow = handles.find((handle) => handle.role === role)!;
                    return arrow.end.sub(base).normalize()!;
                };
                expect(along("translateU").cross(along("translateV")).z).toBeCloseTo(1, 9);
                expect(along("translateU").dot(along("scale"))).toBeCloseTo(Math.SQRT1_2, 9);
                // the square is a mark and not a direction, so it is one point on the diagonal,
                // between where the arrows start and where the scale mark's own base sits
                const free = handles.find((handle) => handle.role === "free")!;
                expect(free.origin.distanceTo(base)).toBeCloseTo(0, 9);
                expect(free.start.distanceTo(free.end)).toBeCloseTo(0, 9);
                expect(free.start.sub(base).normalize()!.dot(along("scale"))).toBeCloseTo(1, 9);
                expect(free.start.distanceTo(base)).toBeGreaterThan(
                    handles.find((handle) => handle.role === "translateU")!.start.distanceTo(base),
                );
                expect(free.start.distanceTo(base)).toBeLessThan(
                    handles.find((handle) => handle.role === "scale")!.start.distanceTo(base),
                );
                // the rotate handle's arc mark sits out on its circle about the base, past the
                // arrows' own reach, and it starts level with the plane's +x
                const rotate = handles.find((handle) => handle.role === "rotate")!;
                expect(rotate.start.distanceTo(base)).toBeGreaterThan(
                    handles.find((handle) => handle.role === "translateU")!.end.distanceTo(base),
                );
                expect(rotate.start.sub(base).normalize()!.x).toBeCloseTo(1, 9);
                // and its drag, like every other handle's, is measured from the base
                expect(rotate.origin.distanceTo(base)).toBeCloseTo(0, 9);
            });

            await runCommand(new SketchTransformCommand(), editor);
        } finally {
            editor.solver.dispose();
        }
    });

    test("grabs the handle the pointer is on, not the one a stale hover left", async () => {
        const editor = fakeEditor();
        try {
            const line = editor.solver.addLine(0, 0, 4, 0);
            editor.scripts.push((session) => {
                select(session, editor, [line]);
                const scale = handlesOf(session).find((handle) => handle.role === "scale")!;
                const mid = scale.start.add(scale.end).multiply(0.5);
                // straight down on the handle, with no move before it
                session.pointerDown(fakeView(), pointerAt(mid.x, mid.y));

                expect((session as any)._activeHandle).toBe("scale");
            });

            await runCommand(new SketchTransformCommand(), editor);
        } finally {
            editor.solver.dispose();
        }
    });

    test("scales each handle's drag axis in that handle's own unit", async () => {
        const editor = fakeEditor();
        try {
            const line = editor.solver.addLine(0, 0, 4, 0);
            editor.scripts.push((session) => {
                select(session, editor, [line]);
                const length = handleLength(session);

                // a translation arrow measures a world distance
                expect(axisOf(session, "translateU").normal.length()).toBeCloseTo(1, 9);
                // the scale handle measures the ratio of the pointer's reach to the arrow's own
                expect(axisOf(session, "scale").normal.length()).toBeCloseTo(1 / length, 9);
                // the rotate handle measures degrees of arc about the pivot, on its own radius
                const rotate = handlesOf(session).find((handle) => handle.role === "rotate")!;
                const base = handlesOf(session).find((handle) => handle.role === "translateU")!.origin;
                const ringRadius = rotate.start.add(rotate.end).multiply(0.5).distanceTo(base);
                expect(axisOf(session, "rotate").normal.length()).toBeCloseTo(
                    180 / (Math.PI * ringRadius),
                    9,
                );
            });

            await runCommand(new SketchTransformCommand(), editor);
        } finally {
            editor.solver.dispose();
        }
    });

    test("reads the drag from where the gesture started, not from where the frame got to", async () => {
        const editor = fakeEditor();
        try {
            const line = editor.solver.addLine(0, 0, 4, 0);
            editor.scripts.push((session) => {
                select(session, editor, [line]);
                const before = handlesOf(session).find((handle) => handle.role === "translateU")!;
                grab(session, "translateU");
                const atGrab = (session as any).axis() as { origin: XYZ; normal: XYZ };
                session.setValue(30);
                const after = handlesOf(session).find((handle) => handle.role === "translateU")!;

                // the frame itself travelled with the value — which is the whole point of it
                near(after.origin.distanceTo(before.origin), 30);
                // …but what the drag measures from did not. Anchored on the travelling base it
                // would read its own last step back, and the handle would jitter in place under
                // a pointer that never moved.
                const locked = (session as any).axis() as { origin: XYZ; normal: XYZ };
                near(locked.origin.distanceTo(atGrab.origin), 0);
                near(locked.normal.distanceTo(atGrab.normal), 0);
            });

            await runCommand(new SketchTransformCommand(), editor);
        } finally {
            editor.solver.dispose();
        }
    });

    test("drags the square both ways at once, from the point it was taken hold of", async () => {
        const editor = fakeEditor();
        try {
            const line = editor.solver.addLine(0, 0, 4, 0);
            editor.scripts.push((session) => {
                select(session, editor, [line]);
                const square = handlesOf(session).find((handle) => handle.role === "free")!;

                // the press lands on the mark itself, and what it reads is the pointer's own
                // travel across the plane — one move, both inputs, no axis between them
                session.pointerDown(fakeView(), pointerAt(square.start.x, square.start.y));
                session.pointerMove(fakeView(), pointerAt(square.start.x + 25, square.start.y - 15));

                near(session.transform.du, 25);
                near(session.transform.dv, -15);
            });

            await runCommand(new SketchTransformCommand(), editor);
        } finally {
            editor.solver.dispose();
        }
    });

    test("an abandoned square drag puts the geometry back where it found it", async () => {
        const editor = fakeEditor();
        try {
            const line = editor.solver.addLine(0, 0, 4, 0);
            editor.scripts.push((session) => {
                select(session, editor, [line]);
                const square = handlesOf(session).find((handle) => handle.role === "free")!;

                // the click-move-click path, since it is the one with a way out of it
                session.pointerDown(fakeView(), pointerAt(square.start.x, square.start.y));
                session.pointerUp(fakeView(), pointerAt(square.start.x, square.start.y));
                session.pointerMove(fakeView(), pointerAt(square.start.x + 40, square.start.y + 10));
                near(session.transform.du, 40);

                // Escape leaves the click-move gesture, and the move it was carrying with it
                session.keyDown(fakeView(), {
                    key: "Escape",
                    preventDefault() {},
                    stopImmediatePropagation() {},
                } as unknown as KeyboardEvent);

                near(session.transform.du, 0);
                near(session.transform.dv, 0);
            });

            await runCommand(new SketchTransformCommand(), editor);
        } finally {
            editor.solver.dispose();
        }
    });

    test("keeps a box under the pointer showing what the drag is at", async () => {
        const editor = fakeEditor();
        const shown: string[] = [];
        const updated: string[] = [];
        let cleared = 0;
        let typed: ((text: string) => unknown) | undefined;
        let openedWith: ShowInputOptions | undefined;
        const onShow = (text: string, handler: (t: string) => unknown, options?: ShowInputOptions) => {
            shown.push(text);
            typed = handler;
            openedWith = options;
        };
        const onUpdate = (text: string) => updated.push(text);
        const onClear = () => cleared++;
        PubSub.default.sub("showInput", onShow);
        PubSub.default.sub("updateInput", onUpdate);
        PubSub.default.sub("clearInput", onClear);

        try {
            const line = editor.solver.addLine(0, 0, 4, 0);
            editor.scripts.push((session) => {
                select(session, editor, [line]);
                const arrow = handlesOf(session).find((handle) => handle.role === "translateU")!;

                // the drag measures from where it takes hold rather than from the press, so the
                // box opens at nought and follows the hand from there — 25 then 40 across the
                // plane, which is 15 of the arrow's own unit apart
                session.pointerDown(fakeView(), pointerAt(arrow.start.x, arrow.start.y));
                session.pointerMove(fakeView(), pointerAt(arrow.start.x + 25, arrow.start.y));
                session.pointerMove(fakeView(), pointerAt(arrow.start.x + 40, arrow.start.y));

                // put up once for the gesture with the first value, then followed rather than
                // re-shown — a second box would be a second handler over the same slot
                expect(shown).toEqual(["0"]);
                expect(updated).toEqual(["15"]);
                // opened with its number taken as a whole, so typing replaces it — but as a
                // readout that leaves the keyboard with the drag: Enter still confirms the
                // gesture rather than being swallowed by a box the hand never aimed at
                expect(openedWith?.selectAll).toBe(true);
                expect(openedWith?.takeFocus).toBe(false);

                // and the box is an input: what it is handed is what the drag takes
                expect(typed).toBeDefined();
                expect((typed!("12") as { isOk: boolean }).isOk).toBe(true);
                near(session.transform.du, 12);

                // a value arriving from the options bar takes the readout down rather than
                // leaving it under the pointer holding a number the transform no longer has
                const clearedBefore = cleared;
                session.setField("distanceX", 4);
                expect(cleared).toBe(clearedBefore + 1);
                expect(session.transform.du).toBeCloseTo(4, 9);
            });

            await runCommand(new SketchTransformCommand(), editor);
        } finally {
            PubSub.default.remove("showInput", onShow);
            PubSub.default.remove("updateInput", onUpdate);
            PubSub.default.remove("clearInput", onClear);
            editor.solver.dispose();
        }
    });

    test("puts a fresh readout up after the box itself came down mid-gesture", async () => {
        const editor = fakeEditor();
        const shown: string[] = [];
        const updated: string[] = [];
        let close: (() => void) | undefined;
        const onShow = (text: string, _handler: unknown, options?: ShowInputOptions) => {
            shown.push(text);
            close = options?.onClose;
        };
        const onUpdate = (text: string) => updated.push(text);
        PubSub.default.sub("showInput", onShow);
        PubSub.default.sub("updateInput", onUpdate);

        try {
            const line = editor.solver.addLine(0, 0, 4, 0);
            editor.scripts.push((session) => {
                select(session, editor, [line]);
                const arrow = handlesOf(session).find((handle) => handle.role === "translateU")!;
                session.pointerDown(fakeView(), pointerAt(arrow.start.x, arrow.start.y));
                session.pointerMove(fakeView(), pointerAt(arrow.start.x + 25, arrow.start.y));
                expect(shown).toEqual(["0"]);
                expect(close).toBeDefined();

                // the box went away on its own (Escape in it, say): the drag's next step must
                // not update a box that is gone — it puts a fresh one up instead
                close!();
                session.pointerMove(fakeView(), pointerAt(arrow.start.x + 40, arrow.start.y));
                expect(shown).toEqual(["0", "15"]);
                expect(updated).toEqual([]);
            });

            await runCommand(new SketchTransformCommand(), editor);
        } finally {
            PubSub.default.remove("showInput", onShow);
            PubSub.default.remove("updateInput", onUpdate);
            editor.solver.dispose();
        }
    });

    test("keeps the readout up after the drag, and takes it down for a drag with none", async () => {
        const editor = fakeEditor();
        const shown: string[] = [];
        let cleared = 0;
        let typed: ((text: string) => unknown) | undefined;
        const onShow = (text: string, handler: (t: string) => unknown, options?: ShowInputOptions) => {
            shown.push(text);
            if (options?.takeFocus === false) typed = handler;
        };
        const onClear = () => cleared++;
        PubSub.default.sub("showInput", onShow);
        PubSub.default.sub("clearInput", onClear);

        try {
            const line = editor.solver.addLine(0, 0, 4, 0);
            editor.scripts.push((session) => {
                select(session, editor, [line]);
                const arrow = handlesOf(session).find((handle) => handle.role === "translateU")!;
                session.pointerDown(fakeView(), pointerAt(arrow.start.x, arrow.start.y));
                session.pointerMove(fakeView(), pointerAt(arrow.start.x + 25, arrow.start.y));
                expect(shown).toEqual(["0"]);

                session.pointerUp(fakeView(), pointerAt(arrow.start.x + 25, arrow.start.y));
                // the gesture is over; the box is not — the number it holds can still be
                // typed over, which is the whole point of leaving it up. (The one clear so
                // far is the one the show itself published first.)
                expect(cleared).toBe(1);
                expect((typed!("30") as { isOk: boolean }).isOk).toBe(true);
                near(session.transform.du, 30);

                // but a drag that keeps no readout of its own must not ride on under it:
                // the square's press takes the lingering box down before moving anything
                const square = handlesOf(session).find((handle) => handle.role === "free")!;
                session.pointerDown(fakeView(), pointerAt(square.start.x, square.start.y));
                expect(cleared).toBe(2);
                session.pointerMove(fakeView(), pointerAt(square.start.x + 10, square.start.y + 10));
                session.pointerUp(fakeView(), pointerAt(square.start.x + 10, square.start.y + 10));
                expect(shown).toEqual(["0"]);
            });

            await runCommand(new SketchTransformCommand(), editor);
        } finally {
            PubSub.default.remove("showInput", onShow);
            PubSub.default.remove("clearInput", onClear);
            editor.solver.dispose();
        }
    });

    test("drags the origin to move the triad, and leaves the geometry where it is", async () => {
        const editor = fakeEditor();
        try {
            const line = editor.solver.addLine(0, 0, 4, 0);
            editor.scripts.push((session) => {
                select(session, editor, [line]);
                const base = handlesOf(session).find((handle) => handle.role === "origin")!.start;
                near(base.x, 2);

                session.pointerDown(fakeView(), pointerAt(base.x, base.y));
                session.pointerMove(fakeView(), pointerAt(base.x + 25, base.y - 15));

                // the triad is somewhere else now, and the transform it would commit about is
                // the same somewhere else — they are one point, not two that agree
                expect(session.base![0]).toBeCloseTo(27, 6);
                expect(session.base![1]).toBeCloseTo(-15, 6);
                // and nothing has moved: the values are what they were, which is also what
                // leaves the preview empty — the handles are up, and that is all that is
                near(session.transform.du, 0);
                near(session.transform.dv, 0);
                expect(session.transform.angle).toBe(0);
                expect(session.transform.scale).toBe(1);
                expect((session as any).canConfirm()).toBe(false);
            });

            await runCommand(new SketchTransformCommand(), editor);
        } finally {
            editor.solver.dispose();
        }
    });

    test("dragging the origin after a rotation keeps the preview where it settled", async () => {
        const editor = fakeEditor();
        try {
            const line = editor.solver.addLine(0, 0, 4, 0);
            editor.scripts.push((session) => {
                select(session, editor, [line]);
                session.setField("angle", 90);
                // where a point lands under the settled transform — the preview's own answer
                const landedBefore = transformPoint([4, 0], session.base!, session.transform);

                const base = handlesOf(session).find((handle) => handle.role === "origin")!.start;
                session.pointerDown(fakeView(), pointerAt(base.x, base.y));
                session.pointerMove(fakeView(), pointerAt(base.x + 10, base.y));

                // the triad went with the hand: base + move is its drawn spot, ten over
                near(session.base![0] + session.transform.du, 12);
                near(session.base![1] + session.transform.dv, 0);
                // but the transform it anchors did not go with it — the translation absorbed
                // the pivot's travel, so the preview is the same landing it was
                const landedAfter = transformPoint([4, 0], session.base!, session.transform);
                near(landedAfter[0], landedBefore[0]);
                near(landedAfter[1], landedBefore[1]);
                // and the coming turn still happens about the triad's new spot
                near(session.transform.angle, Math.PI / 2);
            });

            await runCommand(new SketchTransformCommand(), editor);
        } finally {
            editor.solver.dispose();
        }
    });

    test("snaps the triad itself onto the sketch, not the spot its move carries it past", async () => {
        const editor = fakeEditor();
        try {
            const line = editor.solver.addLine(0, 0, 4, 0);
            editor.solver.addLine(12, 5, 16, 5);
            editor.scripts.push((session) => {
                select(session, editor, [line]);
                // a move already carried, so the triad sits five over and five up from the pivot
                session.setField("distanceX", 5);
                session.setField("distanceY", 5);

                const base = handlesOf(session).find((handle) => handle.role === "origin")!.start;
                near(base.x, 7);
                near(base.y, 5);
                // aimed straight at the other line's start: the snap takes the triad
                session.pointerDown(fakeView(), pointerAt(base.x, base.y));
                session.pointerMove(fakeView(), pointerAt(12, 5));

                // the triad lands ON the snapped point of the sketch — not five-and-five off
                // it, which is where the preview's image of that point lies
                near(session.base![0] + session.transform.du, 12);
                near(session.base![1] + session.transform.dv, 5);
                // and the preview kept its settled landing through the re-anchor
                const moved = transformPoint([0, 0], session.base!, session.transform);
                near(moved[0], 5);
                near(moved[1], 5);
            });

            await runCommand(new SketchTransformCommand(), editor);
        } finally {
            editor.solver.dispose();
        }
    });

    test("letting go of the origin does not leave it following the pointer", async () => {
        const editor = fakeEditor();
        try {
            const line = editor.solver.addLine(0, 0, 4, 0);
            editor.scripts.push((session) => {
                select(session, editor, [line]);
                const base = handlesOf(session).find((handle) => handle.role === "origin")!.start;

                // a drag, so the release lands back on the mark the pointer has been carrying
                session.pointerDown(fakeView(), pointerAt(base.x, base.y));
                session.pointerMove(fakeView(), pointerAt(base.x + 20, base.y));
                session.pointerUp(fakeView(), pointerAt(base.x + 20, base.y));
                const settled = session.base![0];

                // and letting go means the triad stays put: no click-move gesture to carry it on
                session.pointerMove(fakeView(), pointerAt(base.x + 200, base.y + 100));
                near(session.base![0], settled);
            });

            await runCommand(new SketchTransformCommand(), editor);
        } finally {
            editor.solver.dispose();
        }
    });

    test("lands the origin exactly on a snapped point, and badges it", async () => {
        const editor = fakeEditor();
        const tips: string[] = [];
        const onTip = (dom: unknown) => tips.push(typeof dom === "string" ? dom : "badge");
        PubSub.default.sub("showFloatTip", onTip as never);
        // the fake editor has no viewport to measure a tolerance in; this test is about what
        // happens inside one, not about the pixels it comes from
        editor.screenTolerance = () => 0.5;

        try {
            const line = editor.solver.addLine(0, 0, 4, 0);
            editor.scripts.push((session) => {
                select(session, editor, [line]);
                const origin = handlesOf(session).find((handle) => handle.role === "origin")!.start;

                session.pointerDown(fakeView(), pointerAt(origin.x, origin.y));

                // out in the open first: the plain drag, offset from where it was taken hold of
                session.pointerMove(fakeView(), pointerAt(10, 10));
                near(session.base![0], 10);
                near(session.base![1], 10);

                // and then near the line's own end, not onto it: what lands on it is the
                // triad's centre — the pixels between the finger and the disc's middle are
                // exactly what a snap is there to stop mattering
                session.pointerMove(fakeView(), pointerAt(0.3, -0.2));
                near(session.base![0], 0);
                near(session.base![1], 0);
                expect(tips).toContain("badge");
            });

            await runCommand(new SketchTransformCommand(), editor);
        } finally {
            PubSub.default.remove("showFloatTip", onTip as never);
            editor.solver.dispose();
        }
    });

    test("an abandoned origin drag puts the triad back where it found it", async () => {
        const editor = fakeEditor();
        try {
            const line = editor.solver.addLine(0, 0, 4, 0);
            editor.scripts.push((session) => {
                select(session, editor, [line]);
                // a scale already settled, so the abandon has something to keep its hands off:
                // the origin carries no value, and resetting its gesture must not invent one
                session.setField("scale", 2);
                const base = handlesOf(session).find((handle) => handle.role === "origin")!.start;

                session.pointerDown(fakeView(), pointerAt(base.x, base.y));
                session.pointerUp(fakeView(), pointerAt(base.x, base.y));
                session.pointerMove(fakeView(), pointerAt(base.x + 40, base.y + 10));
                // the triad is what the hand carries: it lands under the pointer, while the
                // pivot it re-anchors and the translation absorbing the travel stay out of
                // sight — base + move is the triad's own spot
                expect(session.base![0] + session.transform.du).toBeCloseTo(42, 6);
                expect(session.base![1] + session.transform.dv).toBeCloseTo(10, 6);

                session.keyDown(fakeView(), {
                    key: "Escape",
                    preventDefault() {},
                    stopImmediatePropagation() {},
                } as unknown as KeyboardEvent);

                // back on the selection's own centre, which is what the pivot is until it is
                // taken hold of — and the scale is still the user's two, not a zero the
                // origin's reset would have leaked into it
                near(session.base![0], 2);
                near(session.base![1], 0);
                near(session.transform.du, 0);
                near(session.transform.dv, 0);
                near(session.transform.scale, 2);
            });

            await runCommand(new SketchTransformCommand(), editor);
        } finally {
            editor.solver.dispose();
        }
    });

    test("an abandoned scale drag puts the scale back at one, not zero", async () => {
        const editor = fakeEditor();
        try {
            const line = editor.solver.addLine(0, 0, 4, 0);
            editor.scripts.push((session) => {
                select(session, editor, [line]);
                const mark = handlesOf(session).find((handle) => handle.role === "scale")!;
                const mid = mark.start.add(mark.end).multiply(0.5);

                // the click-move-click path, since it is the one with a way out of it
                session.pointerDown(fakeView(), pointerAt(mid.x, mid.y));
                session.pointerUp(fakeView(), pointerAt(mid.x, mid.y));
                session.pointerMove(fakeView(), pointerAt(mid.x + 30, mid.y + 30));
                const grown = session.transform.scale;
                expect(grown).not.toBeCloseTo(1, 6);

                session.keyDown(fakeView(), {
                    key: "Escape",
                    preventDefault() {},
                    stopImmediatePropagation() {},
                } as unknown as KeyboardEvent);

                // a scale's nought is one: zero would collapse the preview onto the base and
                // take the confirm with it, which is not what abandoning a gesture means
                near(session.transform.scale, 1);
            });

            await runCommand(new SketchTransformCommand(), editor);
        } finally {
            editor.solver.dispose();
        }
    });

    test("typing with the origin aimed at changes no scale", async () => {
        const editor = fakeEditor();
        let typed: ((text: string) => unknown) | undefined;
        const onShow = (_text: string, handler: (t: string) => unknown) => {
            typed = handler;
        };
        PubSub.default.sub("showInput", onShow);
        try {
            const line = editor.solver.addLine(0, 0, 4, 0);
            editor.scripts.push((session) => {
                select(session, editor, [line]);
                const base = handlesOf(session).find((handle) => handle.role === "origin")!.start;

                // hovering the origin makes it the handle a digit would be typed for — and the
                // origin has no number to take, so the scale must not be the one that answers
                session.pointerMove(fakeView(), pointerAt(base.x, base.y));
                session.keyDown(fakeView(), { key: "3" } as KeyboardEvent);
                expect(typed).toBeDefined();
                typed!("3");

                near(session.transform.scale, 1);
                near(session.transform.du, 0);
            });

            await runCommand(new SketchTransformCommand(), editor);
        } finally {
            PubSub.default.remove("showInput", onShow);
            editor.solver.dispose();
        }
    });

    test("carries the whole frame along with the geometry it transforms", async () => {
        const editor = fakeEditor();
        try {
            const line = editor.solver.addLine(0, 0, 4, 0);
            editor.scripts.push((session) => {
                select(session, editor, [line]);
                const before = handlesOf(session);
                const base = before.find((handle) => handle.role === "translateU")!.origin;

                grab(session, "translateU");
                session.setValue(30);
                // one piece, not four arrows that share a base: every handle travelled by the
                // same move, so what the user was aiming at is still there to aim at
                for (const [index, handle] of handlesOf(session).entries()) {
                    near(handle.start.distanceTo(before[index].start), 30);
                    near(handle.origin.distanceTo(base), 30);
                }

                grab(session, "rotate");
                session.setValue(90);
                // and a turn turns the whole frame: the +along arrow now points along +y
                const turned = handlesOf(session);
                const arrow = turned.find((handle) => handle.role === "translateU")!;
                const direction = arrow.end.sub(arrow.start).normalize()!;
                near(direction.x, 0);
                near(direction.y, 1);
            });

            await runCommand(new SketchTransformCommand(), editor);
        } finally {
            editor.solver.dispose();
        }
    });

    test("dragging a handle settles only that handle's own value", async () => {
        const editor = fakeEditor();
        try {
            const line = editor.solver.addLine(0, 0, 4, 0);
            editor.scripts.push((session) => {
                select(session, editor, [line]);
                grab(session, "translateU");
                session.setValue(5);

                expect(session.transform.du).toBeCloseTo(5, 9);
                expect(session.transform.dv).toBe(0);
                expect(session.transform.angle).toBe(0);
                expect(session.transform.scale).toBe(1);
            });

            await runCommand(new SketchTransformCommand(), editor);
        } finally {
            editor.solver.dispose();
        }
    });

    test("an input pushes its value into the session, angles in degrees", async () => {
        const editor = fakeEditor();
        try {
            const line = editor.solver.addLine(0, 0, 4, 0);
            const command = new SketchTransformCommand();
            editor.scripts.push((session) => {
                select(session, editor, [line]);
                command.distanceX = 5;
                command.scale = 2;
                command.angle = 90;

                expect(session.transform.du).toBeCloseTo(5, 9);
                expect(session.transform.scale).toBeCloseTo(2, 9);
                // 90 degrees reaches the op as a quarter turn in radians
                expect(session.transform.angle).toBeCloseTo(Math.PI / 2, 9);
            });

            await runCommand(command, editor);
        } finally {
            editor.solver.dispose();
        }
    });

    test("an expression typed into an input survives the session's echo", async () => {
        const editor = fakeEditor();
        try {
            const line = editor.solver.addLine(0, 0, 4, 0);
            const command = new SketchTransformCommand();
            editor.scripts.push((session) => {
                select(session, editor, [line]);
                // a drag reports its number back through the input
                grab(session, "translateV");
                session.setValue(3);
                expect(command.distanceY).toBeCloseTo(3, 9);

                command.distanceY = "2*3";
                expect(session.transform.dv).toBeCloseTo(6, 9);
                // and the expression itself is what the input still holds
                expect(command.distanceY).toBe("2*3");
            });

            await runCommand(command, editor);
        } finally {
            editor.solver.dispose();
        }
    });

    test("confirming moves the geometry, commits once and reports nothing dropped", async () => {
        const editor = fakeEditor();
        try {
            const line = editor.solver.addLine(0, 0, 4, 0);
            editor.scripts.push((session) => {
                select(session, editor, [line]);
                grab(session, "translateV");
                session.setValue(7);
                (session as any).confirm();
            });

            await runCommand(new SketchTransformCommand(), editor);

            expect(editor.commit).toHaveBeenCalledTimes(1);
            expect(editor.forgetConstraints).not.toHaveBeenCalled();
            expect(editor.clearEntitySelection).toHaveBeenCalledTimes(1);
            const params = editor.solver.entity(line)!.params;
            expect(params[1]).toBeCloseTo(7, 9);
            expect(params[3]).toBeCloseTo(7, 9);
        } finally {
            editor.solver.dispose();
        }
    });

    test("drops the constraints the move cannot keep, and says how many", async () => {
        const editor = fakeEditor();
        const tip = rs.spyOn(PubSub.default, "pub");
        try {
            const line = editor.solver.addLine(0, 0, 4, 0);
            const pin = editor.solver.addConstraint({
                kind: ConstraintKind.Fix,
                refs: [{ entityId: line, pointIndex: 0 }],
                datums: [0, 0],
            });
            editor.scripts.push((session) => {
                select(session, editor, [line]);
                grab(session, "translateU");
                session.setValue(10);
                (session as any).confirm();
            });

            await runCommand(new SketchTransformCommand(), editor);

            expect(editor.forgetConstraints).toHaveBeenCalledTimes(1);
            const reported = editor.forgetConstraints.mock.calls[0][0] as number[];
            expect(reported).toContain(pin);
            expect(tip).toHaveBeenCalledWith("statusBarTip", "sketch.transformRemovedConstraints{0}", 1);
            expect(editor.commit).toHaveBeenCalledTimes(1);
        } finally {
            tip.mockRestore();
            editor.solver.dispose();
        }
    });

    test("a cancelled session leaves the sketch alone", async () => {
        const editor = fakeEditor();
        try {
            const line = editor.solver.addLine(0, 0, 4, 0);
            const before = JSON.stringify(editor.solver.toData());
            editor.scripts.push((session) => {
                select(session, editor, [line]);
                grab(session, "translateU");
                session.setValue(5);
                // no confirm: the controller is cancelled by the picker's own fallback
            });

            await runCommand(new SketchTransformCommand(), editor);

            expect(editor.commit).not.toHaveBeenCalled();
            expect(JSON.stringify(editor.solver.toData())).toBe(before);
        } finally {
            editor.solver.dispose();
        }
    });

    test("previews the moved geometry together with the four handles", async () => {
        const editor = fakeEditor();
        try {
            const line = editor.solver.addLine(0, 0, 4, 0);
            editor.scripts.push((session) => {
                select(session, editor, [line]);
                grab(session, "translateU");
                session.setValue(5);

                const meshes = (session as any).buildPreview().meshes as unknown[];
                // an outline and a fill for each arrow, the triangle and the square; the arc's
                // two strokes and the knob's pair; the origin disc's three layers; and one
                // dashed copy of the moved line
                expect(meshes).toHaveLength(16);
            });

            await runCommand(new SketchTransformCommand(), editor);
        } finally {
            editor.solver.dispose();
        }
    });

    test("hands the kernel closed point runs, so a triangle meshes as a triangle", async () => {
        const editor = fakeEditor();
        try {
            const line = editor.solver.addLine(0, 0, 4, 0);
            editor.scripts.push((session) => {
                editor.glyphRuns.length = 0;
                select(session, editor, [line]);
                (session as any).buildPreview();

                // The scale mark is the one glyph whose outline is a bare triangle, and a run
                // of three points that does not come back to where it started is the shape
                // `MakePolygon` leaves open — which `MakeFace` then closes its own way, meshing
                // that mark to a sliver a third of its own height. Every run closes, or this
                // comes back the moment a glyph is drawn as an odd number of corners.
                expect(editor.glyphRuns.length).toBeGreaterThan(0);
                for (const run of editor.glyphRuns) {
                    expect(run.length).toBeGreaterThan(2);
                    expect(run[0].distanceTo(run[run.length - 1])).toBeLessThanOrEqual(1e-9);
                }
                // and the triangle really is in there, at three corners before closing
                expect(editor.glyphRuns.some((run) => run.length === 4)).toBe(true);
            });

            await runCommand(new SketchTransformCommand(), editor);
        } finally {
            editor.solver.dispose();
        }
    });

    test("redraws the handles when the camera moves, so they keep their pixel size", async () => {
        const editor = fakeEditor();
        const context = editor.document.visual.context as unknown as { displayMesh: () => number };
        const originalDisplay = context.displayMesh;
        let displays = 0;
        context.displayMesh = () => displays++;
        let fireCamera: (() => void) | undefined;
        const cameraController = {
            onPropertyChanged: (callback: () => void) => {
                fireCamera = callback;
            },
            removePropertyChanged: () => {},
        };
        try {
            const line = editor.solver.addLine(0, 0, 4, 0);
            editor.scripts.push((session) => {
                select(session, editor, [line]);
                // hovering empty space: the handler now tracks this view's camera
                session.pointerMove(fakeView(cameraController), pointerAt(500, 500));
                expect(fireCamera).toBeDefined();
                const before = displays;
                fireCamera!();
                // a zoom rebuilt the preview with no gesture on a handle involved
                expect(displays).toBeGreaterThan(before);
            });

            await runCommand(new SketchTransformCommand(), editor);
        } finally {
            context.displayMesh = originalDisplay;
            editor.solver.dispose();
        }
    });

    test("takes the constraint badges out of the pointer's way while a handle is aimed at", async () => {
        const editor = fakeEditor();
        try {
            const line = editor.solver.addLine(0, 0, 4, 0);
            editor.scripts.push((session) => {
                select(session, editor, [line]);
                grab(session, "translateU");
                session.setValue(5);
                (session as any).confirm();
            });

            await runCommand(new SketchTransformCommand(), editor);

            // up while a handle is under the pointer, down again once nothing is
            expect(editor.inertTimeline).toEqual([true, false]);
            // and the sketch's own badges stay out of the way for the whole session
            expect(editor.suppressTimeline).toEqual([true, false]);
            expect(editor.annotations.suppressConstraintSymbols).toBe(false);
        } finally {
            editor.solver.dispose();
        }
    });

    test("commits nothing when the session dies under the drag", async () => {
        const editor = fakeEditor();
        try {
            const line = editor.solver.addLine(0, 0, 4, 0);
            editor.scripts.push((session) => {
                select(session, editor, [line]);
                grab(session, "translateU");
                session.setValue(5);
                (session as any).confirm();
                editor.endSession();
            });

            await runCommand(new SketchTransformCommand(), editor);

            expect(editor.commit).not.toHaveBeenCalled();
        } finally {
            editor.solver.dispose();
        }
    });

    test("moves the selection the sketch picked, not the one the transform started with", async () => {
        const editor = fakeEditor();
        try {
            const first = editor.solver.addLine(0, 0, 4, 0);
            const second = editor.solver.addLine(10, 0, 14, 0);
            editor.scripts.push((session) => {
                select(session, editor, [first]);
                // the selection grows during the session, as a box or an added click would
                select(session, editor, [second]);
                grab(session, "translateU");
                session.setValue(3);
                (session as any).confirm();
            });

            await runCommand(new SketchTransformCommand(), editor);

            expect(editor.solver.entity(first)!.params[0]).toBeCloseTo(3, 9);
            expect(editor.solver.entity(second)!.params[0]).toBeCloseTo(13, 9);
        } finally {
            editor.solver.dispose();
        }
    });
});

describe("additivePick", () => {
    /** A press as the viewport hands it over, with the fields the sketch and its labels read. */
    function press(x: number, y: number, shiftKey = false): PointerEvent {
        return {
            offsetX: x,
            offsetY: y,
            clientX: x + 60,
            clientY: y + 80,
            button: 0,
            shiftKey,
            target: document.body,
            preventDefault: () => {},
        } as unknown as PointerEvent;
    }

    test("carries everything the sketch reads, client coordinates and preventDefault included", () => {
        const forwarded = additivePick(press(12, 7));

        // the set adds rather than replaces: that is the whole point of the forwarding
        expect(forwarded.shiftKey).toBe(true);
        expect(forwarded.offsetX).toBe(12);
        expect(forwarded.offsetY).toBe(7);
        // a press that lands on a dimension goes into the label drag, which reads the client
        // coordinates and calls preventDefault — a bare cast used to throw on exactly this
        expect(forwarded.clientX).toBe(72);
        expect(forwarded.clientY).toBe(87);
        expect(() => forwarded.preventDefault()).not.toThrow();
    });

    test("leaves an already-additive event the one it was", () => {
        const event = press(3, 4, true);
        expect(additivePick(event)).toBe(event);
    });
});
