// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { CancelableCommand, CommandStore, type I18nKeys, type ICommand, Plane, PubSub } from "@chili3d/core";
import { rs } from "@rstest/core";
import { SketchExtendCommand } from "../../src/sketch/commands/sketchExtend";
import { SketchEditor, type SketchEntityPick } from "../../src/sketch/editor/sketchEditor";
import { ConstraintKind } from "../../src/sketch/sketchModel";
import { SketchSolver } from "../../src/sketch/solver";
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

/**
 * Drops the option value a previous run of this file left in the static cache: a command
 * reads its options *from that cache* over the instance it was configured on
 * (`CancelableCommand.beforeExecute`), so a test that sets one has to clear it first or
 * the earlier value wins.
 */
function forgetCachedOption(name: string): void {
    (CancelableCommand as any)._propertiesCache.delete(name);
}

async function runCommand(command: ICommand, editor: FakeEditor): Promise<void> {
    const getActive = rs.spyOn(SketchEditor, "getActive").mockReturnValue(editor as any);
    try {
        await command.execute({ activeView: { document: {} } } as any);
    } finally {
        getActive.mockRestore();
    }
}

/** A horizontal line to prolong and a vertical boundary at x = 20 — corner at (20, 0). */
function scene(editor: FakeEditor): { target: number; boundary: number } {
    return {
        target: editor.solver.addLine(0, 0, 10, 0),
        boundary: editor.solver.addLine(20, -10, 20, 10),
    };
}

/** The two picks that aim at the target's far end and at the boundary's middle. */
function picks(target: number, boundary: number, boundaryUv: [number, number] = [20, 0]) {
    return [
        { entityId: target, uv: [9, 0] as [number, number] },
        { entityId: boundary, uv: boundaryUv },
    ];
}

describe("SketchExtendCommand", () => {
    test("registers the key the sketch ribbon points at", () => {
        const data = CommandStore.getComandData("sketch.extend");
        expect(data?.key).toBe("sketch.extend");
        expect(data?.icon).toBe("icon-extend");
    });

    test("prolongs the picked entity and commits it", async () => {
        const editor = fakeEditor();
        try {
            const { target, boundary } = scene(editor);
            editor.queue.push(...picks(target, boundary));

            await runCommand(new SketchExtendCommand(), editor);

            expect(editor.solver.entity(target)!.params.map(Math.round)).toEqual([0, 0, 20, 0]);
            expect(editor.commit).toHaveBeenCalledTimes(1);
            expect(editor.solve).toHaveBeenCalledWith(true);
        } finally {
            editor.solver.dispose();
        }
    });

    test("asks for the target first and the boundary second", async () => {
        const editor = fakeEditor();
        try {
            const { target, boundary } = scene(editor);
            editor.queue.push(...picks(target, boundary));

            await runCommand(new SketchExtendCommand(), editor);

            // the run ends on the third pick, which the queue answers with a cancel
            expect(editor.prompts).toEqual([
                "prompt.pickExtendTarget",
                "prompt.pickExtendBoundary",
                "prompt.pickExtendTarget",
            ]);
        } finally {
            editor.solver.dispose();
        }
    });

    test("brings the boundary along only when the option asks for it", async () => {
        const movedBoundary = async (modifyBoundary: boolean) => {
            const editor = fakeEditor();
            try {
                const { target, boundary } = scene(editor);
                const command = new SketchExtendCommand();
                forgetCachedOption("modifyBoundary");
                command.modifyBoundary = modifyBoundary;
                editor.queue.push(...picks(target, boundary, [20, -8]));

                await runCommand(command, editor);

                return editor.solver.entity(boundary)!.params.map(Math.round);
            } finally {
                editor.solver.dispose();
            }
        };

        expect(await movedBoundary(true)).toEqual([20, 0, 20, 10]);
        expect(await movedBoundary(false)).toEqual([20, -10, 20, 10]);
    });

    test("keeps picking pairs until the pick is cancelled", async () => {
        const editor = fakeEditor();
        try {
            const { target, boundary } = scene(editor);
            const second = editor.solver.addLine(0, 5, 4, 5);
            editor.queue.push(
                ...picks(target, boundary),
                { entityId: second, uv: [3.5, 5] },
                { entityId: boundary, uv: [20, 5] },
            );

            await runCommand(new SketchExtendCommand(), editor);

            expect(editor.solver.entity(target)!.params.map(Math.round)).toEqual([0, 0, 20, 0]);
            expect(editor.solver.entity(second)!.params.map(Math.round)).toEqual([0, 5, 20, 5]);
            expect(editor.commit).toHaveBeenCalledTimes(2);
        } finally {
            editor.solver.dispose();
        }
    });

    test("stops after the target when the boundary pick is cancelled", async () => {
        const editor = fakeEditor();
        try {
            const { target, boundary } = scene(editor);
            editor.queue.push(picks(target, boundary)[0]);

            await runCommand(new SketchExtendCommand(), editor);

            expect(editor.solver.entity(target)!.params.map(Math.round)).toEqual([0, 0, 10, 0]);
            expect(editor.commit).not.toHaveBeenCalled();
        } finally {
            editor.solver.dispose();
        }
    });

    test("reports a refused extend and carries on", async () => {
        const editor = fakeEditor();
        try {
            const { boundary } = scene(editor);
            // a target parallel to the boundary: the two supports never meet
            const parallel = editor.solver.addLine(0, 5, 0, 15);
            editor.queue.push({ entityId: parallel, uv: [0, 14] }, { entityId: boundary, uv: [20, 0] });

            const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
            try {
                await runCommand(new SketchExtendCommand(), editor);

                expect(pub).toHaveBeenCalledWith(
                    "displayError",
                    "The two entities do not meet when extended",
                );
                expect(editor.commit).not.toHaveBeenCalled();
            } finally {
                pub.mockRestore();
            }
        } finally {
            editor.solver.dispose();
        }
    });

    test("forgets the anchors of the constraints the extend dropped and reports the count", async () => {
        const editor = fakeEditor();
        try {
            const { target, boundary } = scene(editor);
            const neighbour = editor.solver.addLine(10, 0, 10, -5);
            const joint = editor.solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [
                    { entityId: target, pointIndex: 1 },
                    { entityId: neighbour, pointIndex: 0 },
                ],
            });
            editor.queue.push(...picks(target, boundary));

            const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
            try {
                await runCommand(new SketchExtendCommand(), editor);

                expect(editor.forgetConstraints).toHaveBeenCalledWith([joint]);
                expect(pub).toHaveBeenCalledWith("statusBarTip", "sketch.extendRemovedConstraints{0}", 1);
                expect(editor.commit).toHaveBeenCalledTimes(1);
            } finally {
                pub.mockRestore();
            }
        } finally {
            editor.solver.dispose();
        }
    });
});
