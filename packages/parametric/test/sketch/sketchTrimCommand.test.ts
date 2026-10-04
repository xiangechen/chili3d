// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { CommandStore, type I18nKeys, type ICommand, Plane, PubSub } from "@chili3d/core";
import { rs } from "@rstest/core";
import { SketchTrimCommand } from "../../src/sketch/commands/sketchTrim";
import { SketchEditor, type SketchEntityPick } from "../../src/sketch/editor/sketchEditor";
import { ConstraintKind, type SketchPointRef } from "../../src/sketch/sketchModel";
import { SketchSolver } from "../../src/sketch/solver";
import "./setup";

function fakeEditor() {
    const solver = new SketchSolver(Plane.XY);
    /** One entry per pick; running out of them answers like a cancelled pick. */
    const queue: (SketchEntityPick | undefined)[] = [];
    const fake = {
        node: { plane: Plane.XY },
        solver,
        solve: rs.fn((_fine: boolean) => {}),
        commit: rs.fn(() => {}),
        screenTolerance: () => 1e-6,
        forgetConstraints: rs.fn((_ids: Iterable<number>) => {}),
        pickEntityAt: rs.fn((_prompt: I18nKeys) => Promise.resolve(queue.shift())),
        queue,
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

const ref = (entityId: number, pointIndex: number): SketchPointRef => ({ entityId, pointIndex });

/** A horizontal line crossed in the middle by a vertical one, plus both ids. */
function cross(editor: FakeEditor): [number, number] {
    const horizontal = editor.solver.addLine(0, 0, 10, 0);
    const vertical = editor.solver.addLine(5, -5, 5, 5);
    return [horizontal, vertical];
}

describe("SketchTrimCommand", () => {
    test("registers the key the sketch ribbon points at", () => {
        const data = CommandStore.getComandData("sketch.trim");
        expect(data?.key).toBe("sketch.trim");
        expect(data?.icon).toBe("icon-trim");
    });

    test("trims the picked piece and commits it", async () => {
        const editor = fakeEditor();
        try {
            const [horizontal] = cross(editor);
            editor.queue.push({ entityId: horizontal, uv: [8, 0] });

            await runCommand(new SketchTrimCommand(), editor);

            expect(editor.solver.entity(horizontal)!.params.map(Math.round)).toEqual([0, 0, 5, 0]);
            expect(editor.commit).toHaveBeenCalledTimes(1);
            expect(editor.solve).toHaveBeenCalledWith(true);
        } finally {
            editor.solver.dispose();
        }
    });

    test("keeps picking until the pick is cancelled", async () => {
        const editor = fakeEditor();
        try {
            const [horizontal, vertical] = cross(editor);
            const lower = editor.solver.addLine(0, -8, 10, -8);
            editor.queue.push(
                { entityId: horizontal, uv: [8, 0] },
                { entityId: lower, uv: [8, -8] },
                { entityId: vertical, uv: [5, 4] },
            );

            await runCommand(new SketchTrimCommand(), editor);

            expect(editor.solver.entity(horizontal)!.params.map(Math.round)).toEqual([0, 0, 5, 0]);
            expect(editor.commit).toHaveBeenCalledTimes(3);
        } finally {
            editor.solver.dispose();
        }
    });

    test("reports a refused trim and carries on", async () => {
        const editor = fakeEditor();
        try {
            const [horizontal] = cross(editor);
            // the click sits on the crossing itself, which bounds no single piece
            editor.queue.push({ entityId: horizontal, uv: [5, 0] });

            const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
            try {
                await runCommand(new SketchTrimCommand(), editor);

                expect(pub).toHaveBeenCalledWith("displayError", "Pick the piece to remove, not a crossing");
                expect(editor.commit).not.toHaveBeenCalled();
            } finally {
                pub.mockRestore();
            }
        } finally {
            editor.solver.dispose();
        }
    });

    test("forgets the anchors of the constraints the trim dropped and reports the count", async () => {
        const editor = fakeEditor();
        try {
            const [horizontal] = cross(editor);
            const length = editor.solver.addConstraint({
                kind: ConstraintKind.P2PDistance,
                refs: [ref(horizontal, 0), ref(horizontal, 1)],
                datum: 10,
            });
            editor.queue.push({ entityId: horizontal, uv: [8, 0] });

            const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
            try {
                await runCommand(new SketchTrimCommand(), editor);

                expect(editor.forgetConstraints).toHaveBeenCalledWith([length]);
                expect(pub).toHaveBeenCalledWith("statusBarTip", "sketch.trimRemovedConstraints{0}", 1);
                expect(editor.commit).toHaveBeenCalledTimes(1);
            } finally {
                pub.mockRestore();
            }
        } finally {
            editor.solver.dispose();
        }
    });
});
