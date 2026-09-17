// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Plane, PubSub, XYZ } from "@chili3d/core";
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
