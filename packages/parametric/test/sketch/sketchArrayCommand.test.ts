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
    PubSub,
    XYZ,
} from "@chili3d/core";
import { createMockDocument, setupShapeFactoryMock } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { type ArrayDraft, arrayInstanceTotal, liveInstanceIds } from "../../src/sketch/arrayOps";
import { SketchArrayCommand, type SketchArraySession } from "../../src/sketch/commands/sketchArray";
import { SketchEditor } from "../../src/sketch/editor/sketchEditor";
import { originRef, SKETCH_X_AXIS_ID, type SketchPointRef } from "../../src/sketch/sketchModel";
import { SketchSolver } from "../../src/sketch/solver";
import "./setup";

/**
 * The arrow meshes through `arrowMeshes`, which runs on the shape factory — absent outside the
 * wasm package. A shape that reports a mesh and disposes is all it needs (the same stub the
 * offset command's test uses).
 */
function stubArrowGeometry(): void {
    const shape = () => {
        const faces: { position: Float32Array; range: number[]; color?: number } = {
            position: new Float32Array(),
            range: [],
        };
        Object.defineProperty(faces, "color", { get: () => undefined, set: () => {} });
        return { isOk: true, value: { mesh: { faces }, dispose: () => {} } };
    };
    setupShapeFactoryMock({ cylinder: shape, cone: shape });
}

interface EntityPick {
    readonly tip: I18nKeys;
    readonly type: string | undefined;
    readonly datum: boolean;
}

interface PointPick {
    readonly tip: I18nKeys;
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
    sessions: SketchArraySession[];
    /** The prompt each session was opened with. */
    sessionTips: I18nKeys[];
    /** What each session previewed, as its meshes' first two points. */
    previews: number[][][];
    /** The array a run was opened on, as `SketchEditor.editArray` hands one over. */
    editArray: (arrayId: number) => void;
    takeArrayEditTarget: () => number | undefined;
    /** Every reference pick the command made, in order. */
    entityPicks: EntityPick[];
    pointPicks: PointPick[];
    /** What the next reference pick answers with; running out ends the step. */
    entityAnswers: (number | undefined)[];
    pointAnswers: (SketchPointRef | undefined)[];
    /** Every event the session handed on to the sketch's handler. */
    forwarded: string[];
    /** The `shiftKey` each of those pointer events carried. */
    forwardedShift: boolean[];
    /** The annotations' switch for letting pointer events through the badges. */
    annotations: { inertConstraintSymbols: boolean; refresh: ReturnType<typeof rs.fn> };
    /** The draft the tool hands over while it is up — see `SketchEditor.arrayDraft`. */
    arrayDraft: ArrayDraft | undefined;
    /** The user's actions, one script per session; running out cancels the session. */
    scripts: ((session: SketchArraySession, editor: FakeEditor) => void)[];
    solve: ReturnType<typeof rs.fn>;
    commit: ReturnType<typeof rs.fn>;
    screenTolerance: () => number;
    selectedEntityIds: () => number[];
    clearEntitySelection: ReturnType<typeof rs.fn>;
    endSession: () => void;
    isSessionAlive: () => boolean;
}

function fakeEditor(): FakeEditor {
    stubArrowGeometry();
    const solver = new SketchSolver(Plane.XY);
    // no active view: the arrow sizes itself in pixels from one when there is one, and falls
    // back to its world length without — a headless test has no camera
    const document = createMockDocument({
        id: "array-test",
        name: "array-test",
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

    const sessions: SketchArraySession[] = [];
    const sessionTips: I18nKeys[] = [];
    const previews: number[][][] = [];
    const entityPicks: EntityPick[] = [];
    const pointPicks: PointPick[] = [];
    const entityAnswers: (number | undefined)[] = [];
    const pointAnswers: (SketchPointRef | undefined)[] = [];
    const scripts: ((session: SketchArraySession, editor: FakeEditor) => void)[] = [];
    let sessionAlive = true;
    let editTarget: number | undefined;

    const fake: FakeEditor = {
        node: { plane: Plane.XY },
        document,
        solver,
        selected,
        picking,
        sessions,
        sessionTips,
        previews,
        entityPicks,
        pointPicks,
        entityAnswers,
        pointAnswers,
        forwarded,
        forwardedShift,
        annotations: { inertConstraintSymbols: false, refresh: rs.fn() },
        arrayDraft: undefined,
        scripts,
        editArray: (arrayId: number) => {
            editTarget = arrayId;
        },
        takeArrayEditTarget: () => {
            const taken = editTarget;
            editTarget = undefined;
            return taken;
        },
        solve: rs.fn((_fine: boolean) => {}),
        commit: rs.fn(() => {}),
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
                session: SketchArraySession,
                tip: I18nKeys,
                controller: AsyncController,
                _control: unknown,
                _cursor: string,
            ) => {
                sessions.push(session);
                sessionTips.push(tip);
                const script = scripts.shift();
                if (script === undefined) {
                    controller.cancel();
                    return;
                }
                script(session, fake);
                // a script that confirmed or cancelled has settled it already
                if (controller.result === undefined) controller.cancel();
            },
        ),
    };

    const editor = {
        ...fake,
        pickEntity: rs.fn(
            async (tip: I18nKeys, type: string | undefined, options: { datum?: boolean } | undefined) => {
                entityPicks.push({ tip, type, datum: options?.datum === true });
                return entityAnswers.shift();
            },
        ),
        pickPoint: rs.fn(async (tip: I18nKeys) => {
            pointPicks.push({ tip });
            return pointAnswers.shift();
        }),
    };

    return Object.assign(fake, editor);
}

async function runCommand(command: ICommand, editor: FakeEditor): Promise<void> {
    const getActive = rs
        .spyOn(SketchEditor, "getActive")
        .mockImplementation(() => (editor.isSessionAlive() ? (editor as any) : undefined));
    try {
        await command.execute({ activeView: { document: editor.document } } as any);
    } finally {
        getActive.mockRestore();
    }
}

/**
 * A view just rich enough for the paths that measure the arrow: the base tracks the camera
 * and sizes the arrow in pixels off the viewport.
 */
function fakeView() {
    return {
        document: {
            visual: {
                context: { displayMesh: () => 1, removeMesh: () => {}, setVisible: () => {} },
                update: () => {},
            },
        },
        cameraController: { onPropertyChanged: () => {}, removePropertyChanged: () => {} },
        update: () => {},
        direction: () => XYZ.unitZ,
        up: () => XYZ.unitY,
        worldToScreen: (point: XYZ) => ({
            x: point.x,
            y: point.y,
            distanceTo: (other: { x: number; y: number }) => Math.hypot(other.x - point.x, other.y - point.y),
        }),
        width: 800,
        height: 600,
    } as never;
}

/** A pointer release far from the arrow, which is what a session re-reads the selection on. */
function releaseEvent(): PointerEvent {
    return { button: 0, pointerType: "mouse", offsetX: -1000, offsetY: -1000 } as PointerEvent;
}

/** A pointer resting at a screen position — what a hover and a press on a handle are read from. */
function pointerAt(x: number, y: number): PointerEvent {
    return { button: 0, pointerType: "mouse", isPrimary: true, offsetX: x, offsetY: y } as PointerEvent;
}

/** The Escape that leaves a click-move gesture, which is also what puts its value back. */
function escapeEvent(): KeyboardEvent {
    return { key: "Escape", preventDefault: () => {}, stopImmediatePropagation: () => {} } as KeyboardEvent;
}

/**
 * The user picks what to array and confirms. Picking is the sketch's own selection, so the
 * script writes it there; reading it back is what a session does on a pointer release.
 */
function pickAndConfirm(
    ids: readonly number[],
    adjust: (session: SketchArraySession) => void = () => {},
): (session: SketchArraySession, editor: FakeEditor) => void {
    return (session, editor) => {
        editor.selected.push(...ids);
        session.pointerUp(fakeView(), releaseEvent());
        adjust(session);
        editor.previews.push(
            (session as any)
                .buildPreview()
                .meshes.map((mesh: { position: Float32Array }) => Array.from(mesh.position.slice(0, 6))),
        );
        // confirming through the session, not the controller: its own guard (is there a set,
        // and do the fields place one?) is part of what is under test
        (session as any).confirm();
    };
}

/** The arrays the sketch holds, as one line each: source ids, count, and the instance params. */
function arraySummary(solver: SketchSolver): unknown[] {
    return solver.arrays().map((array) => ({
        type: array.pattern.type,
        count: arrayInstanceTotal(array.pattern),
        sources: array.sourceIds,
        instances: liveInstanceIds(array).map((id) => solver.entity(id)?.params),
    }));
}

describe("SketchArrayCommand", () => {
    beforeEach(() => {
        // A command's options are cached statically, keyed by property name
        // (`CancelableCommand._propertiesCache`), and restored in `beforeExecute`. Left
        // alone, the count or the pattern type one case set would reach the next command
        // instance and lay that case's pattern out — so the cache starts empty every time.
        (CancelableCommand as unknown as { _propertiesCache: Map<string, unknown> })._propertiesCache.clear();
    });

    test("registers the key the sketch ribbon points at", () => {
        const data = CommandStore.getComandData("sketch.array");
        expect(data?.key).toBe("sketch.array");
        expect(data?.icon).toBe("icon-array");
    });

    test("arrays the picked geometry along the sketch's own axes, and commits once", async () => {
        const editor = fakeEditor();
        try {
            const source = editor.solver.addLine(0, 0, 10, 0);
            let draftWhileUp: unknown;
            let refreshes = 0;
            editor.scripts.push((session, editor) => {
                // the numbers the tool is holding are on the canvas with it: the draft is handed
                // over once the session is built, so the annotations are asked for them again
                draftWhileUp = editor.arrayDraft;
                refreshes = (editor.annotations.refresh as ReturnType<typeof rs.fn>).mock.calls.length;
                pickAndConfirm([source])(session, editor);
            });
            const command = new SketchArrayCommand();
            command.countX = 3;
            command.spacingX = 5;

            await runCommand(command, editor);

            // nothing is picked to set the pattern up: it opens on the numbers the fields hold
            expect(editor.entityPicks).toEqual([]);
            expect(editor.sessionTips).toEqual(["prompt.pickArraySources"]);

            expect(arraySummary(editor.solver)).toEqual([
                {
                    type: "linear",
                    count: 3,
                    sources: [source],
                    instances: [
                        [5, 0, 15, 0],
                        [10, 0, 20, 0],
                    ],
                },
            ]);
            expect(editor.commit).toHaveBeenCalledTimes(1);
            expect(editor.solve).toHaveBeenCalledWith(true);
            expect(editor.clearEntitySelection).toHaveBeenCalledTimes(1);
            expect(draftWhileUp).toBeDefined();
            expect(refreshes).toBeGreaterThan(0);
        } finally {
            editor.solver.dispose();
        }
    });

    test("previews exactly the copies the confirm would make", async () => {
        const editor = fakeEditor();
        try {
            const source = editor.solver.addLine(0, 0, 10, 0);
            editor.entityAnswers.push(SKETCH_X_AXIS_ID);
            editor.scripts.push(pickAndConfirm([source]));
            const command = new SketchArrayCommand();
            command.countX = 2;
            command.spacingX = 20;

            await runCommand(command, editor);

            // one copy, from (20, 0) to (30, 0) — the same geometry the record now holds. It
            // comes first: the handles that write the numbers are drawn after it.
            expect(editor.previews[0][0]).toEqual([20, 0, 0, 30, 0, 0]);
            expect(liveInstanceIds(editor.solver.arrays()[0])).toHaveLength(1);
        } finally {
            editor.solver.dispose();
        }
    });

    test("has a handle per direction, and none until there is geometry to array", async () => {
        const editor = fakeEditor();
        try {
            const source = editor.solver.addLine(0, 0, 10, 0);
            let beforePick: unknown[] = [];
            let afterPick: { role: string; start: XYZ; end: XYZ }[] = [];
            editor.scripts.push((session, editor) => {
                beforePick = (session as any).handles();
                editor.selected.push(source);
                session.pointerUp(fakeView(), releaseEvent());
                afterPick = (session as any).handles();
                (session as any).controller.cancel();
            });
            const command = new SketchArrayCommand();
            command.countX = 3;
            command.spacingX = 10;

            await runCommand(command, editor);

            // nothing selected is nothing to place: no handles at all
            expect(beforePick).toEqual([]);
            // then one per direction, both of them: the arrows *are* the two directions, and
            // the one that lays down a single instance is given one by its arrow (see below)
            expect(afterPick.map((handle) => handle.role)).toEqual(["xSpacing", "ySpacing"]);
            // each sits on the seed's own centre and points along its own axis
            expect(afterPick[0].start).toEqual(XYZ.unitX.multiply(5));
            expect(afterPick[0].end.x).toBeGreaterThan(afterPick[0].start.x);
            expect(afterPick[1].end.y).toBeGreaterThan(afterPick[1].start.y);
        } finally {
            editor.solver.dispose();
        }
    });

    test("turns a circular pattern about a picked centre", async () => {
        const editor = fakeEditor();
        try {
            const source = editor.solver.addCircle(10, 0, 2);
            editor.scripts.push(pickAndConfirm([source]));
            const command = new SketchArrayCommand();
            command.patternType = "option.command.patternType.circular";
            command.count = 4;
            command.twist = 180;

            await runCommand(command, editor);

            // a turn needs nothing picked either: it opens about the sketch's own origin, and
            // the centre is dragged from there (or typed into, later)
            expect(editor.pointPicks).toEqual([]);
            const [array] = editor.solver.arrays();
            expect(array.pattern).toMatchObject({
                type: "circular",
                center: { type: "ref", ref: originRef() },
            });
            expect(arrayInstanceTotal(array.pattern)).toBe(4);
            expect(array.sourceIds).toEqual([source]);
            // even spacing by default: a half turn over four instances is a quarter step, so
            // the copies walk the circle at 45° intervals and the radius comes along untouched
            expect(liveInstanceIds(array)).toHaveLength(3);
            const radius = 10;
            liveInstanceIds(array).forEach((id, index) => {
                const angle = ((index + 1) * 45 * Math.PI) / 180;
                const params = editor.solver.entity(id)?.params ?? [];
                expect(params[0]).toBeCloseTo(radius * Math.cos(angle), 9);
                expect(params[1]).toBeCloseTo(radius * Math.sin(angle), 9);
                expect(params[2]).toBeCloseTo(2, 9);
            });
        } finally {
            editor.solver.dispose();
        }
    });

    test("follows a picked curve", async () => {
        const editor = fakeEditor();
        try {
            const curve = editor.solver.addLine(0, 0, 100, 0);
            const source = editor.solver.addCircle(10, 0, 2);
            editor.entityAnswers.push(curve);
            editor.scripts.push(pickAndConfirm([source]));
            const command = new SketchArrayCommand();
            command.patternType = "option.command.patternType.curve";
            command.count = 2;
            command.spacing = 20;

            await runCommand(command, editor);

            // a curve the pattern follows is not a datum target the way a direction line is
            expect(editor.entityPicks).toEqual([
                { tip: "prompt.pickArrayCurve", type: undefined, datum: false },
            ]);
            expect(arraySummary(editor.solver)).toEqual([
                {
                    type: "curve",
                    count: 2,
                    sources: [source],
                    instances: [[30, 0, 2]],
                },
            ]);
        } finally {
            editor.solver.dispose();
        }
    });

    test("leaves the sketch alone when no curve is picked", async () => {
        const editor = fakeEditor();
        try {
            editor.solver.addLine(0, 0, 10, 0);
            // the curve is the one reference a pattern still has to pick
            editor.entityAnswers.push(undefined);
            const command = new SketchArrayCommand();
            command.patternType = "option.command.patternType.curve";

            await runCommand(command, editor);

            expect(editor.sessions).toEqual([]);
            expect(editor.commit).not.toHaveBeenCalled();
        } finally {
            editor.solver.dispose();
        }
    });

    test("leaves the sketch alone when the tool is escaped", async () => {
        const editor = fakeEditor();
        try {
            const source = editor.solver.addLine(0, 0, 10, 0);
            editor.entityAnswers.push(SKETCH_X_AXIS_ID);
            editor.scripts.push((session, editor) => {
                editor.selected.push(source);
                session.pointerUp(fakeView(), releaseEvent());
                expect((session as any).canConfirm()).toBe(true);
                // a script that ends without confirming is an ESC
            });
            const command = new SketchArrayCommand();

            await runCommand(command, editor);

            expect(editor.solver.arrays()).toEqual([]);
            expect(editor.commit).not.toHaveBeenCalled();
        } finally {
            editor.solver.dispose();
        }
    });

    test("re-opens the array an instance belongs to, and edits it in place", async () => {
        const editor = fakeEditor();
        try {
            const source = editor.solver.addLine(0, 0, 10, 0);
            editor.solver.addArray(
                {
                    type: "linear",
                    x: { count: 3, spacing: 10 },
                    y: { count: 1, spacing: 0 },
                },
                [source],
            );
            const before = editor.solver.arrays()[0];
            // a double-click on a copy is what names the array to edit; nothing is re-picked
            editor.editArray(before.id);
            editor.scripts.push(() => {});
            const command = new SketchArrayCommand();

            await runCommand(command, editor);

            // the fields opened on the record, and the confirm took them back without a change
            expect(editor.entityPicks).toEqual([]);
            expect(editor.sessionTips).toEqual(["prompt.pickArraySources"]);
            const after = editor.solver.arrays()[0];
            expect(after.id).toBe(before.id);
            expect(after.sourceIds).toEqual([source]);
            expect(arrayInstanceTotal(after.pattern)).toBe(3);
            expect(liveInstanceIds(after)).toEqual(liveInstanceIds(before));
        } finally {
            editor.solver.dispose();
        }
    });

    test("re-points an array at geometry picked during the edit", async () => {
        const editor = fakeEditor();
        try {
            const source = editor.solver.addLine(0, 0, 10, 0);
            const other = editor.solver.addCircle(0, 40, 2);
            editor.solver.addArray(
                {
                    type: "linear",
                    x: { count: 2, spacing: 10 },
                    y: { count: 1, spacing: 0 },
                },
                [source],
            );
            // the double-click hands the array over — and real geometry selected during the
            // session is what re-points it
            editor.editArray(editor.solver.arrays()[0].id);
            editor.scripts.push((session, editor) => {
                editor.selected.push(other);
                session.pointerUp(fakeView(), releaseEvent());
                (session as any).confirm();
            });
            const command = new SketchArrayCommand();

            await runCommand(command, editor);

            const array = editor.solver.arrays()[0];
            expect(array.sourceIds).toEqual([other]);
            expect(editor.solver.entity(liveInstanceIds(array)[0])?.params).toEqual([10, 40, 2]);
            expect(editor.solver.entity(source)?.params).toEqual([0, 0, 10, 0]);
        } finally {
            editor.solver.dispose();
        }
    });

    test("removes the array being edited, instances and all", async () => {
        const editor = fakeEditor();
        try {
            const source = editor.solver.addLine(0, 0, 10, 0);
            editor.solver.addArray(
                {
                    type: "linear",
                    x: { count: 3, spacing: 10 },
                    y: { count: 1, spacing: 0 },
                },
                [source],
            );
            const instanceIds = liveInstanceIds(editor.solver.arrays()[0]);
            // a double-click on a copy opens the tool on that array — where the button is
            editor.editArray(editor.solver.arrays()[0].id);
            let command: SketchArrayCommand | undefined;
            // the remove button is clicked from inside the session: an edit is the only place
            // the field is offered at all
            editor.scripts.push(async () => {
                await command!.remove();
            });
            command = new SketchArrayCommand();

            await runCommand(command, editor);

            expect(editor.solver.arrays()).toEqual([]);
            expect(instanceIds.map((id) => editor.solver.entity(id))).toEqual([undefined, undefined]);
            expect(editor.solver.entity(source)?.params).toEqual([0, 0, 10, 0]);
        } finally {
            editor.solver.dispose();
        }
    });

    test("shows the fields of the type the options cache restored, not the grid's", async () => {
        // A command's options are restored from a static cache in `beforeExecute`, straight
        // into the private value — the `patternType` setter never runs. Kept only by that
        // setter, a group's visibility would be left at its default: a turn's own fields
        // hidden and the grid's shown, which is what the bar did.
        (CancelableCommand as unknown as { _propertiesCache: Map<string, unknown> })._propertiesCache.set(
            "patternType",
            "option.command.patternType.circular",
        );
        const editor = fakeEditor();
        try {
            const command = new SketchArrayCommand();
            editor.scripts.push(() => {});

            await runCommand(command, editor);

            expect(command.showCircular).toBe(true);
            expect(command.showSingle).toBe(true);
        } finally {
            editor.solver.dispose();
        }
    });

    test("pulling out the second direction's arrow is what turns it on", async () => {
        const editor = fakeEditor();
        try {
            const source = editor.solver.addLine(0, 0, 10, 0);
            editor.scripts.push((session) => {
                editor.selected.push(source);
                session.pointerUp(fakeView(), releaseEvent());
                // a linear pattern starts as one direction: its Y axis lays down a single
                // instance, and its arrow is the way to give it another one
                expect((session as any).candidate.y).toEqual({ count: 1, spacing: 60 });
                (session as any)._activeHandle = "ySpacing";
                (session as any).setCurrentValue(30);
                (session as any).controller.cancel();
            });
            const command = new SketchArrayCommand();
            command.countX = 3;
            command.spacingX = 20;

            await runCommand(command, editor);

            const session = editor.sessions[0];
            expect((session as any).candidate).toEqual({
                type: "linear",
                x: { count: 3, spacing: 20 },
                y: { count: 2, spacing: 30 },
            });
        } finally {
            editor.solver.dispose();
        }
    });

    test("a turned centre follows the point it landed on, and empty space is a place of its own", async () => {
        const editor = fakeEditor();
        try {
            // a circle whose centre point the drag can land on, and the seed it patterns
            const anchor = editor.solver.addCircle(40, 0, 10);
            const source = editor.solver.addCircle(0, 30, 2);
            let landed: unknown;
            let away: unknown;
            editor.scripts.push((session) => {
                editor.selected.push(source);
                session.pointerUp(fakeView(), releaseEvent());
                const grab = { uv: [0, 0] as [number, number], center: { type: "at" as const, u: 0, v: 0 } };
                // the pointer's own travel is carried onto the centre it started from, and a
                // landing on a point of the sketch becomes a reference the turn follows
                landed = (session as any).centreAt(grab, [40, 0]);
                away = (session as any).centreAt(grab, [12, 34]);
                (session as any).controller.cancel();
            });
            const command = new SketchArrayCommand();
            command.patternType = "option.command.patternType.circular";

            await runCommand(command, editor);

            expect(landed).toEqual({ type: "ref", ref: { entityId: anchor, pointIndex: 0 } });
            expect(away).toEqual({ type: "at", u: 12, v: 34 });
        } finally {
            editor.solver.dispose();
        }
    });

    test("dissolves the array being edited, leaving its copies behind", async () => {
        const editor = fakeEditor();
        try {
            const source = editor.solver.addLine(0, 0, 10, 0);
            editor.solver.addArray(
                {
                    type: "linear",
                    x: { count: 3, spacing: 10 },
                    y: { count: 1, spacing: 0 },
                },
                [source],
            );
            const instanceIds = liveInstanceIds(editor.solver.arrays()[0]);
            editor.selected.push(instanceIds[0]);
            let command: SketchArrayCommand | undefined;
            editor.editArray(editor.solver.arrays()[0].id);
            editor.scripts.push(async () => {
                await command!.dissolve();
            });
            command = new SketchArrayCommand();
            const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
            try {
                await runCommand(command, editor);

                // the other answer to "I do not want this pattern": the record goes and the
                // copies stay, so what was two entities is two entities the sketch owns
                expect(editor.solver.arrays()).toEqual([]);
                expect(instanceIds.map((id) => editor.solver.entity(id)).length).toBe(2);
                expect(instanceIds.map((id) => editor.solver.isDerived(id))).toEqual([false, false]);
                expect(editor.commit).toHaveBeenCalledTimes(1);
                expect(pub).toHaveBeenCalledWith("statusBarTip", "sketch.arrayDissolved");
            } finally {
                pub.mockRestore();
            }
        } finally {
            editor.solver.dispose();
        }
    });

    test("prompts again with the new reference when the pattern type changes", async () => {
        const editor = fakeEditor();
        try {
            const source = editor.solver.addLine(0, 0, 10, 0);
            const curveId = editor.solver.addLine(0, 40, 100, 40);
            editor.entityAnswers.push(curveId);
            const command = new SketchArrayCommand();
            command.count = 2;
            command.spacing = 10;
            editor.scripts.push((_session, editor) => {
                // switching the type mid-step starts the step over: a curve pattern is built
                // on a curve it has to pick, which the grid it already has is not
                editor.selected.push(source);
                command.patternType = "option.command.patternType.curve";
            });
            editor.scripts.push(pickAndConfirm([source]));

            await runCommand(command, editor);

            expect(editor.entityPicks.map((pick) => pick.tip)).toEqual(["prompt.pickArrayCurve"]);
            expect(editor.solver.arrays().map((array) => array.pattern.type)).toEqual(["curve"]);
        } finally {
            editor.solver.dispose();
        }
    });

    test("takes a pattern type change as a change to the array it opened on", async () => {
        const editor = fakeEditor();
        try {
            const source = editor.solver.addLine(0, 0, 10, 0);
            editor.solver.addArray(
                {
                    type: "linear",
                    x: { count: 3, spacing: 10 },
                    y: { count: 1, spacing: 0 },
                },
                [source],
            );
            const before = editor.solver.arrays()[0];
            editor.editArray(before.id);
            const command = new SketchArrayCommand();
            // the step starts over on the new type — a turn is placed about a centre rather
            // than along an axis — and what the restart opens is the next script
            editor.scripts.push(() => {
                command.patternType = "option.command.patternType.circular";
            });
            editor.scripts.push(pickAndConfirm([source]));

            await runCommand(command, editor);

            // one record, the one the tool opened on, holding the pattern it was given: the
            // restart left it behind, so the confirm wrote a *second* array beside it and the
            // seed was patterned twice
            const arrays = editor.solver.arrays();
            expect(arrays).toHaveLength(1);
            expect(arrays[0].id).toBe(before.id);
            expect(arrays[0].pattern).toMatchObject({ type: "circular" });
            expect(editor.commit).toHaveBeenCalledTimes(1);
        } finally {
            editor.solver.dispose();
        }
    });

    test("lets go of a handle where it stands, and a click on one is still a click", async () => {
        // The base's click path asks `isOverArrow`, which measures the one arrow it draws —
        // and this session draws none, so it degenerates that segment to the sketch's own
        // origin. A seed away from the origin is what tells the two hit tests apart.
        const editor = fakeEditor();
        try {
            const source = editor.solver.addLine(100, 0, 110, 0);
            let over: boolean | undefined;
            let handle: string | undefined;
            editor.scripts.push((session) => {
                editor.selected.push(source);
                session.pointerUp(fakeView(), releaseEvent());
                const view = fakeView();
                const at = pointerAt(135, 0);
                handle = (session as any).handleAt(view, at);
                over = (session as any).isOverArrow(view, at);
                (session as any).controller.cancel();
            });
            const command = new SketchArrayCommand();
            command.countX = 3;
            command.spacingX = 20;

            await runCommand(command, editor);

            expect(handle).toBe("xSpacing");
            expect(over).toBe(true);
        } finally {
            editor.solver.dispose();
        }
    });

    test("lets the pointer through the numbers to a handle, and gives them back after", async () => {
        // A number is a DOM overlay and a handle is a mesh: with a handle under the pointer the
        // numbers have to stop taking events, or one lying over the arrow would take the press
        // that grabs it and the click that settles a drag. Away from one they are the user's
        // again — a number is still doubled to change it.
        const editor = fakeEditor();
        try {
            const source = editor.solver.addLine(100, 0, 110, 0);
            const flags: boolean[] = [];
            editor.scripts.push((session) => {
                editor.selected.push(source);
                session.pointerUp(fakeView(), releaseEvent());
                const view = fakeView();
                for (const at of [pointerAt(-400, -400), pointerAt(135, 0), pointerAt(-400, -400)]) {
                    session.pointerMove(view, at);
                    flags.push(editor.annotations.inertConstraintSymbols);
                }
                (session as any).controller.cancel();
            });
            const command = new SketchArrayCommand();
            command.countX = 3;
            command.spacingX = 20;

            await runCommand(command, editor);

            expect(flags).toEqual([false, true, false]);
        } finally {
            editor.solver.dispose();
        }
    });

    test("puts the pattern back whole when a gesture is abandoned", async () => {
        const editor = fakeEditor();
        try {
            const source = editor.solver.addLine(0, 0, 10, 0);
            let dragged: unknown;
            let abandoned: unknown;
            let stillMoving: boolean | undefined;
            editor.scripts.push((session) => {
                editor.selected.push(source);
                session.pointerUp(fakeView(), releaseEvent());
                // the gesture as it opens: the pattern is taken before anything can move it,
                // and both flags `enterMoveMode` sets are up
                (session as any)._activeHandle = "ySpacing";
                (session as any)._gestureStart = (session as any).candidate;
                (session as any).moveMode = true;
                (session as any)._awaitingClick = true;
                (session as any).setCurrentValue(30);
                dragged = (session as any).candidate;
                // Escape out of the click-move gesture: not the base's own reset, which writes
                // nought — an array's spacing *is* the number, and a nought one cannot be placed
                session.keyDown(fakeView(), escapeEvent());
                abandoned = (session as any).candidate;
                stillMoving = (session as any).moveMode;
            });
            const command = new SketchArrayCommand();
            command.countX = 3;
            command.spacingX = 20;

            await runCommand(command, editor);

            expect(dragged).toEqual({
                type: "linear",
                x: { count: 3, spacing: 20 },
                y: { count: 2, spacing: 30 },
            });
            // both of what the drag moved comes back: the spacing it wrote and the count that
            // pulling the arrow out turned on
            expect(abandoned).toEqual({
                type: "linear",
                x: { count: 3, spacing: 20 },
                y: { count: 1, spacing: 60 },
            });
            // and the options bar follows the canvas back rather than keeping what it dragged
            expect(command.countY).toBe(1);
            expect(command.spacingY).toBe(60);
            // leaving the gesture is leaving it: the session is not still moving a handle
            expect(stillMoving).toBe(false);
        } finally {
            editor.solver.dispose();
        }
    });

    test("hands the sketch's own events on, additively", async () => {
        const editor = fakeEditor();
        try {
            editor.entityAnswers.push(SKETCH_X_AXIS_ID);
            editor.scripts.push((session) => {
                session.pointerDown(fakeView(), releaseEvent());
                session.pointerMove(fakeView(), releaseEvent());
                (session as any).controller.cancel();
            });

            await runCommand(new SketchArrayCommand(), editor);

            expect(editor.forwarded).toEqual(["down", "move"]);
            // every click the tool forwards is additive, so picking builds a set rather than
            // replacing it — the same bargain the offset and transform sessions make
            expect(editor.forwardedShift).toEqual([true, true]);
            expect(editor.selected).toEqual([]);
        } finally {
            editor.solver.dispose();
        }
    });
});
