// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { CommandStore, type I18nKeys, type ICommand, Plane, PubSub } from "@chili3d/core";
import { rs } from "@rstest/core";
import { SketchBreakCommand } from "../../src/sketch/commands/sketchBreak";
import { SketchEditor, type SketchEntityPick } from "../../src/sketch/editor/sketchEditor";
import { ConstraintKind } from "../../src/sketch/sketchModel";
import { SketchSolver } from "../../src/sketch/solver";
import { centerRef } from "../../src/sketch/solverEntities";
import "./setup";

function fakeEditor() {
    const solver = new SketchSolver(Plane.XY);
    /** One entry per pick; running out of them answers like a cancelled pick. */
    const queue: (SketchEntityPick | undefined)[] = [];
    /** The prompt each pick was started with, in order. */
    const prompts: I18nKeys[] = [];
    const fake = {
        node: { plane: Plane.XY },
        solver,
        solve: rs.fn((_fine: boolean) => {}),
        commit: rs.fn(() => {}),
        screenTolerance: () => 1e-6,
        forgetConstraints: rs.fn((_ids: Iterable<number>) => {}),
        pickEntityAt: rs.fn((prompt: I18nKeys) => {
            prompts.push(prompt);
            return Promise.resolve(queue.shift());
        }),
        queue,
        prompts,
    };
    return fake;
}

type FakeEditor = ReturnType<typeof fakeEditor>;

async function runCommand(command: ICommand, editor: FakeEditor): Promise<void> {
    const getActive = rs.spyOn(SketchEditor, "getActive").mockReturnValue(editor as any);
    try {
        await command.execute({ activeView: { document: {} } } as any);
    } finally {
        getActive.mockRestore();
    }
}

/** An entity's params rounded, for comparing geometry. */
function params(editor: FakeEditor, id: number): number[] {
    return editor.solver.entity(id)!.params.map((value) => Math.round(value * 1e6) / 1e6);
}

describe("SketchBreakCommand", () => {
    test("registers the key the sketch ribbon points at", () => {
        const data = CommandStore.getComandData("sketch.break");
        expect(data?.key).toBe("sketch.break");
        expect(data?.icon).toBe("icon-break");
    });

    test("carves a line in two on one click and commits it", async () => {
        const editor = fakeEditor();
        try {
            const line = editor.solver.addLine(0, 0, 10, 0);
            editor.queue.push({ entityId: line, uv: [4, 0] });

            await runCommand(new SketchBreakCommand(), editor);

            expect(params(editor, line)).toEqual([0, 0, 4, 0]);
            expect(editor.solver.entities()).toHaveLength(2);
            expect(editor.commit).toHaveBeenCalledTimes(1);
            expect(editor.solve).toHaveBeenCalledWith(true);
        } finally {
            editor.solver.dispose();
        }
    });

    test("asks a closed curve for a second point before it cuts", async () => {
        const editor = fakeEditor();
        try {
            const circle = editor.solver.addCircle(0, 0, 5);
            editor.queue.push({ entityId: circle, uv: [5, 0] }, { entityId: circle, uv: [0, 5] });

            await runCommand(new SketchBreakCommand(), editor);

            expect(editor.prompts).toEqual([
                "prompt.pickBreakEntity",
                "prompt.pickBreakSecondPoint",
                "prompt.pickBreakEntity",
            ]);
            expect(editor.solver.entity(circle)!.type).toBe("arc");
            expect(editor.solver.entities()).toHaveLength(2);
            expect(editor.commit).toHaveBeenCalledTimes(1);
        } finally {
            editor.solver.dispose();
        }
    });

    test("keeps carving until the pick is cancelled", async () => {
        const editor = fakeEditor();
        try {
            const first = editor.solver.addLine(0, 0, 10, 0);
            const second = editor.solver.addLine(0, 5, 10, 5);
            editor.queue.push({ entityId: first, uv: [4, 0] }, { entityId: second, uv: [6, 5] });

            await runCommand(new SketchBreakCommand(), editor);

            expect(editor.solver.entities()).toHaveLength(4);
            expect(editor.commit).toHaveBeenCalledTimes(2);
        } finally {
            editor.solver.dispose();
        }
    });

    test("stops when the second point of a closed curve is cancelled", async () => {
        const editor = fakeEditor();
        try {
            const circle = editor.solver.addCircle(0, 0, 5);
            editor.queue.push({ entityId: circle, uv: [5, 0] });

            await runCommand(new SketchBreakCommand(), editor);

            expect(editor.solver.entity(circle)!.type).toBe("circle");
            expect(editor.commit).not.toHaveBeenCalled();
        } finally {
            editor.solver.dispose();
        }
    });

    test("reports a refused break and carries on", async () => {
        const editor = fakeEditor();
        try {
            const line = editor.solver.addLine(0, 0, 10, 0);
            const other = editor.solver.addLine(0, 5, 10, 5);
            // the first click lands on the line's own end, which bounds no cut
            editor.queue.push({ entityId: line, uv: [0, 0] }, { entityId: other, uv: [6, 5] });

            const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
            try {
                await runCommand(new SketchBreakCommand(), editor);

                expect(pub).toHaveBeenCalledWith(
                    "displayError",
                    "Pick a point along the entity, not one of its ends",
                );
                expect(editor.solver.entities()).toHaveLength(3);
                expect(editor.commit).toHaveBeenCalledTimes(1);
            } finally {
                pub.mockRestore();
            }
        } finally {
            editor.solver.dispose();
        }
    });

    test("forgets the anchors of the constraints a circle cannot carry as an arc", async () => {
        const editor = fakeEditor();
        try {
            const circle = editor.solver.addCircle(0, 0, 5);
            const other = editor.solver.addCircle(20, 0, 5);
            const equal = editor.solver.addConstraint({
                kind: ConstraintKind.EqualRadius,
                refs: [centerRef(circle), centerRef(other)],
            });
            editor.queue.push({ entityId: circle, uv: [5, 0] }, { entityId: circle, uv: [0, 5] });

            const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
            try {
                await runCommand(new SketchBreakCommand(), editor);

                expect(editor.forgetConstraints).toHaveBeenCalledWith([equal]);
                expect(pub).toHaveBeenCalledWith("statusBarTip", "sketch.breakRemovedConstraints{0}", 1);
                expect(editor.commit).toHaveBeenCalledTimes(1);
            } finally {
                pub.mockRestore();
            }
        } finally {
            editor.solver.dispose();
        }
    });
});
