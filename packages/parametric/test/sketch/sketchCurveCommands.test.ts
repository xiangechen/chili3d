// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type AsyncController,
    CommandStore,
    type IDocument,
    type IView,
    Plane,
    PubSub,
    type SnapResult,
    XYZ,
} from "@chili3d/core";
import { rs } from "@rstest/core";
import { SketchBezierCommand } from "../../src/sketch/commands/sketchBezier";
import { SketchConicCommand } from "../../src/sketch/commands/sketchConic";
import { ellipseParams, SketchEllipseCommand } from "../../src/sketch/commands/sketchEllipse";
import { SketchEllipseArcCommand } from "../../src/sketch/commands/sketchEllipseArc";
import { SketchNurbsCommand } from "../../src/sketch/commands/sketchNurbs";
import type { SketchPointSnapData } from "../../src/sketch/commands/sketchPointStep";
import { ellipseSweep, sampleEntity } from "../../src/sketch/curveEval";
import { SketchEditor } from "../../src/sketch/editor/sketchEditor";
import { ConstraintKind, isStructuralConstraint } from "../../src/sketch/sketchModel";
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

/**
 * Runs the real step loop with queued picks: an undefined pick is a cancelled one
 * (Escape on the point step), a successful one settles its controller the way the
 * snap handler does, or `executeSteps` would read the pick as failed.
 */
async function runPicks(command: object, editor: FakeEditor, picks: (XYZ | undefined)[]): Promise<void> {
    const getActive = rs.spyOn(SketchEditor, "getActive").mockReturnValue(editor as any);
    try {
        (command as any)._application = {
            activeView: { document: { selection: { clearSelection: () => {} } } },
        };
        const steps = picks.map((pick) => ({
            execute: rs.fn(
                async (
                    _document: IDocument,
                    controller: AsyncController,
                ): Promise<SnapResult | undefined> => {
                    if (pick === undefined) return undefined;
                    controller.success();
                    return { view: {} as IView, type: "input", point: pick, shapes: [] };
                },
            ),
        }));
        (command as any).getSteps = () => steps;
        await (command as any).executeAsync();
    } finally {
        getActive.mockRestore();
    }
}

/**
 * A step that hands out its picks in order; an exhausted queue reads as a cancelled
 * pick.
 */
function queuedStep(picks: (XYZ | undefined)[]) {
    return {
        execute: rs.fn(
            async (_document: IDocument, _controller: AsyncController): Promise<SnapResult | undefined> => {
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
 * Runs a chain tool's loop with stubbed steps — the real ones pick through the document's
 * picker, so the picks a test cares about are handed out directly instead. A chain tool
 * re-picks the same step for every point after its first, so the two stubs below hand the
 * queue out between them.
 */
async function runChain(
    command: object,
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

/** The meshes the step at `index` draws for a probe at `probe` (both in sketch uv). */
function previewOf(command: object, points: [number, number][], index: number, probe: [number, number]) {
    const editor = fakeEditor();
    const getActive = rs.spyOn(SketchEditor, "getActive").mockReturnValue(editor as any);
    try {
        (command as any).stepDatas = points.map(([x, y]) => ({ point: new XYZ({ x, y, z: 0 }) }));
        const step = (command as any).getSteps()[index];
        const preview = (step.handleStepData() as SketchPointSnapData).preview;
        return (preview?.(uv(probe[0], probe[1])) ?? []) as any[];
    } finally {
        getActive.mockRestore();
        editor.solver.dispose();
    }
}

/** The dashed segments of a preview, as their endpoints. */
function dashedSegments(meshes: readonly any[]): number[][] {
    return meshes
        .filter((mesh) => mesh.lineType === "dash")
        .map((mesh) => Array.from(mesh.position as Float32Array));
}

describe("control polygon previews", () => {
    test("the bezier chain previews its spine dashed, with the segment the pick would add", () => {
        // two points down: the dashed spine runs through both to the probe, and the segment
        // the pick would hang on the last pair is drawn as the curve it is (the chain's own
        // step is the second one, index 1)
        const command = new SketchBezierCommand();
        (command as any).poles = [
            [1, 1],
            [4, 1],
        ];
        const meshes = previewOf(command, [[4, 1]], 1, [7, 1]);

        expect(dashedSegments(meshes)).toEqual([
            [1, 1, 0, 4, 1, 0],
            [4, 1, 0, 7, 1, 0],
        ]);
        expect(meshes.some((mesh) => mesh.lineType === "solid")).toBe(true);
    });

    test("the nurbs' whole control polygon is previewed dashed, the probe included", () => {
        const command = new SketchNurbsCommand();
        // the chain the tool has collected so far lives on the command, one control point
        // per pick (the tool commits only when the polygon ends)
        (command as any).poles = [
            [0, 0],
            [2, 4],
        ];
        const meshes = previewOf(command, [[2, 4]], 1, [6, 4]);
        expect(dashedSegments(meshes)).toEqual([
            [0, 0, 0, 2, 4, 0],
            [2, 4, 0, 6, 4, 0],
        ]);
        // and the curve the probe would commit, drawn solid beside it
        expect(meshes.some((mesh) => mesh.lineType === undefined || mesh.lineType === "solid")).toBe(true);
    });
});

describe("step tentatives", () => {
    test("the ellipse minor step projects the probe onto the perpendicular of the major axis", () => {
        expect(
            tentativeOf(
                new SketchEllipseCommand(),
                [
                    [0, 0],
                    [10, 0],
                ],
                2,
                [3, 4],
            ),
        ).toEqual({
            type: "ellipse",
            params: [0, 0, 10, 0, 0, 4],
        });
    });

    test("the ellipse minor step has no tentative while the probe sits on the major axis", () => {
        expect(
            tentativeOf(
                new SketchEllipseCommand(),
                [
                    [0, 0],
                    [10, 0],
                ],
                2,
                [5, 0],
            ),
        ).toBeUndefined();
    });

    test("the ellipseArc start step reads as the whole ellipse until the sweep is picked", () => {
        expect(
            tentativeOf(
                new SketchEllipseArcCommand(),
                [
                    [0, 0],
                    [10, 0],
                    [0, 5],
                ],
                3,
                [10, 0],
            ),
        ).toEqual({
            type: "ellipseArc",
            params: [0, 0, 10, 0, 0, 5, 10, 0, 10, 0],
        });
    });

    test("the conic control step tentatives at the default rho of ½", () => {
        expect(
            tentativeOf(
                new SketchConicCommand(),
                [
                    [0, 0],
                    [10, 0],
                ],
                2,
                [5, 10],
            ),
        ).toEqual({
            type: "conic",
            params: [0, 0, 5, 10, 10, 0, 0.5],
        });
    });

    test("the conic shoulder step reads rho off the probe", () => {
        expect(
            tentativeOf(
                new SketchConicCommand(),
                [
                    [0, 0],
                    [10, 0],
                    [5, 10],
                ],
                3,
                [5, 2.5],
            ),
        ).toEqual({
            type: "conic",
            params: [0, 0, 5, 10, 10, 0, 0.25],
        });
    });
});

describe("ellipseParams", () => {
    test("reads the minor point off a vertical major axis", () => {
        expect(ellipseParams([0, 0], [0, 10], [-4, 7])).toEqual([0, 0, 0, 10, -4, 0]);
    });

    test("keeps the minor point on the side of the major axis the probe picked", () => {
        expect(ellipseParams([0, 0], [10, 0], [1, -4])).toEqual([0, 0, 10, 0, 0, -4]);
    });

    test.each([
        {
            name: "the major point is the center",
            major: [0, 0] as [number, number],
            probe: [0, 4] as [number, number],
        },
        {
            name: "the probe sits on the major axis",
            major: [10, 0] as [number, number],
            probe: [5, 0] as [number, number],
        },
    ])("is undefined while $name", ({ major, probe }) => {
        expect(ellipseParams([0, 0], major, probe)).toBeUndefined();
    });
});

describe("SketchEllipseCommand", () => {
    test("is registered under the key the ribbon's draw group names", () => {
        const data = CommandStore.getComandData("sketch.ellipse");

        expect(data).toBeDefined();
        expect(data!.icon).toBe("icon-ellipse");
    });

    test("adds an ellipse entity from center, major-axis point and minor probe", () => {
        const editor = fakeEditor();
        runCommand(new SketchEllipseCommand(), editor, [
            [0, 0],
            [10, 0],
            // off the perpendicular: the third click sets the minor radius alone
            [3, 4],
        ]);

        expect(editor.solver.entities()).toEqual([{ id: 1, type: "ellipse", params: [0, 0, 10, 0, 0, 4] }]);
        expect(editor.solve).toHaveBeenCalledWith(true);
        expect(editor.commit).toHaveBeenCalledTimes(1);
        editor.solver.dispose();
    });

    test("the tool's own projected points take no auto-constraint", () => {
        const editor = fakeEditor();
        // a tolerance that reaches: the line's end sits 0.45 from the minor point below
        editor.screenTolerance = () => 1;
        editor.solver.addLine(0.4, 4.8, 3, 4.8);
        runCommand(new SketchEllipseCommand(), editor, [
            [0, 0],
            [10, 0],
            [0, 5],
        ]);

        // (0, 5) is the minor probe *projected* onto the major axis's perpendicular — the tool's
        // own point, not the user's pick. A snap onto the line's end there would pull the whole
        // ellipse off the shape the user drew, which is exactly what the projection exists to
        // avoid on the first solve.
        const ellipse = editor.solver.entities().find((entity) => entity.type === "ellipse")!;
        expect(ellipse.params.slice(4)).toEqual([0, 5]);
        editor.solver.dispose();
    });

    test("pins the axes perpendicular with one structural constraint, satisfied as drawn", () => {
        const editor = fakeEditor();
        runCommand(new SketchEllipseCommand(), editor, [
            [0, 0],
            [10, 0],
            [3, 4],
        ]);

        const constraints = editor.solver.toData().constraints;
        expect(constraints).toEqual([
            {
                id: 1,
                kind: ConstraintKind.Perpendicular,
                refs: [
                    { entityId: 1, pointIndex: 0 },
                    { entityId: 1, pointIndex: 1 },
                    { entityId: 1, pointIndex: 0 },
                    { entityId: 1, pointIndex: 2 },
                ],
            },
        ]);
        expect(isStructuralConstraint(constraints[0])).toBe(true);

        // the minor point lands on the perpendicular by projection, so the pin is
        // exactly satisfied and the first real solve has nothing to move
        editor.solver.solve(true);
        const params = editor.solver.entities()[0].params;
        for (const [index, value] of [0, 0, 10, 0, 0, 4].entries()) {
            expect(params[index]).toBeCloseTo(value, 12);
        }
        editor.solver.dispose();
    });

    test("construction mode commits the ellipse as construction geometry", () => {
        const editor = fakeEditor();
        const command = new SketchEllipseCommand();
        command.construction = true;
        runCommand(command, editor, [
            [0, 0],
            [10, 0],
            [0, 4],
        ]);

        expect(editor.solver.entities()).toEqual([
            { id: 1, type: "ellipse", params: [0, 0, 10, 0, 0, 4], construction: true },
        ]);
        expect(editor.solver.isConstruction(1)).toBe(true);
        editor.solver.dispose();
    });

    test.each([
        {
            name: "a major-axis point on the center",
            points: [
                [0, 0],
                [0, 0],
                [0, 4],
            ] as [number, number][],
        },
        {
            name: "a minor-axis probe on the major axis",
            points: [
                [0, 0],
                [10, 0],
                [5, 0],
            ] as [number, number][],
        },
    ])("rejects $name with feedback and no entity", ({ points }) => {
        const editor = fakeEditor();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            runCommand(new SketchEllipseCommand(), editor, points);

            expect(pub).toHaveBeenCalledWith("displayError", "Ellipse axis point is too close to the center");
            expect(editor.solver.entities()).toEqual([]);
            expect(editor.commit).not.toHaveBeenCalled();
        } finally {
            pub.mockRestore();
            editor.solver.dispose();
        }
    });

    test("a cancelled minor-axis pick commits nothing", async () => {
        const editor = fakeEditor();
        await runPicks(new SketchEllipseCommand(), editor, [uv(0, 0), uv(10, 0), undefined]);

        expect(editor.solver.entities()).toEqual([]);
        expect(editor.solve).not.toHaveBeenCalled();
        expect(editor.commit).not.toHaveBeenCalled();
        editor.solver.dispose();
    });
});

describe("SketchEllipseArcCommand", () => {
    test("is registered under the key the ribbon's draw group names", () => {
        const data = CommandStore.getComandData("sketch.ellipseArc");

        expect(data).toBeDefined();
        expect(data!.icon).toBe("icon-ellipseSolid");
    });

    test("adds an ellipseArc entity from center, axes and rim probes, projected onto the ellipse", () => {
        const editor = fakeEditor();
        runCommand(new SketchEllipseArcCommand(), editor, [
            [0, 0],
            [10, 0],
            [0, 5],
            [10, 0],
            // off the ellipse: the end lands on its projection, at parameter π/2
            [0, 8],
        ]);

        const entities = editor.solver.entities();
        expect(entities.length).toBe(1);
        expect(entities[0].type).toBe("ellipseArc");
        expect(entities[0].params.length).toBe(10);
        for (const [index, value] of [0, 0, 10, 0, 0, 5, 10, 0, 0, 5].entries()) {
            expect(entities[0].params[index]).toBeCloseTo(value, 12);
        }
        // the sweep reads counter-clockwise from start to end — here a quarter turn
        const [t0, t1] = ellipseSweep(entities[0].params);
        expect(t0).toBeCloseTo(0, 12);
        expect(t1).toBeCloseTo(Math.PI / 2, 12);
        expect(editor.solve).toHaveBeenCalledWith(true);
        expect(editor.commit).toHaveBeenCalledTimes(1);
        editor.solver.dispose();
    });

    test("pins the axes perpendicular and both rim points on the ellipse, all structural", () => {
        const editor = fakeEditor();
        runCommand(new SketchEllipseArcCommand(), editor, [
            [0, 0],
            [10, 0],
            [0, 5],
            [10, 0],
            [0, 8],
        ]);

        const constraints = editor.solver.toData().constraints;
        expect(constraints).toEqual([
            {
                id: 1,
                kind: ConstraintKind.Perpendicular,
                refs: [
                    { entityId: 1, pointIndex: 0 },
                    { entityId: 1, pointIndex: 1 },
                    { entityId: 1, pointIndex: 0 },
                    { entityId: 1, pointIndex: 2 },
                ],
            },
            {
                id: 2,
                kind: ConstraintKind.PointOnEllipse,
                refs: [
                    { entityId: 1, pointIndex: 3 },
                    { entityId: 1, pointIndex: 0 },
                ],
            },
            {
                id: 3,
                kind: ConstraintKind.PointOnEllipse,
                refs: [
                    { entityId: 1, pointIndex: 4 },
                    { entityId: 1, pointIndex: 0 },
                ],
            },
        ]);
        expect(constraints.every(isStructuralConstraint)).toBe(true);

        // the rim points are projected onto the ellipse at commit, so the pins are
        // already satisfied and the first real solve moves nothing
        editor.solver.solve(true);
        const params = editor.solver.entities()[0].params;
        for (const [index, value] of [0, 0, 10, 0, 0, 5, 10, 0, 0, 5].entries()) {
            expect(params[index]).toBeCloseTo(value, 12);
        }
        editor.solver.dispose();
    });

    test("construction mode commits the ellipseArc as construction geometry", () => {
        const editor = fakeEditor();
        const command = new SketchEllipseArcCommand();
        command.construction = true;
        runCommand(command, editor, [
            [0, 0],
            [10, 0],
            [0, 5],
            [10, 0],
            [0, 5],
        ]);

        const entities = editor.solver.entities();
        expect(entities.length).toBe(1);
        expect(entities[0].type).toBe("ellipseArc");
        expect(entities[0].construction).toBe(true);
        expect(editor.solver.isConstruction(1)).toBe(true);
        editor.solver.dispose();
    });

    test("rejects a degenerate axis with feedback and no entity", () => {
        const editor = fakeEditor();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            runCommand(new SketchEllipseArcCommand(), editor, [
                [0, 0],
                [0, 0],
                [0, 5],
                [10, 0],
                [0, 10],
            ]);

            expect(pub).toHaveBeenCalledWith("displayError", "Ellipse axis point is too close to the center");
            expect(editor.solver.entities()).toEqual([]);
            expect(editor.commit).not.toHaveBeenCalled();
        } finally {
            pub.mockRestore();
            editor.solver.dispose();
        }
    });

    test("rejects an end point on the start's ray (zero sweep) with feedback and no entity", () => {
        const editor = fakeEditor();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            runCommand(new SketchEllipseArcCommand(), editor, [
                [0, 0],
                [10, 0],
                [0, 5],
                [10, 0],
                // same ray as the start, so both rim points project to (10, 0)
                [20, 0],
            ]);

            expect(pub).toHaveBeenCalledWith(
                "displayError",
                "EllipseArc end point is on the start ray (zero sweep)",
            );
            expect(editor.solver.entities()).toEqual([]);
            expect(editor.commit).not.toHaveBeenCalled();
        } finally {
            pub.mockRestore();
            editor.solver.dispose();
        }
    });

    test("a cancelled start pick commits nothing", async () => {
        const editor = fakeEditor();
        await runPicks(new SketchEllipseArcCommand(), editor, [uv(0, 0), uv(10, 0), uv(0, 5), undefined]);

        expect(editor.solver.entities()).toEqual([]);
        expect(editor.solve).not.toHaveBeenCalled();
        expect(editor.commit).not.toHaveBeenCalled();
        editor.solver.dispose();
    });
});

describe("SketchConicCommand", () => {
    test("is registered under the key the ribbon's draw group names", () => {
        const data = CommandStore.getComandData("sketch.conic");

        expect(data).toBeDefined();
        expect(data!.icon).toBe("icon-arcTTR");
    });

    test("adds a conic entity from start, end, control and shoulder picks, with no structural constraints", () => {
        const editor = fakeEditor();
        runCommand(new SketchConicCommand(), editor, [
            [0, 0],
            [10, 0],
            [5, 10],
            // a quarter of the chord-midpoint → control direction, so rho = 0.25
            [5, 2.5],
        ]);

        // the stored order is start, control, end — not the pick order
        expect(editor.solver.entities()).toEqual([
            { id: 1, type: "conic", params: [0, 0, 5, 10, 10, 0, 0.25] },
        ]);
        expect(editor.solver.toData().constraints).toEqual([]);
        expect(editor.solve).toHaveBeenCalledWith(true);
        expect(editor.commit).toHaveBeenCalledTimes(1);
        editor.solver.dispose();
    });

    test.each([
        { name: "on the chord", shoulder: [5, 0] as [number, number], rho: 0.05 },
        { name: "past the control point", shoulder: [5, 20] as [number, number], rho: 0.95 },
    ])("clamps rho to $rho when the shoulder sits $name", ({ shoulder, rho }) => {
        const editor = fakeEditor();
        runCommand(new SketchConicCommand(), editor, [[0, 0], [10, 0], [5, 10], shoulder]);

        expect(editor.solver.entities()).toEqual([
            { id: 1, type: "conic", params: [0, 0, 5, 10, 10, 0, rho] },
        ]);
        editor.solver.dispose();
    });

    test("defaults rho to ½ when the control point sits on the chord's midpoint", () => {
        const editor = fakeEditor();
        runCommand(new SketchConicCommand(), editor, [
            [0, 0],
            [10, 0],
            [5, 0],
            [3, 3],
        ]);

        expect(editor.solver.entities()).toEqual([
            { id: 1, type: "conic", params: [0, 0, 5, 0, 10, 0, 0.5] },
        ]);
        editor.solver.dispose();
    });

    test("a cancelled shoulder pick commits nothing", async () => {
        const editor = fakeEditor();
        await runPicks(new SketchConicCommand(), editor, [uv(0, 0), uv(10, 0), uv(5, 10), undefined]);

        expect(editor.solver.entities()).toEqual([]);
        expect(editor.solve).not.toHaveBeenCalled();
        expect(editor.commit).not.toHaveBeenCalled();
        editor.solver.dispose();
    });

    test("construction mode commits the conic as construction geometry", () => {
        const editor = fakeEditor();
        const command = new SketchConicCommand();
        command.construction = true;
        runCommand(command, editor, [
            [0, 0],
            [10, 0],
            [5, 10],
            [5, 5],
        ]);

        expect(editor.solver.entities()).toEqual([
            { id: 1, type: "conic", params: [0, 0, 5, 10, 10, 0, 0.5], construction: true },
        ]);
        expect(editor.solver.isConstruction(1)).toBe(true);
        editor.solver.dispose();
    });
});

describe("SketchNurbsCommand chain", () => {
    test("is registered under the key the ribbon's draw group names", () => {
        const data = CommandStore.getComandData("sketch.nurbs");

        expect(data).toBeDefined();
        expect(data!.icon).toBe("icon-toPoly");
    });

    test("commits every picked pole as one nurbs when the polygon ends", async () => {
        const editor = fakeEditor();
        await runChain(
            new SketchNurbsCommand(),
            editor,
            queuedStep([uv(0, 0)]),
            queuedStep([uv(10, 0), uv(5, 8), undefined]),
        );

        // three poles with unit weights; the clamped uniform construction is the tool's own
        expect(editor.solver.entities()).toEqual([
            {
                id: 1,
                type: "nurbs",
                params: [0, 0, 10, 0, 5, 8, 1, 1, 1],
                nurbs: { degree: 2, knots: [0, 0, 0, 1, 1, 1] },
            },
        ]);
        expect(editor.solver.toData().constraints).toEqual([]);
        expect(editor.solve).toHaveBeenCalledWith(true);
        expect(editor.commit).toHaveBeenCalledTimes(1);
        editor.solver.dispose();
    });

    test("finishing after two poles still commits them, as a degree-1 curve", async () => {
        const editor = fakeEditor();
        await runChain(
            new SketchNurbsCommand(),
            editor,
            queuedStep([uv(0, 0)]),
            queuedStep([uv(10, 0), undefined]),
        );

        expect(editor.solver.entities()).toEqual([
            {
                id: 1,
                type: "nurbs",
                params: [0, 0, 10, 0, 1, 1],
                nurbs: { degree: 1, knots: [0, 0, 1, 1] },
            },
        ]);
        expect(editor.commit).toHaveBeenCalledTimes(1);
        editor.solver.dispose();
    });

    test("a one-pole polygon commits nothing, and the tool stays armed", async () => {
        const editor = fakeEditor();
        const startStep = queuedStep([uv(5, 5)]);
        await runChain(new SketchNurbsCommand(), editor, startStep, queuedStep([undefined]));

        expect(editor.solver.entities()).toEqual([]);
        expect(editor.solve).not.toHaveBeenCalled();
        expect(editor.commit).not.toHaveBeenCalled();
        // Escape ended the polygon, not the tool: the first-point step ran again
        // (and found the queue exhausted, which ends the run)
        expect(startStep.execute).toHaveBeenCalledTimes(2);
        editor.solver.dispose();
    });

    test("a cancelled start pick exits without picking a next pole", async () => {
        const editor = fakeEditor();
        const nextStep = queuedStep([uv(1, 1)]);
        await runChain(new SketchNurbsCommand(), editor, queuedStep([undefined]), nextStep);

        expect(nextStep.execute).not.toHaveBeenCalled();
        expect(editor.solver.entities()).toEqual([]);
        expect(editor.commit).not.toHaveBeenCalled();
        editor.solver.dispose();
    });

    test("a finished polygon leaves the tool armed for the next nurbs", async () => {
        const editor = fakeEditor();
        await runChain(
            new SketchNurbsCommand(),
            editor,
            queuedStep([uv(0, 0), uv(20, 20)]),
            queuedStep([uv(10, 0), undefined, uv(30, 20), undefined]),
        );

        expect(editor.solver.entities()).toEqual([
            {
                id: 1,
                type: "nurbs",
                params: [0, 0, 10, 0, 1, 1],
                nurbs: { degree: 1, knots: [0, 0, 1, 1] },
            },
            {
                id: 2,
                type: "nurbs",
                params: [20, 20, 30, 20, 1, 1],
                nurbs: { degree: 1, knots: [0, 0, 1, 1] },
            },
        ]);
        expect(editor.commit).toHaveBeenCalledTimes(2);
        editor.solver.dispose();
    });

    test("the command's cancel ends the tool instead of re-arming it", async () => {
        const editor = fakeEditor();
        const command = new SketchNurbsCommand();
        // what CancelableCommand.cancel() (the panel's ✗) sets before cancelling the pick
        (command as any)._isCanceled = true;
        const startStep = queuedStep([uv(0, 0)]);
        await runChain(command, editor, startStep, queuedStep([uv(10, 0), undefined]));

        expect(startStep.execute).toHaveBeenCalledTimes(1);
        // the panel's ✗ abandons the polygon, where Escape (or Enter) would have committed it
        expect(editor.solver.entities()).toEqual([]);
        expect(editor.commit).not.toHaveBeenCalled();
        editor.solver.dispose();
    });

    test("picking the first point again closes the polygon onto it", async () => {
        const editor = fakeEditor();
        await runChain(
            new SketchNurbsCommand(),
            editor,
            queuedStep([uv(3, 3)]),
            // the last pick lands back on the first control point, which closes the curve
            queuedStep([uv(10, 3), uv(5, 8), uv(3, 3)]),
        );

        expect(editor.solver.entities()).toEqual([
            {
                id: 1,
                type: "nurbs",
                params: [3, 3, 10, 3, 5, 8, 3, 3, 1, 1, 1, 1],
                nurbs: { degree: 3, knots: [0, 0, 0, 0, 1, 1, 1, 1] },
            },
        ]);
        // the closing pick was written to the first control point's place, and the two are
        // tied together — that, and not the numbers, is what makes the curve closed
        expect(
            editor.solver.hasConstraint(ConstraintKind.P2PCoincident, [
                { entityId: 1, pointIndex: 3 },
                { entityId: 1, pointIndex: 0 },
            ]),
        ).toBe(true);
        expect(editor.commit).toHaveBeenCalledTimes(1);
        editor.solver.dispose();
    });

    test("construction mode commits the nurbs as construction geometry", async () => {
        const editor = fakeEditor();
        const command = new SketchNurbsCommand();
        command.construction = true;
        await runChain(command, editor, queuedStep([uv(0, 0)]), queuedStep([uv(10, 0), uv(5, 8), undefined]));

        expect(editor.solver.entities()).toEqual([
            {
                id: 1,
                type: "nurbs",
                params: [0, 0, 10, 0, 5, 8, 1, 1, 1],
                nurbs: { degree: 2, knots: [0, 0, 0, 1, 1, 1] },
                construction: true,
            },
        ]);
        expect(editor.solver.isConstruction(1)).toBe(true);
        editor.solver.dispose();
    });
});

describe("SketchBezierCommand", () => {
    test("is registered under the key the ribbon's draw group names", () => {
        const data = CommandStore.getComandData("sketch.bezier");

        expect(data).toBeDefined();
        expect(data!.icon).toBe("icon-bezier");
    });

    test("two control points draw one segment: the line between them, as the cubic it is", async () => {
        const editor = fakeEditor();
        await runChain(new SketchBezierCommand(), editor, queuedStep([uv(0, 0)]), queuedStep([uv(6, 0)]));

        expect(editor.solver.entities()).toEqual([
            { id: 1, type: "bezier", params: [0, 0, 2, 0, 4, 0, 6, 0] },
        ]);
        expect(editor.commit).toHaveBeenCalledTimes(1);
        editor.solver.dispose();
    });

    test("a third control point bends it into a quadratic, drawn as its cubic", async () => {
        const editor = fakeEditor();
        await runChain(
            new SketchBezierCommand(),
            editor,
            queuedStep([uv(0, 0)]),
            queuedStep([uv(6, 0), uv(6, 6)]),
        );

        // the same segment, refit: the spline over three control points is a quadratic, and
        // the entity is a fixed cubic, so its raised form is what is committed
        expect(editor.solver.entities().map((entity) => entity.params)).toEqual([[0, 0, 4, 0, 6, 2, 6, 6]]);
        editor.solver.dispose();
    });

    test("four control points are the cubic they describe", async () => {
        const editor = fakeEditor();
        await runChain(
            new SketchBezierCommand(),
            editor,
            queuedStep([uv(0, 0)]),
            queuedStep([uv(6, 0), uv(6, 6), uv(0, 6)]),
        );

        expect(editor.solver.entities().map((entity) => entity.params)).toEqual([[0, 0, 6, 0, 6, 6, 0, 6]]);
        editor.solver.dispose();
    });

    test("the fifth control point adds a second segment, tangent at the joint", async () => {
        const editor = fakeEditor();
        await runChain(
            new SketchBezierCommand(),
            editor,
            queuedStep([uv(0, 0)]),
            queuedStep([uv(6, 0), uv(6, 6), uv(0, 6), uv(0, 12)]),
        );

        const entities = editor.solver.entities();
        expect(entities.map((entity) => entity.params)).toEqual([
            [0, 0, 6, 0, 6, 3, 4.5, 4.5],
            [4.5, 4.5, 3, 6, 0, 6, 0, 12],
        ]);
        // the joint is one point, and the handles either side of it are that point's mirror
        // images — which is what makes the two segments meet smoothly
        const [first, second] = entities.map((entity) => entity.params);
        const joint: [number, number] = [first[6], first[7]];
        expect([second[0], second[1]]).toEqual(joint);
        expect(first[4] + second[2]).toBeCloseTo(joint[0] * 2, 9);
        expect(first[5] + second[3]).toBeCloseTo(joint[1] * 2, 9);
        // both relations are stated on the handles: the joint they share, and the two
        // handles at it held collinear with it — the tangency, in the user's own terms
        expect(editor.solver.toData().constraints).toEqual([
            {
                id: 1,
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: 1, pointIndex: 3 },
                    { entityId: 2, pointIndex: 0 },
                ],
            },
            {
                id: 2,
                kind: ConstraintKind.Parallel,
                refs: [
                    { entityId: 1, pointIndex: 2 },
                    { entityId: 1, pointIndex: 3 },
                    { entityId: 2, pointIndex: 0 },
                    { entityId: 2, pointIndex: 1 },
                ],
            },
        ]);
        editor.solver.dispose();
    });

    test("a point added later refits the chain — the spline follows its control points", async () => {
        const editor = fakeEditor();
        await runChain(
            new SketchBezierCommand(),
            editor,
            queuedStep([uv(0, 0)]),
            queuedStep([uv(6, 0), uv(6, 6), uv(0, 6)]),
        );
        expect(editor.solver.entity(1)!.params).toEqual([0, 0, 6, 0, 6, 6, 0, 6]);
        editor.solver.dispose();

        const grown = fakeEditor();
        await runChain(
            new SketchBezierCommand(),
            grown,
            queuedStep([uv(0, 0)]),
            queuedStep([uv(6, 0), uv(6, 6), uv(0, 6), uv(0, 12)]),
        );
        // the fifth control point bends the segment that was already there: its own control
        // points are the ones the spline draws, not the ones the user clicked
        expect(grown.solver.entity(1)!.params).toEqual([0, 0, 6, 0, 6, 3, 4.5, 4.5]);
        grown.solver.dispose();
    });

    test("picking the first control point again closes the loop and ends the chain", async () => {
        const editor = fakeEditor();
        await runChain(
            new SketchBezierCommand(),
            editor,
            queuedStep([uv(0, 0), uv(20, 20)]),
            queuedStep([uv(6, 0), uv(6, 6), uv(0, 6), uv(0, 12), uv(0, 0), uv(26, 20), uv(32, 20)]),
        );

        // the closing control point is the chain's first one: the curve's far end lands on
        // its own start, and the tool ties the two ends
        const entities = editor.solver.entities();
        expect(entities.length).toBe(4);
        expect(entities[2].params.slice(6, 8)).toEqual(entities[0].params.slice(0, 2));
        expect(editor.solver.toData().constraints).toContainEqual({
            id: 5,
            kind: ConstraintKind.P2PCoincident,
            refs: [
                { entityId: 3, pointIndex: 3 },
                { entityId: 1, pointIndex: 0 },
            ],
        });
        // and the tool re-armed: the picks after the closing one are a chain of their own
        expect(entities[3].params.slice(0, 2)).toEqual([20, 20]);
        editor.solver.dispose();
    });

    test("a handle is a point like any other: a dimension on it holds", async () => {
        const editor = fakeEditor();
        await runChain(
            new SketchBezierCommand(),
            editor,
            queuedStep([uv(0, 0)]),
            queuedStep([uv(6, 0), uv(6, 6), uv(0, 6), uv(0, 12)]),
        );

        // the joint's own relations are already stated on the handles; this is the user
        // adding one of their own — the handle nearest the joint, held at a distance from it
        const solved = new SketchSolver(Plane.XY, editor.solver.toData());
        const handle = { entityId: 2, pointIndex: 1 };
        const joint = { entityId: 2, pointIndex: 0 };
        solved.addConstraint({
            kind: ConstraintKind.P2PDistance,
            refs: [joint, handle],
            datum: 1,
        });
        expect(solved.solve(true).result).not.toBe("Conflicting");

        const [jointAt, handleAt] = [solved.pointOf(joint), solved.pointOf(handle)];
        expect(Math.hypot(handleAt[0] - jointAt[0], handleAt[1] - jointAt[1])).toBeCloseTo(1, 6);
        solved.dispose();
        editor.solver.dispose();
    });

    test("the line between two handles takes a constraint like a line", async () => {
        const editor = fakeEditor();
        await runChain(
            new SketchBezierCommand(),
            editor,
            queuedStep([uv(0, 0)]),
            queuedStep([uv(6, 0), uv(6, 6), uv(0, 6), uv(0, 12)]),
        );

        // the second segment's first handle and the joint it hangs off: that line *is* the
        // tangent the spline leaves the joint along, so holding it level holds the tangent
        const solved = new SketchSolver(Plane.XY, editor.solver.toData());
        const handle = { entityId: 2, pointIndex: 1 };
        const joint = { entityId: 2, pointIndex: 0 };
        solved.addConstraint({ kind: ConstraintKind.Horizontal, refs: [joint, handle] });
        expect(solved.solve(true).result).not.toBe("Conflicting");

        const [atHandle, atJoint] = [solved.pointOf(handle), solved.pointOf(joint)];
        expect(atHandle[1]).toBeCloseTo(atJoint[1], 6);
        solved.dispose();
        editor.solver.dispose();
    });

    test("the nurbs probe is an entity the hints can read: params in the entity's layout", () => {
        const command = new SketchNurbsCommand();
        (command as any).poles = [
            [0, 0],
            [10, 0],
        ];
        const tentative = tentativeOf(command, [[10, 0]], 1, [5, 8]);

        // control points *and* their weights: the drawing hints evaluate this as the cursor
        // moves, and a bare point list reads as a fraction of a pole (a crash, once)
        expect(tentative?.params).toEqual([0, 0, 10, 0, 5, 8, 1, 1, 1]);
        expect(tentative === undefined ? 0 : sampleEntity(tentative, 8).length).toBe(9);
    });

    test("a chain with one control point commits nothing", async () => {
        const editor = fakeEditor();
        await runChain(new SketchBezierCommand(), editor, queuedStep([uv(1, 1)]), queuedStep([]));

        expect(editor.solver.entities()).toEqual([]);
        expect(editor.commit).not.toHaveBeenCalled();
        editor.solver.dispose();
    });

    test("construction mode commits the segments as construction geometry", async () => {
        const editor = fakeEditor();
        const command = new SketchBezierCommand();
        command.construction = true;
        await runChain(command, editor, queuedStep([uv(0, 0)]), queuedStep([uv(6, 0)]));

        expect(editor.solver.entities()).toEqual([
            { id: 1, type: "bezier", params: [0, 0, 2, 0, 4, 0, 6, 0], construction: true },
        ]);
        expect(editor.solver.isConstruction(1)).toBe(true);
        editor.solver.dispose();
    });

    test("a real solve leaves the chain where it was drawn", async () => {
        const editor = fakeEditor();
        await runChain(
            new SketchBezierCommand(),
            editor,
            queuedStep([uv(0, 0)]),
            queuedStep([uv(6, 0), uv(6, 6), uv(0, 6), uv(0, 12)]),
        );

        // the drawing the tool leaves, put through the real solver: the relations it stated
        // have to hold where the geometry already is, or the curve would jump on the commit
        const drawn = editor.solver.toData();
        const solved = new SketchSolver(Plane.XY, drawn);
        expect(solved.solve(true).result).not.toBe("Conflicting");
        const after = solved.entities().map((entity) => entity.params);
        drawn.entities.forEach((entity, index) => {
            entity.params.forEach((value, slot) => {
                expect(after[index][slot]).toBeCloseTo(value, 9);
            });
        });
        solved.dispose();
        editor.solver.dispose();
    });
});
