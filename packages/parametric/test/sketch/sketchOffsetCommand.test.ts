// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type AsyncController,
    CommandStore,
    type I18nKeys,
    type ICommand,
    type IEventHandler,
    Plane,
    Precision,
    XYZ,
} from "@chili3d/core";
import { createMockDocument, setupShapeFactoryMock } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { ARROW_COLOR, ARROW_HOVER_COLOR } from "../../src/commands/arrowHandle";
import { SketchOffsetCommand, type SketchOffsetSession } from "../../src/sketch/commands/sketchOffset";
import { SketchEditor } from "../../src/sketch/editor/sketchEditor";
import { ConstraintKind, type SketchEntityData } from "../../src/sketch/sketchModel";
import { SketchSolver } from "../../src/sketch/solver";
import "./setup";

/**
 * The arrow meshes through `arrowMeshes`, which runs on the shape factory — absent
 * outside the wasm package. A shape that reports a mesh and disposes is all it needs
 * (the same stub `sketchPlaneOffsetStep.test.ts` uses).
 */
function stubArrowGeometry(): number[] {
    /** Every colour the arrow meshes were painted with, in order. */
    const colors: number[] = [];
    const shape = () => {
        const faces: { position: Float32Array; range: number[]; color?: number } = {
            position: new Float32Array(),
            range: [],
        };
        Object.defineProperty(faces, "color", {
            get: () => undefined,
            set: (value: number) => colors.push(value),
        });
        return { isOk: true, value: { mesh: { faces }, dispose: () => {} } };
    };
    setupShapeFactoryMock({ cylinder: shape, cone: shape });
    return colors;
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
    sessions: SketchOffsetSession[];
    /** The cursor each session asked the viewport for. */
    cursors: (string | undefined)[];
    /** What each session previewed, taken at the value it was dragged to. */
    previews: number[][];
    /** The colours the arrow has been painted with, oldest first. */
    arrowColors: number[];
    /** The user's actions, one script per session; running out cancels the session. */
    scripts: ((session: SketchOffsetSession, editor: FakeEditor) => void)[];
    /** Every event the session handed on to the sketch's handler. */
    forwarded: string[];
    /** The `shiftKey` each of those pointer events carried. */
    forwardedShift: boolean[];
    dimensionAnchors: Map<number, unknown>;
    /** The annotations' switch for letting pointer events through the badges. */
    annotations: { inertConstraintSymbols: boolean };
    /** Every value that switch was set to, in order. */
    badgeTimeline: boolean[];
    solve: ReturnType<typeof rs.fn>;
    commit: ReturnType<typeof rs.fn>;
    screenTolerance: () => number;
    selectedEntityIds: () => number[];
    clearEntitySelection: ReturnType<typeof rs.fn>;
    endSession: () => void;
    isSessionAlive: () => boolean;
    zoomOut: () => void;
}

function fakeEditor(): FakeEditor {
    const arrowColors = stubArrowGeometry();
    const solver = new SketchSolver(Plane.XY);
    // no active view: the arrow sizes itself in pixels from one when there is one, and
    // falls back to its world length without — a headless test has no camera
    const document = createMockDocument({
        id: "offset-test",
        name: "offset-test",
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
    const sessions: SketchOffsetSession[] = [];
    const cursors: (string | undefined)[] = [];
    const previews: number[][] = [];
    const badgeTimeline: boolean[] = [];
    let badgesSuppressed = false;
    const annotations = {
        get inertConstraintSymbols() {
            return badgesSuppressed;
        },
        set inertConstraintSymbols(value: boolean) {
            if (value === badgesSuppressed) return;
            badgesSuppressed = value;
            badgeTimeline.push(value);
        },
    };
    const scripts: ((session: SketchOffsetSession, editor: FakeEditor) => void)[] = [];
    let sessionAlive = true;
    let screenTolerance = 1e-6;

    const fake: FakeEditor = {
        node: { plane: Plane.XY },
        document,
        solver,
        selected,
        picking,
        sessions,
        cursors,
        previews,
        scripts,
        forwarded,
        forwardedShift,
        dimensionAnchors: new Map(),
        arrowColors,
        annotations,
        badgeTimeline,
        solve: rs.fn((_fine: boolean) => {}),
        commit: rs.fn(() => {}),
        screenTolerance: () => screenTolerance,
        selectedEntityIds: () => [...selected],
        clearEntitySelection: rs.fn(() => {
            selected.length = 0;
        }),
        endSession: () => {
            sessionAlive = false;
        },
        isSessionAlive: () => sessionAlive,
        zoomOut: () => {
            // 5 units per 8 screen pixels: the 10mm square is under a fingertip on screen,
            // so a 0.5mm distance is far below what a drag could even aim at
            screenTolerance = 5;
        },
    };

    (document as any).visual.eventHandler = picking;
    (document as any).picker = {
        pickAsync: rs.fn(
            async (
                session: SketchOffsetSession,
                _tip: I18nKeys,
                controller: AsyncController,
                _control: unknown,
                cursor: string,
            ) => {
                sessions.push(session);
                cursors.push(cursor);
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
 * A view just rich enough for the paths that measure the arrow: the base tracks the
 * camera and sizes the arrow in pixels off the viewport.
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
        // one screen pixel per world unit, which is all the arrow's sizing needs
        worldToScreen: (point: XYZ) => ({
            x: point.x,
            y: point.y,
            distanceTo: (other: { x: number; y: number }) => Math.hypot(other.x - point.x, other.y - point.y),
        }),
        width: 800,
        height: 600,
    } as never;
}

/** A pointer event at a screen position, with the fields the handlers read. */
function pointerAt(x: number, y: number): PointerEvent {
    return { button: 0, pointerType: "mouse", offsetX: x, offsetY: y, shiftKey: false } as PointerEvent;
}

/** A pointer release far from the arrow, which is what a session re-reads the selection on. */
function releaseEvent(): PointerEvent {
    return { button: 0, pointerType: "mouse", offsetX: -1000, offsetY: -1000 } as PointerEvent;
}

/**
 * The user picks curves and drags the arrow to a distance. Picking is the sketch's own
 * selection, so the script writes it there; reading it back is what a session does on a
 * pointer release (in the app that event comes from the viewport).
 */
function pickAndDrag(
    ids: readonly number[],
    distance: number,
): (session: SketchOffsetSession, editor: FakeEditor) => void {
    return (session, editor) => {
        editor.selected.push(...ids);
        session.pointerUp(fakeView(), releaseEvent());
        session.setValue(distance);
        editor.previews.push(
            (session as any)
                .buildPreview()
                .meshes.map((mesh: { position: Float32Array }) => Array.from(mesh.position.slice(0, 6))),
        );
        // confirming through the session, not the controller: its own guard (is there a
        // set, and is this a real distance?) is part of what is under test
        (session as any).confirm();
    };
}

/** A rectangle to offset, from its four edges as solver entities. */
function rectangle(solver: SketchSolver): number[] {
    const corners: [number, number][] = [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
    ];
    return corners.map((corner, index) => {
        const next = corners[(index + 1) % corners.length];
        return solver.addLine(corner[0], corner[1], next[0], next[1]);
    });
}

/** The copies an offset left behind, identified by their constraints on a source. */
function copiesOf(solver: SketchSolver, sources: readonly number[]): SketchEntityData[] {
    const tied = new Set(
        solver
            .toData()
            .constraints.filter((c) => c.kind === ConstraintKind.P2LDistance)
            .map((c) => c.refs[0].entityId),
    );
    return solver.entities().filter((entity) => tied.has(entity.id) && !sources.includes(entity.id));
}

describe("SketchOffsetCommand", () => {
    test("registers the key the sketch ribbon points at", () => {
        const data = CommandStore.getComandData("sketch.offset");
        expect(data?.key).toBe("sketch.offset");
        expect(data?.icon).toBe("icon-offset");
    });

    test("offsets the picked curves when the arrow is dragged", async () => {
        const editor = fakeEditor();
        try {
            const lines = rectangle(editor.solver);
            editor.scripts.push(pickAndDrag(lines, 2));
            const command = new SketchOffsetCommand();

            await runCommand(command, editor);

            expect(editor.commit).toHaveBeenCalledTimes(1);
            // the loop walks counter-clockwise, so 2 to the left is 2 inward
            const copies = copiesOf(editor.solver, lines);
            expect(copies.map((copy) => copy.params)).toEqual([
                [2, 2, 8, 2],
                [8, 2, 8, 8],
                [8, 8, 2, 8],
                [2, 8, 2, 2],
            ]);
        } finally {
            editor.solver.dispose();
        }
    });

    test("has no arrow until something is picked, then sits it on the picked curve", async () => {
        const editor = fakeEditor();
        try {
            const source = editor.solver.addLine(0, 0, 10, 0);
            let beforePick: { origin: unknown; normal: unknown } | undefined;
            let afterPick: { origin: unknown; normal: unknown } | undefined;
            editor.scripts.push((session, editor) => {
                beforePick = (session as any).axis();
                editor.selected.push(source);
                session.pointerUp(fakeView(), releaseEvent());
                afterPick = (session as any).axis();
            });
            const command = new SketchOffsetCommand();

            await runCommand(command, editor);

            // nothing picked: no anchor for an arrow to sit on
            expect(beforePick?.origin).toEqual({ x: 0, y: 0, z: 0 });
            // picked: the line's midpoint, with its left normal — up the sketch's +v
            expect(afterPick?.origin).toEqual({ x: 5, y: 0, z: 0 });
            expect(afterPick?.normal).toEqual({ x: 0, y: 1, z: 0 });
        } finally {
            editor.solver.dispose();
        }
    });

    test("applies one distance to curves picked across several clicks", async () => {
        const editor = fakeEditor();
        try {
            const lines = rectangle(editor.solver);
            // picked one at a time, the arrow dragged once at the end
            editor.scripts.push((session, editor) => {
                for (const line of lines) {
                    editor.selected.push(line);
                    session.pointerUp(fakeView(), releaseEvent());
                }
                session.setValue(1);
                (session as any).confirm();
            });
            const command = new SketchOffsetCommand();

            await runCommand(command, editor);

            expect(editor.commit).toHaveBeenCalledTimes(1);
            expect(copiesOf(editor.solver, lines)).toHaveLength(4);
        } finally {
            editor.solver.dispose();
        }
    });

    test("hands every event that misses the arrow to the sketch", async () => {
        const editor = fakeEditor();
        try {
            const [line] = rectangle(editor.solver);
            editor.scripts.push((session, editor) => {
                session.pointerDown(fakeView(), releaseEvent());
                session.pointerMove(fakeView(), releaseEvent());
                session.keyDown(fakeView(), { key: "Delete" } as KeyboardEvent);
                editor.selected.push(line);
                session.pointerUp(fakeView(), releaseEvent());
                session.setValue(1);
                (session as any).confirm();
            });
            const command = new SketchOffsetCommand();

            await runCommand(command, editor);

            // the sketch's handler saw all four — the session only owns the arrow
            expect(editor.forwarded).toEqual(["down", "move", "key", "up"]);
            expect(copiesOf(editor.solver, [line])).toHaveLength(1);
        } finally {
            editor.solver.dispose();
        }
    });

    test("forwards picking as additive, so a click adds to the set", async () => {
        const editor = fakeEditor();
        try {
            const lines = rectangle(editor.solver);
            editor.scripts.push((session, editor) => {
                // three plain clicks, as a user picking the edges one by one
                for (const line of lines.slice(0, 3)) {
                    session.pointerDown(fakeView(), releaseEvent());
                    editor.selected.push(line);
                    session.pointerUp(fakeView(), releaseEvent());
                }
                session.setValue(1);
                (session as any).confirm();
            });
            const command = new SketchOffsetCommand();

            await runCommand(command, editor);

            // every click reached the sketch as an additive one: without that, each would
            // have replaced the set and only the last edge would have been offset
            expect(editor.forwardedShift).toEqual([true, true, true, true, true, true]);
            expect(copiesOf(editor.solver, lines)).toHaveLength(3);
        } finally {
            editor.solver.dispose();
        }
    });

    test("ends after a refused offset too, leaving the sketch alone", async () => {
        const editor = fakeEditor();
        try {
            const line = editor.solver.addLine(0, 0, 10, 0);
            // 2 away from it: an offset of 2 lands on that line and is refused
            editor.solver.addLine(0, 2, 10, 2);
            editor.scripts.push(pickAndDrag([line], 2));
            const command = new SketchOffsetCommand();

            await runCommand(command, editor);

            expect(editor.commit).not.toHaveBeenCalled();
            expect(editor.sessions).toHaveLength(1);
            expect(editor.solver.entities()).toHaveLength(2);
        } finally {
            editor.solver.dispose();
        }
    });

    test("lets events through the badges while the arrow is in hand", async () => {
        const editor = fakeEditor();
        try {
            const [line] = rectangle(editor.solver);
            const during: boolean[] = [];
            editor.scripts.push((session, editor) => {
                editor.selected.push(line);
                session.pointerUp(fakeView(), releaseEvent());
                const resting = editor.annotations.inertConstraintSymbols;
                // press the arrow itself: a badge lying over it is a DOM overlay and would
                // otherwise take the press, leaving the arrow ungrabbable
                const { start, end } = (session as any).arrowSegment();
                session.pointerDown(fakeView(), pointerAt((start.x + end.x) / 2, (start.y + end.y) / 2));
                during.push(resting, editor.annotations.inertConstraintSymbols);
                session.setValue(1);
                (session as any).confirm();
            });
            const command = new SketchOffsetCommand();

            await runCommand(command, editor);

            // nothing aimed at first, then letting events through, then back
            expect(during).toEqual([false, true]);
            expect(editor.badgeTimeline).toEqual([true, false]);
            expect(editor.annotations.inertConstraintSymbols).toBe(false);
        } finally {
            editor.solver.dispose();
        }
    });

    test("lights the arrow up while the pointer is on it", async () => {
        const editor = fakeEditor();
        try {
            const [line] = rectangle(editor.solver);
            const highlighted: boolean[] = [];
            editor.scripts.push((session, editor) => {
                editor.selected.push(line);
                session.pointerUp(fakeView(), releaseEvent());
                const { start, end } = (session as any).arrowSegment();
                const midX = (start.x + end.x) / 2;
                const midY = (start.y + end.y) / 2;

                // the handle's own hover feedback: the base leaves `onHover` empty, so
                // without an override the arrow never highlights at all
                session.pointerMove(fakeView(), pointerAt(midX + 40, midY + 40));
                highlighted.push((session as any).arrowHovered);
                session.pointerMove(fakeView(), pointerAt(midX, midY));
                highlighted.push((session as any).arrowHovered);
                session.pointerMove(fakeView(), pointerAt(midX + 40, midY + 40));
                highlighted.push((session as any).arrowHovered);

                session.setValue(1);
                (session as any).confirm();
            });
            const command = new SketchOffsetCommand();

            await runCommand(command, editor);

            expect(highlighted).toEqual([false, true, false]);
            // and it wears the pair of colours every other handle in the app wears: the
            // plain one it was built with, the highlighted one under the pointer
            expect(editor.arrowColors[0]).toBe(ARROW_COLOR);
            expect(editor.arrowColors).toContain(ARROW_HOVER_COLOR);
        } finally {
            editor.solver.dispose();
        }
    });

    test("asks for the picking cursor, not the drawing one", async () => {
        const editor = fakeEditor();
        try {
            const [line] = rectangle(editor.solver);
            editor.scripts.push(pickAndDrag([line], 1));
            const command = new SketchOffsetCommand();

            await runCommand(command, editor);

            // the session lays nothing down: it selects curves and drags a handle
            expect(editor.cursors).toEqual(["select.default"]);
        } finally {
            editor.solver.dispose();
        }
    });

    test("keeps the dragged distance in its own input", async () => {
        const editor = fakeEditor();
        try {
            const [line] = rectangle(editor.solver);
            editor.scripts.push(pickAndDrag([line], 3.5));
            const command = new SketchOffsetCommand();

            await runCommand(command, editor);

            expect(command.distance).toBe(3.5);
        } finally {
            editor.solver.dispose();
        }
    });

    test("pushes a distance typed into the panel into the open session", async () => {
        const editor = fakeEditor();
        try {
            const [line] = rectangle(editor.solver);
            const command = new SketchOffsetCommand();
            editor.scripts.push((session, editor) => {
                editor.selected.push(line);
                session.pointerUp(fakeView(), releaseEvent());
                command.distance = 4;
                // and nothing else: the script ends unsettled, like walking away
            });

            await runCommand(command, editor);

            expect(editor.sessions[0]?.distance).toBe(4);
            expect(editor.commit).not.toHaveBeenCalled();
        } finally {
            editor.solver.dispose();
        }
    });

    test("keeps an expression typed into the panel, not the number it resolves to", async () => {
        const editor = fakeEditor();
        try {
            const [line] = rectangle(editor.solver);
            const command = new SketchOffsetCommand();
            editor.scripts.push((session, editor) => {
                editor.selected.push(line);
                session.pointerUp(fakeView(), releaseEvent());
                command.distance = "2*3";
                // and nothing else: the script ends unsettled, like walking away
            });

            await runCommand(command, editor);

            // the session echoes the resolved number back; it must not land on the field
            expect(editor.sessions[0]?.distance).toBe(6);
            expect(command.distance).toBe("2*3");
        } finally {
            editor.solver.dispose();
        }
    });

    test("ends after a commit: the next offset starts the tool again", async () => {
        const editor = fakeEditor();
        try {
            const lines = rectangle(editor.solver);
            // a second script is waiting, but the confirm already ended the command
            editor.scripts.push(pickAndDrag([lines[0]], 1), pickAndDrag([lines[2]], 1));
            const command = new SketchOffsetCommand();

            await runCommand(command, editor);

            expect(editor.commit).toHaveBeenCalledTimes(1);
            expect(editor.sessions).toHaveLength(1);
            expect(copiesOf(editor.solver, lines)).toHaveLength(1);
            expect(editor.clearEntitySelection).toHaveBeenCalled();
        } finally {
            editor.solver.dispose();
        }
    });

    test("leaves the sketch alone when the session is cancelled", async () => {
        const editor = fakeEditor();
        try {
            const lines = rectangle(editor.solver);
            editor.scripts.push((_session, editor) => {
                editor.selected.push(...lines);
            });
            const command = new SketchOffsetCommand();

            await runCommand(command, editor);

            expect(editor.commit).not.toHaveBeenCalled();
            expect(editor.solver.entities()).toHaveLength(4);
        } finally {
            editor.solver.dispose();
        }
    });

    test("does nothing once the session has ended under the drag", async () => {
        const editor = fakeEditor();
        try {
            const lines = rectangle(editor.solver);
            editor.scripts.push((session, editor) => {
                editor.selected.push(...lines);
                session.setValue(2);
                (session as any).confirm();
                // the session outlives the sketch: another view took over mid-drag
                editor.endSession();
            });
            const command = new SketchOffsetCommand();

            await runCommand(command, editor);

            expect(editor.commit).not.toHaveBeenCalled();
            expect(editor.solver.entities()).toHaveLength(4);
        } finally {
            editor.solver.dispose();
        }
    });

    test("confirms a real distance however far the view is zoomed out", async () => {
        const editor = fakeEditor();
        try {
            const lines = rectangle(editor.solver);
            // zoomed out, 0.5mm is under a screen pixel — still a real offset, and the
            // confirm must not be refused for it (silently, at that)
            editor.zoomOut();
            editor.scripts.push(pickAndDrag(lines, 0.5));
            const command = new SketchOffsetCommand();

            await runCommand(command, editor);

            expect(editor.commit).toHaveBeenCalledTimes(1);
            const copies = copiesOf(editor.solver, lines);
            expect(copies).toHaveLength(4);
            expect(copies[0].params.map((value) => Math.round(value * 1e6) / 1e6)).toEqual([
                0.5, 0.5, 9.5, 0.5,
            ]);
        } finally {
            editor.solver.dispose();
        }
    });

    test("refuses to confirm with nothing picked", async () => {
        const editor = fakeEditor();
        try {
            rectangle(editor.solver);
            let confirmable = true;
            editor.scripts.push((session) => {
                session.setValue(3);
                confirmable = (session as any).canConfirm();
            });
            const command = new SketchOffsetCommand();

            await runCommand(command, editor);

            expect(confirmable).toBe(false);
            expect(editor.commit).not.toHaveBeenCalled();
        } finally {
            editor.solver.dispose();
        }
    });

    test("refuses to confirm a distance under the sketch's own scale", async () => {
        const editor = fakeEditor();
        try {
            const [line] = rectangle(editor.solver);
            let confirmable = true;
            editor.scripts.push((session, editor) => {
                editor.selected.push(line);
                session.pointerUp(fakeView(), releaseEvent());
                session.setValue(Precision.Distance / 2);
                confirmable = (session as any).canConfirm();
            });
            const command = new SketchOffsetCommand();

            await runCommand(command, editor);

            expect(confirmable).toBe(false);
            expect(editor.commit).not.toHaveBeenCalled();
            expect(editor.solver.entities()).toHaveLength(4);
        } finally {
            editor.solver.dispose();
        }
    });

    test("anchors on a circle's rim, pointing outward", async () => {
        const editor = fakeEditor();
        try {
            const circle = editor.solver.addCircle(3, 4, 5);
            const axes: { origin: unknown; normal: unknown }[] = [];
            editor.scripts.push((session, editor) => {
                editor.selected.push(circle);
                session.pointerUp(fakeView(), releaseEvent());
                axes.push((session as any).axis());
                session.setValue(1);
                (session as any).confirm();
            });
            const command = new SketchOffsetCommand();

            await runCommand(command, editor);

            // the +u point of the rim, and outward: a lone circle's own positive
            expect(axes[0]?.origin).toEqual({ x: 8, y: 4, z: 0 });
            expect(axes[0]?.normal).toEqual({ x: 1, y: 0, z: 0 });
            expect(editor.solver.entities().map((entity) => entity.params)).toContainEqual([3, 4, 6]);
        } finally {
            editor.solver.dispose();
        }
    });

    test("previews the copies the drag would leave", async () => {
        const editor = fakeEditor();
        try {
            const source = editor.solver.addLine(0, 0, 10, 0);
            editor.scripts.push(pickAndDrag([source], 2));
            const command = new SketchOffsetCommand();

            await runCommand(command, editor);

            // the preview is drawn as line geometry at the value: the copy's two ends,
            // (0, 2) and (10, 2) in the sketch plane
            expect(editor.previews).toEqual([[[0, 2, 0, 10, 2, 0]]]);
        } finally {
            editor.solver.dispose();
        }
    });
});
