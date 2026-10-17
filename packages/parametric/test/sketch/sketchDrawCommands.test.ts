// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type AsyncController,
    type IDocument,
    type IView,
    Plane,
    PubSub,
    type SnapInput,
    type SnapResult,
    XYZ,
} from "@chili3d/core";
import { rs } from "@rstest/core";
import { SketchArcCommand } from "../../src/sketch/commands/sketchArc";
import { SketchCircleCommand } from "../../src/sketch/commands/sketchCircle";
import { SketchEllipseCommand } from "../../src/sketch/commands/sketchEllipse";
import { SketchLineCommand } from "../../src/sketch/commands/sketchLine";
import { SketchPointCommand } from "../../src/sketch/commands/sketchPoint";
import type { SketchPointSnapData } from "../../src/sketch/commands/sketchPointStep";
import {
    POLYGON_CIRCUMSCRIBED,
    POLYGON_INSCRIBED,
    SketchPolygonCommand,
} from "../../src/sketch/commands/sketchPolygon";
import { SketchRectangleCommand } from "../../src/sketch/commands/sketchRectangle";
import { SketchEditor } from "../../src/sketch/editor/sketchEditor";
import { ConstraintKind, DIMENSION_KINDS, originRef } from "../../src/sketch/sketchModel";
import { type SketchDiagnostics, SketchSolver } from "../../src/sketch/solver";
import "./setup";

/** A solve that came back clean — what a stand-in editor reports until a test says otherwise. */
const noDiagnostics = (): SketchDiagnostics => ({
    dofs: 0,
    conflicting: [],
    redundant: [],
    guardConflicts: [],
});

function fakeEditor() {
    const solver = new SketchSolver(Plane.XY);
    return {
        node: { plane: Plane.XY },
        solver,
        solve: rs.fn((_fine: boolean) => {}),
        commit: rs.fn(() => {}),
        screenTolerance: () => 0,
        diagnostics: noDiagnostics(),
    };
}

/**
 * The same stand-in as `fakeEditor`, except that its solve really runs and really reports
 * what it found. Only that can say whether the dimension a typed number asked for leaves
 * the sketch solvable, and whether one the sketch already holds is dropped to a reference.
 */
function solvingEditor() {
    const solver = new SketchSolver(Plane.XY);
    const editor = {
        node: { plane: Plane.XY },
        solver,
        solve: rs.fn((_fine: boolean) => {
            solver.solve(true);
            editor.diagnostics = solver.diagnose();
        }),
        commit: rs.fn(() => {}),
        screenTolerance: () => 0,
        diagnostics: noDiagnostics(),
    };
    return editor;
}

type FakeEditor = ReturnType<typeof fakeEditor>;

/**
 * Drives executeMainTask directly with canned step points on the XY plane. `inputs`, where
 * given, says what was typed at each pick — the record `SnapResult.input` carries in the
 * real thing, and the only thing that tells a command a pick was typed at all.
 */
function runCommand(
    command: object,
    editor: FakeEditor,
    points: [number, number][],
    inputs?: (SnapInput | undefined)[],
) {
    const getActive = rs.spyOn(SketchEditor, "getActive").mockReturnValue(editor as any);
    (command as any).stepDatas = points.map(([x, y], index) => ({
        point: new XYZ({ x, y, z: 0 }),
        input: inputs?.[index],
    }));
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

/**
 * What the step at `index` reads out under a cursor at `probe` (both in sketch uv). The readout
 * is a plain string on the step's own data, which is what the float tip shows while picking.
 */
function promptOf(command: object, points: [number, number][], index: number, probe?: [number, number]) {
    const editor = fakeEditor();
    const getActive = rs.spyOn(SketchEditor, "getActive").mockReturnValue(editor as any);
    try {
        (command as any).stepDatas = points.map(([x, y]) => ({ point: new XYZ({ x, y, z: 0 }) }));
        const step = (command as any).getSteps()[index];
        const data = step.handleStepData() as SketchPointSnapData;
        const snaped = probe === undefined ? {} : { point: new XYZ({ x: probe[0], y: probe[1], z: 0 }) };
        return data.prompt?.(snaped as SnapResult);
    } finally {
        getActive.mockRestore();
        editor.solver.dispose();
    }
}

describe("step readouts", () => {
    test("the rectangle's is its two sides, not the diagonal to the first corner", () => {
        expect(promptOf(new SketchRectangleCommand(), [[0, 0]], 1, [10, 5])).toBe("10.00, 5.00");
    });

    test("the rectangle's reads the sides the same either way round", () => {
        // a corner picked up and to the left of the first: both offsets are negative
        expect(promptOf(new SketchRectangleCommand(), [[10, 5]], 1, [0, 0])).toBe("10.00, 5.00");
    });

    test("the rectangle's falls back while there is no point to read", () => {
        // empty rather than a zero size: the tip then shows what the step would otherwise show
        expect(promptOf(new SketchRectangleCommand(), [[0, 0]], 1)).toBe("");
    });
});

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

/** A pick typed as a single number: the one input form that states a reading. */
const typed = (value: number): SnapInput => ({ values: [value], absolute: false });

describe("typed dimensions", () => {
    test("the sketch takes the typed length and stays solvable", () => {
        const editor = solvingEditor();
        runCommand(
            new SketchLineCommand(),
            editor,
            [
                [0, 0],
                [10, 0],
            ],
            [undefined, typed(10)],
        );

        // the premise the whole thing rests on: the datum the dimension carries is the
        // geometry's own measurement, so the solve has nothing to fight
        const diagnostics = editor.solver.diagnose();
        expect(diagnostics.conflicting).toEqual([]);
        expect(diagnostics.redundant).toEqual([]);
        expect(editor.solver.pointOf({ entityId: 1, pointIndex: 1 })[0]).toBeCloseTo(10, 6);
        editor.solver.dispose();
    });

    test("a dimension the solve calls redundant is placed as a reference", () => {
        const editor = fakeEditor();
        // what a solve says about a reading the sketch already holds. The verdict itself is
        // garlic's, covered where a real solver is in the loop (`sketchDimensions.test.ts`
        // for the dimension tools); what this covers is that a drawing command hands its own
        // dimension to that same demotion instead of leaving a second one driving.
        editor.solve = rs.fn((_fine: boolean) => {
            editor.diagnostics = {
                dofs: 0,
                conflicting: [],
                redundant: editor.solver
                    .toData()
                    .constraints.filter((c) => DIMENSION_KINDS.has(c.kind))
                    .map((c) => c.id),
                guardConflicts: [],
            };
        });

        runCommand(
            new SketchLineCommand(),
            editor,
            [
                [0, 0],
                [10, 0],
            ],
            [undefined, typed(10)],
        );

        const distances = editor.solver
            .toData()
            .constraints.filter((c) => c.kind === ConstraintKind.P2PDistance);
        expect(distances).toHaveLength(1);
        expect(distances[0].driven).toBe(true);
        editor.solver.dispose();
    });

    test("a line is dimensioned by the length that was typed", () => {
        const editor = fakeEditor();
        runCommand(
            new SketchLineCommand(),
            editor,
            [
                [0, 0],
                [10, 0],
            ],
            [undefined, typed(10)],
        );

        expect(editor.solver.toData().constraints).toContainEqual({
            id: expect.any(Number),
            kind: ConstraintKind.P2PDistance,
            refs: [
                { entityId: 1, pointIndex: 0 },
                { entityId: 1, pointIndex: 1 },
            ],
            datum: 10,
        });
        editor.solver.dispose();
    });

    test("a circle is dimensioned by the radius that was typed", () => {
        const editor = fakeEditor();
        runCommand(
            new SketchCircleCommand(),
            editor,
            [
                [3, 4],
                [9, 4],
            ],
            [undefined, typed(6)],
        );

        expect(editor.solver.toData().constraints).toContainEqual({
            id: expect.any(Number),
            kind: ConstraintKind.Radius,
            refs: [{ entityId: 1, pointIndex: 0 }],
            datum: 6,
        });
        editor.solver.dispose();
    });

    test("an arc's number is read at its radius pick, not at its last pick", () => {
        const editor = fakeEditor();
        // the end pick takes no number at all, so a reading taken at the last pick would
        // find nothing and dimension nothing
        runCommand(
            new SketchArcCommand(),
            editor,
            [
                [0, 0],
                [10, 0],
                [0, 10],
            ],
            [undefined, typed(10)],
        );

        expect(editor.solver.toData().constraints).toContainEqual({
            id: expect.any(Number),
            kind: ConstraintKind.Radius,
            refs: [{ entityId: 1, pointIndex: 0 }],
            datum: 10,
        });
        editor.solver.dispose();
    });

    test("an ellipse is dimensioned by its major radius", () => {
        const editor = fakeEditor();
        runCommand(
            new SketchEllipseCommand(),
            editor,
            [
                [0, 0],
                [10, 0],
                [0, 5],
            ],
            [undefined, typed(10)],
        );

        expect(editor.solver.toData().constraints).toContainEqual({
            id: expect.any(Number),
            kind: ConstraintKind.P2PDistance,
            refs: [
                { entityId: 1, pointIndex: 0 },
                { entityId: 1, pointIndex: 1 },
            ],
            datum: 10,
        });
        editor.solver.dispose();
    });

    test("the datum is the measurement, not the number typed", () => {
        // The datum is read off the geometry when the constraint is added, not carried in from
        // the number typed — here the two disagree outright (typed 42, geometry 10) and the
        // geometry is what wins. That is what keeps the dimension from fighting the sketch it
        // lands on; in the app the two part the same way whenever a snap moves the point after
        // the entity is built, which is still before the dimension is added (`commitNewEntity`).
        const editor = fakeEditor();
        runCommand(
            new SketchLineCommand(),
            editor,
            [
                [0, 0],
                [10, 0],
            ],
            [undefined, typed(42)],
        );

        const distances = editor.solver
            .toData()
            .constraints.filter((c) => c.kind === ConstraintKind.P2PDistance);
        expect(distances).toHaveLength(1);
        expect(distances[0].datum).toBe(10);
        editor.solver.dispose();
    });

    test("an inscribed polygon dimensions its carrier circle", () => {
        const editor = fakeEditor();
        const command = new SketchPolygonCommand();
        command.polygonMode = POLYGON_INSCRIBED;
        runCommand(
            command,
            editor,
            [
                [0, 0],
                [10, 0],
            ],
            [undefined, typed(10)],
        );

        const carrier = editor.solver.entities().find((entity) => entity.type === "circle")!;
        expect(editor.solver.toData().constraints).toContainEqual({
            id: expect.any(Number),
            kind: ConstraintKind.Radius,
            refs: [{ entityId: carrier.id, pointIndex: 0 }],
            datum: 10,
        });
        editor.solver.dispose();
    });

    test("a circumscribed polygon dimensions its picked incircle", () => {
        // The pick's number is the apothem, which is the incircle's radius — not the carrier's,
        // whose radius is that over cos(π/n). So the dimension goes on the second circle, the
        // one the three tangencies hold, and garlic says it is no restatement: a tangency ties
        // the circle to the edges, and the polygon they belong to is still free to scale around
        // it, which is the degree of freedom this dimension takes.
        const editor = solvingEditor();
        const command = new SketchPolygonCommand();
        command.polygonMode = POLYGON_CIRCUMSCRIBED;
        runCommand(
            command,
            editor,
            [
                [0, 0],
                [10, 0],
            ],
            [undefined, typed(10)],
        );

        // the carrier through the vertices first, the picked incircle second
        const circles = editor.solver.entities().filter((entity) => entity.type === "circle");
        expect(circles).toHaveLength(2);

        expect(editor.solver.toData().constraints.filter((c) => DIMENSION_KINDS.has(c.kind))).toEqual([
            {
                id: expect.any(Number),
                kind: ConstraintKind.Radius,
                refs: [{ entityId: circles[1].id, pointIndex: 0 }],
                datum: 10,
            },
        ]);
        expect(editor.diagnostics.redundant).toEqual([]);
        editor.solver.dispose();
    });

    test("the two offsets a rectangle is sized by become its width and height", () => {
        const editor = fakeEditor();
        runCommand(
            new SketchRectangleCommand(),
            editor,
            [
                [0, 0],
                [10, 5],
            ],
            [undefined, { values: [10, 5], absolute: false }],
        );

        // the rectangle's edges are top, right, bottom, left in that order, and each size is
        // the gap across: an endpoint of one edge, then the opposite edge's own two
        const constraints = editor.solver.toData().constraints;
        expect(constraints).toContainEqual({
            id: expect.any(Number),
            kind: ConstraintKind.P2LDistance,
            refs: [
                { entityId: 4, pointIndex: 0 },
                { entityId: 2, pointIndex: 0 },
                { entityId: 2, pointIndex: 1 },
            ],
            datum: 10,
        });
        expect(constraints).toContainEqual({
            id: expect.any(Number),
            kind: ConstraintKind.P2LDistance,
            refs: [
                { entityId: 1, pointIndex: 0 },
                { entityId: 3, pointIndex: 0 },
                { entityId: 3, pointIndex: 1 },
            ],
            datum: 5,
        });
        editor.solver.dispose();
    });

    test("the rectangle takes that pair and stays solvable", () => {
        const picked = solvingEditor();
        runCommand(new SketchRectangleCommand(), picked, [
            [0, 0],
            [10, 5],
        ]);
        const free = picked.solver.diagnose().dofs;

        const typed = solvingEditor();
        runCommand(
            new SketchRectangleCommand(),
            typed,
            [
                [0, 0],
                [10, 5],
            ],
            [undefined, { values: [10, 5], absolute: false }],
        );

        const diagnostics = typed.solver.diagnose();
        expect(diagnostics.conflicting).toEqual([]);
        expect(diagnostics.redundant).toEqual([]);
        // the width and the height, and the only two the pair pinned: the rectangle's edges are
        // rigid by construction, so what is left over is moving it
        expect(diagnostics.dofs).toBe(free - 2);

        picked.solver.dispose();
        typed.solver.dispose();
    });

    test("a rectangle picked without a typed pair takes no dimension", () => {
        const editor = fakeEditor();
        runCommand(new SketchRectangleCommand(), editor, [
            [0, 0],
            [10, 5],
        ]);

        expect(editor.solver.toData().constraints.filter((c) => DIMENSION_KINDS.has(c.kind))).toEqual([]);
        editor.solver.dispose();
    });

    test.each([
        { name: "a click", input: undefined },
        { name: "a pair of offsets", input: { values: [10, 5], absolute: false } },
        { name: "absolute coordinates", input: { values: [10, 5, 0], absolute: true } },
    ] as {
        name: string;
        input: SnapInput | undefined;
    }[])(// a line is read by a lone number only: to it a pair says where the endpoint goes, not
    // how long the segment is, and its size is what the single number already states
    "a line takes no dimension from $name", ({ input }) => {
        const editor = fakeEditor();
        runCommand(
            new SketchLineCommand(),
            editor,
            [
                [0, 0],
                [10, 0],
            ],
            [undefined, input],
        );

        expect(
            editor.solver.toData().constraints.filter((c) => c.kind === ConstraintKind.P2PDistance),
        ).toEqual([]);
        editor.solver.dispose();
    });
});

/**
 * A step that hands out its picks in order; an exhausted queue reads as a cancelled
 * pick. `before` runs ahead of the nth pick, for a pick that follows something the
 * test has to do to the solver in between, and `inputs` says what was typed at the nth.
 */
function queuedStep(
    picks: (XYZ | undefined)[],
    before?: (pick: number) => void,
    inputs?: (SnapInput | undefined)[],
) {
    let call = 0;
    return {
        execute: rs.fn(
            async (_document: IDocument, _controller: AsyncController): Promise<SnapResult | undefined> => {
                const pick = call++;
                before?.(pick);
                const point = picks.shift();
                return point === undefined
                    ? undefined
                    : { view: {} as IView, type: "input", point, shapes: [], input: inputs?.[pick] };
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

    test("each segment is dimensioned by the number typed for that segment", async () => {
        const editor = fakeEditor();
        const nextStep = queuedStep([uv(10, 0), uv(10, 5), undefined], undefined, [typed(10), typed(5)]);
        await runChain(new SketchLineCommand(), editor, queuedStep([uv(0, 0)]), nextStep);

        // each segment carries its own: a pick's record is replaced along with the pick, so
        // a reading left over from the segment before would dimension this one by that number
        expect(
            editor.solver
                .toData()
                .constraints.filter((c) => c.kind === ConstraintKind.P2PDistance)
                .map((c) => ({ refs: c.refs, datum: c.datum })),
        ).toEqual([
            {
                refs: [
                    { entityId: 1, pointIndex: 0 },
                    { entityId: 1, pointIndex: 1 },
                ],
                datum: 10,
            },
            {
                refs: [
                    { entityId: 2, pointIndex: 0 },
                    { entityId: 2, pointIndex: 1 },
                ],
                datum: 5,
            },
        ]);
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

describe("SketchPointCommand", () => {
    /** The point tool loops on its single step, so the harness hands out that one. */
    async function runPoints(command: SketchPointCommand, editor: FakeEditor, step: QueuedStep) {
        const getActive = rs.spyOn(SketchEditor, "getActive").mockReturnValue(editor as any);
        try {
            (command as any)._application = { activeView: { document: {} } };
            (command as any).getSteps = () => [step];
            await (command as any).executeAsync();
        } finally {
            getActive.mockRestore();
        }
    }

    test("places one point per pick until a pick is cancelled", async () => {
        const editor = fakeEditor();
        const step = queuedStep([uv(3, 4), uv(-1, 2), undefined]);
        await runPoints(new SketchPointCommand(), editor, step);

        expect(editor.solver.entities()).toEqual([
            { id: 1, type: "point", params: [3, 4] },
            { id: 2, type: "point", params: [-1, 2] },
        ]);
        expect(editor.commit).toHaveBeenCalledTimes(2);
        expect(step.execute).toHaveBeenCalledTimes(3);
        editor.solver.dispose();
    });

    test("a cancelled first pick places nothing", async () => {
        const editor = fakeEditor();
        await runPoints(new SketchPointCommand(), editor, queuedStep([undefined]));

        expect(editor.solver.entities()).toEqual([]);
        expect(editor.commit).not.toHaveBeenCalled();
        editor.solver.dispose();
    });

    test("a pick near a line's endpoint snaps onto it and coincides", async () => {
        const editor = fakeEditor();
        const lineId = editor.solver.addLine(0, 0, 10, 0);
        editor.screenTolerance = () => 0.5;
        await runPoints(new SketchPointCommand(), editor, queuedStep([uv(10.2, 0.1), undefined]));

        const point = editor.solver.entities().find((entity) => entity.type === "point");
        expect(point).toBeDefined();
        expect(editor.solver.toData().constraints).toContainEqual({
            id: expect.any(Number),
            kind: ConstraintKind.P2PCoincident,
            refs: [
                { entityId: point!.id, pointIndex: 0 },
                { entityId: lineId, pointIndex: 1 },
            ],
        });
        editor.solver.dispose();
    });
});
