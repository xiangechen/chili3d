// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type AsyncController,
    type IDocument,
    type IView,
    Plane,
    PubSub,
    type SnapResult,
    XYZ,
} from "@chili3d/core";
import { rs } from "@rstest/core";
import { SketchArcCommand } from "../../src/sketch/commands/sketchArc";
import { SketchCircleCommand } from "../../src/sketch/commands/sketchCircle";
import { SketchLineCommand } from "../../src/sketch/commands/sketchLine";
import type { SketchPointSnapData } from "../../src/sketch/commands/sketchPointStep";
import { SketchRectangleCommand } from "../../src/sketch/commands/sketchRectangle";
import { SketchEditor } from "../../src/sketch/editor/sketchEditor";
import { ConstraintKind, originRef } from "../../src/sketch/sketchModel";
import { SketchSolver } from "../../src/sketch/solver";
import "./setup";

function fakeEditor() {
    const solver = new SketchSolver(Plane.XY);
    return {
        node: { plane: Plane.XY },
        solver,
        solve: rs.fn((_fine: boolean) => {}),
        commit: rs.fn(() => {}),
        screenTolerance: () => 0,
    };
}

type FakeEditor = ReturnType<typeof fakeEditor>;

/** Drives executeMainTask directly with canned step points on the XY plane. */
function runCommand(command: object, editor: FakeEditor, points: [number, number][]) {
    const getActive = rs.spyOn(SketchEditor, "getActive").mockReturnValue(editor as any);
    (command as any).stepDatas = points.map(([x, y]) => ({ point: new XYZ({ x, y, z: 0 }) }));
    try {
        (command as any).executeMainTask();
    } finally {
        getActive.mockRestore();
    }
}

/** The entity the step at `index` would build for a probe at `probe` (both in sketch uv). */
function tentativeOf(command: object, points: [number, number][], index: number, probe: [number, number]) {
    const editor = fakeEditor();
    const getActive = rs.spyOn(SketchEditor, "getActive").mockReturnValue(editor as any);
    try {
        (command as any).stepDatas = points.map(([x, y]) => ({ point: new XYZ({ x, y, z: 0 }) }));
        const step = (command as any).getSteps()[index];
        return (step.handleStepData() as SketchPointSnapData).tentative?.(probe);
    } finally {
        getActive.mockRestore();
        editor.solver.dispose();
    }
}

describe("step tentatives", () => {
    test("the line step completes the segment from the first endpoint", () => {
        expect(tentativeOf(new SketchLineCommand(), [[2, 3]], 1, [10, 3])).toEqual({
            type: "line",
            params: [2, 3, 10, 3],
        });
    });

    test("the circle step takes its radius from the probe", () => {
        expect(tentativeOf(new SketchCircleCommand(), [[3, 4]], 1, [9, 4])).toEqual({
            type: "circle",
            params: [3, 4, 6],
        });
    });

    test("the arc start step reads as the whole circle until the sweep is picked", () => {
        expect(tentativeOf(new SketchArcCommand(), [[0, 0]], 1, [10, 0])).toEqual({
            type: "arc",
            params: [0, 0, 10, 0, 10, 0],
        });
    });

    test("the arc step has no tentative while the probe sits on the center", () => {
        expect(tentativeOf(new SketchArcCommand(), [[0, 0]], 1, [0, 0])).toBeUndefined();
    });

    test("the arc end step projects the probe onto the circle", () => {
        expect(
            tentativeOf(
                new SketchArcCommand(),
                [
                    [0, 0],
                    [10, 0],
                ],
                2,
                [0, 20],
            ),
        ).toEqual({
            type: "arc",
            params: [0, 0, 10, 0, 0, 10],
        });
    });
});

describe("SketchArcCommand", () => {
    test("adds an arc entity from center, start and end points", () => {
        const editor = fakeEditor();
        runCommand(new SketchArcCommand(), editor, [
            [0, 0],
            [10, 0],
            [0, 10],
        ]);

        expect(editor.solver.entities()).toEqual([{ id: 1, type: "arc", params: [0, 0, 10, 0, 0, 10] }]);
        expect(editor.solve).toHaveBeenCalledWith(true);
        expect(editor.commit).toHaveBeenCalledTimes(1);
        editor.solver.dispose();
    });

    test("projects an off-circle end point onto the circle", () => {
        const editor = fakeEditor();
        runCommand(new SketchArcCommand(), editor, [
            [0, 0],
            [10, 0],
            [0, 20],
        ]);

        expect(editor.solver.entities()).toEqual([{ id: 1, type: "arc", params: [0, 0, 10, 0, 0, 10] }]);
        editor.solver.dispose();
    });

    test("rejects an end point on the center without adding entities", () => {
        const editor = fakeEditor();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            runCommand(new SketchArcCommand(), editor, [
                [0, 0],
                [10, 0],
                [0, 0],
            ]);

            expect(pub).toHaveBeenCalledWith("displayError", expect.any(String));
            expect(editor.solver.entities()).toEqual([]);
            expect(editor.commit).not.toHaveBeenCalled();
        } finally {
            pub.mockRestore();
            editor.solver.dispose();
        }
    });

    test.each([
        { name: "equals the start point", end: [10, 0] as [number, number] },
        { name: "lies within the angular wedge of the start ray", end: [10, 0.005] as [number, number] },
    ])("rejects an end that $name, with feedback and no entity", ({ end }) => {
        const editor = fakeEditor();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            runCommand(new SketchArcCommand(), editor, [[0, 0], [10, 0], end]);

            expect(pub).toHaveBeenCalledWith(
                "displayError",
                "Arc end point is on the start ray (zero sweep)",
            );
            expect(editor.solver.entities()).toEqual([]);
            expect(editor.commit).not.toHaveBeenCalled();
        } finally {
            pub.mockRestore();
            editor.solver.dispose();
        }
    });

    test("creates an arc when the end is just outside the start-ray wedge", () => {
        const editor = fakeEditor();
        runCommand(new SketchArcCommand(), editor, [
            [0, 0],
            [10, 0],
            // ~0.002 rad clockwise of the start ray — a near-full-circle arc
            [10, -0.02],
        ]);

        const entities = editor.solver.entities();
        expect(entities.length).toBe(1);
        expect(entities[0].type).toBe("arc");
        expect(editor.commit).toHaveBeenCalledTimes(1);
        editor.solver.dispose();
    });
});

describe("SketchRectangleCommand", () => {
    test("creates four lines linked by coincident and horizontal/vertical constraints", () => {
        const editor = fakeEditor();
        runCommand(new SketchRectangleCommand(), editor, [
            [0, 0],
            [10, 5],
        ]);

        const entities = editor.solver.entities();
        expect(entities.length).toBe(4);
        expect(entities.every((e) => e.type === "line")).toBe(true);
        const kinds = editor.solver.toData().constraints.map((c) => c.kind);
        expect(kinds.filter((k) => k === ConstraintKind.P2PCoincident).length).toBe(4);
        expect(kinds.filter((k) => k === ConstraintKind.Horizontal).length).toBe(2);
        expect(kinds.filter((k) => k === ConstraintKind.Vertical).length).toBe(2);
        expect(editor.solve).toHaveBeenCalledWith(true);
        expect(editor.commit).toHaveBeenCalledTimes(1);
        editor.solver.dispose();
    });

    test("snaps the first corner onto the origin when it is near it", () => {
        const editor = fakeEditor();
        editor.screenTolerance = () => 0.5;
        runCommand(new SketchRectangleCommand(), editor, [
            [0.2, 0.1],
            [10, 5],
        ]);

        expect(editor.solver.toData().constraints).toContainEqual({
            id: expect.any(Number),
            kind: ConstraintKind.P2PCoincident,
            refs: [{ entityId: 4, pointIndex: 0 }, originRef()],
        });
        expect(editor.solver.pointOf({ entityId: 4, pointIndex: 0 })).toEqual([0, 0]);
        editor.solver.dispose();
    });

    test("rejects a degenerate rectangle without adding entities", () => {
        const editor = fakeEditor();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            runCommand(new SketchRectangleCommand(), editor, [
                [0, 0],
                [0, 5],
            ]);

            expect(pub).toHaveBeenCalledWith("displayError", expect.any(String));
            expect(editor.solver.entities()).toEqual([]);
            expect(editor.commit).not.toHaveBeenCalled();
        } finally {
            pub.mockRestore();
            editor.solver.dispose();
        }
    });
});

/**
 * A step that hands out its picks in order; an exhausted queue reads as a cancelled
 * pick. `before` runs ahead of the nth pick, for a pick that follows something the
 * test has to do to the solver in between.
 */
function queuedStep(picks: (XYZ | undefined)[], before?: (pick: number) => void) {
    let call = 0;
    return {
        execute: rs.fn(
            async (_document: IDocument, _controller: AsyncController): Promise<SnapResult | undefined> => {
                before?.(call++);
                const point = picks.shift();
                return point === undefined
                    ? undefined
                    : { view: {} as IView, type: "input", point, shapes: [] };
            },
        ),
    };
}

type QueuedStep = ReturnType<typeof queuedStep>;

/**
 * Runs the chain loop with stubbed steps — the real ones pick through the document's
 * picker, so the picks a test cares about are handed out directly instead.
 */
async function runChain(
    command: SketchLineCommand,
    editor: FakeEditor,
    startStep: QueuedStep,
    nextStep: QueuedStep,
): Promise<void> {
    const getActive = rs.spyOn(SketchEditor, "getActive").mockReturnValue(editor as any);
    try {
        (command as any)._application = { activeView: { document: {} } };
        (command as any).getSteps = () => [startStep, nextStep];
        await (command as any).executeAsync();
    } finally {
        getActive.mockRestore();
    }
}

const uv = (x: number, y: number) => new XYZ({ x, y, z: 0 });

describe("SketchLineCommand chain", () => {
    test("every pick after the first commits the segment from the point before it", async () => {
        const editor = fakeEditor();
        await runChain(
            new SketchLineCommand(),
            editor,
            queuedStep([uv(0, 0)]),
            queuedStep([uv(10, 0), uv(10, 5), undefined]),
        );

        expect(editor.solver.entities()).toEqual([
            { id: 1, type: "line", params: [0, 0, 10, 0] },
            { id: 2, type: "line", params: [10, 0, 10, 5] },
        ]);
        expect(editor.commit).toHaveBeenCalledTimes(2);
        editor.solver.dispose();
    });

    test("a finished chain leaves the tool armed for the next one", async () => {
        const editor = fakeEditor();
        await runChain(
            new SketchLineCommand(),
            editor,
            queuedStep([uv(0, 0), uv(5, 5)]),
            queuedStep([uv(10, 0), undefined, uv(20, 20), undefined]),
        );

        expect(editor.solver.entities()).toEqual([
            { id: 1, type: "line", params: [0, 0, 10, 0] },
            { id: 2, type: "line", params: [5, 5, 20, 20] },
        ]);
        editor.solver.dispose();
    });

    test("a cancelled start pick exits without picking a next point", async () => {
        const editor = fakeEditor();
        const nextStep = queuedStep([uv(1, 1)]);
        await runChain(new SketchLineCommand(), editor, queuedStep([undefined]), nextStep);

        expect(nextStep.execute).not.toHaveBeenCalled();
        expect(editor.commit).not.toHaveBeenCalled();
        editor.solver.dispose();
    });

    test("the command's cancel ends the tool instead of re-arming it", async () => {
        const editor = fakeEditor();
        const command = new SketchLineCommand();
        // what CancelableCommand.cancel() (the panel's ✗) sets before cancelling the pick
        (command as any)._isCanceled = true;
        const startStep = queuedStep([uv(0, 0)]);
        await runChain(command, editor, startStep, queuedStep([uv(10, 0), undefined]));

        expect(startStep.execute).toHaveBeenCalledTimes(1);
        expect(editor.commit).toHaveBeenCalledTimes(1);
        editor.solver.dispose();
    });

    test("a pick on the chain's start adds the closing segment and ends the chain", async () => {
        const editor = fakeEditor();
        editor.screenTolerance = () => 0.5;
        await runChain(
            new SketchLineCommand(),
            editor,
            queuedStep([uv(3, 2)]),
            queuedStep([uv(10, 2), uv(10, 10), uv(3, 2)]),
        );

        expect(editor.solver.entities()).toEqual([
            { id: 1, type: "line", params: [3, 2, 10, 2] },
            { id: 2, type: "line", params: [10, 2, 10, 10] },
            { id: 3, type: "line", params: [10, 10, 3, 2] },
        ]);
        expect(editor.solver.toData().constraints).toContainEqual({
            id: expect.any(Number),
            kind: ConstraintKind.P2PCoincident,
            refs: [
                { entityId: 3, pointIndex: 1 },
                { entityId: 1, pointIndex: 0 },
            ],
        });
        editor.solver.dispose();
    });

    test("a one-segment chain ends on the start pick without repeating its segment", async () => {
        const editor = fakeEditor();
        const startStep = queuedStep([uv(3, 2)]);
        const nextStep = queuedStep([uv(10, 2), uv(3, 2), uv(10, 20)]);
        await runChain(new SketchLineCommand(), editor, startStep, nextStep);

        // the third pick is never taken: the chain ended on the start pick, not after
        // adding a second segment from it
        expect(editor.solver.entities()).toEqual([{ id: 1, type: "line", params: [3, 2, 10, 2] }]);
        expect(nextStep.execute).toHaveBeenCalledTimes(2);
        expect(startStep.execute).toHaveBeenCalledTimes(2);
        editor.solver.dispose();
    });

    test("the start is matched where it is now, not where it was picked", async () => {
        const editor = fakeEditor();
        // the pick before the closing one stands in for the solve that moved the
        // chain's start from (3, 2) to (4, 2) after the first segment committed
        const nextStep = queuedStep([uv(10, 2), uv(10, 10), uv(4, 2), uv(30, 30)], (pick) => {
            if (pick === 2) editor.solver.setPointPosition({ entityId: 1, pointIndex: 0 }, 4, 2);
        });
        await runChain(new SketchLineCommand(), editor, queuedStep([uv(3, 2)]), nextStep);

        // closing on the moved start leaves the (30, 30) pick unclaimed; missing it
        // would carry the chain on and draw a fourth segment through that pick
        expect(editor.solver.entities()).toEqual([
            { id: 1, type: "line", params: [4, 2, 10, 2] },
            { id: 2, type: "line", params: [10, 2, 10, 10] },
            { id: 3, type: "line", params: [10, 10, 4, 2] },
        ]);
        editor.solver.dispose();
    });
});
