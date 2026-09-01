// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Plane, PubSub, XYZ } from "@chili3d/core";
import { rs } from "@rstest/core";
import { SketchArcCommand } from "../../src/sketch/commands/sketchArc";
import { SketchRectangleCommand } from "../../src/sketch/commands/sketchRectangle";
import { SketchEditor } from "../../src/sketch/editor/sketchEditor";
import { ConstraintKind } from "../../src/sketch/sketchModel";
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
