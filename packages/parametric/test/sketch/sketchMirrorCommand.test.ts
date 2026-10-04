// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { CommandStore, type I18nKeys, type ICommand, Plane, PubSub } from "@chili3d/core";
import { rs } from "@rstest/core";
import { SketchMirrorCommand } from "../../src/sketch/commands/sketchMirror";
import { SketchEditor, type SketchEntityPreview } from "../../src/sketch/editor/sketchEditor";
import { SKETCH_X_AXIS_ID, type SketchEntityData } from "../../src/sketch/sketchModel";
import { SketchSolver } from "../../src/sketch/solver";
import "./setup";

interface PickOptions {
    datum?: boolean;
    previewEntity?: SketchEntityPreview;
}

function fakeEditor() {
    const solver = new SketchSolver(Plane.XY);
    /** One entry per entity-set pick; running out answers like a cancelled pick. */
    const sets: (number[] | undefined)[] = [];
    /** One entry per axis pick. */
    const axes: (number | undefined)[] = [];
    const selected: number[] = [];
    /**
     * What each pick's preview answered, taken while the pick was still open — asking
     * afterwards would be asking about a sketch the command has since changed.
     */
    const previews: (SketchEntityData[] | undefined)[] = [];
    /** The same for the line pick, which is handed the datum X axis as its hovered ref. */
    const axisPreviews: (SketchEntityData[] | undefined)[] = [];
    const fake = {
        node: { plane: Plane.XY },
        solver,
        solve: rs.fn((_fine: boolean) => {}),
        commit: rs.fn(() => {}),
        screenTolerance: () => 1e-6,
        selectedEntityIds: () => [...selected],
        clearEntitySelection: rs.fn(() => {}),
        pickEntities: rs.fn((_prompt: I18nKeys, _type?: unknown, options?: PickOptions) => {
            const picked = sets.shift();
            if (picked !== undefined && picked.length > 0) {
                previews.push(options?.previewEntity?.(picked[0]));
            }
            return Promise.resolve(picked);
        }),
        pickEntity: rs.fn((_prompt: I18nKeys, _type?: unknown, options?: PickOptions) => {
            axisPreviews.push(options?.previewEntity?.(SKETCH_X_AXIS_ID));
            return Promise.resolve(axes.shift());
        }),
        sets,
        axes,
        selected,
        previews,
        axisPreviews,
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

/** A line to mirror and the X datum axis standing in as the mirror line. */
function mirrorPair(editor: FakeEditor): [number, number] {
    const source = editor.solver.addLine(1, 2, 4, 3);
    editor.axes.push(SKETCH_X_AXIS_ID);
    return [source, SKETCH_X_AXIS_ID];
}

describe("SketchMirrorCommand", () => {
    test("registers the key the sketch ribbon points at", () => {
        const data = CommandStore.getComandData("sketch.mirror");
        expect(data?.key).toBe("sketch.mirror");
        expect(data?.icon).toBe("icon-mirror");
    });

    test("mirrors the pre-existing selection across the picked line in one commit", async () => {
        const editor = fakeEditor();
        try {
            const [source] = mirrorPair(editor);
            editor.selected.push(source);

            await runCommand(new SketchMirrorCommand(), editor);

            expect(editor.solver.toData().entities).toHaveLength(2);
            const copy = editor.solver.toData().entities[1];
            expect(copy.params.map(Math.round)).toEqual([1, -2, 4, -3]);
            expect(editor.commit).toHaveBeenCalledTimes(1);
            expect(editor.solve).toHaveBeenCalledWith(true);
            // the highlight would keep claiming a selection the command consumed
            expect(editor.clearEntitySelection).toHaveBeenCalledTimes(1);
            // the axis pick previewed the copy, and offered the datum axes as candidates
            expect(editor.pickEntity.mock.calls[0][2]?.datum).toBe(true);
            expect(editor.axisPreviews[0]?.map((e) => e.params.map(Math.round))).toEqual([[1, -2, 4, -3]]);
        } finally {
            editor.solver.dispose();
        }
    });

    test("with nothing selected, picks the line first and then mirrors each pick until ESC", async () => {
        const editor = fakeEditor();
        try {
            const first = editor.solver.addLine(1, 2, 4, 3);
            const second = editor.solver.addLine(5, 6, 7, 8);
            editor.axes.push(SKETCH_X_AXIS_ID);
            // one click, then one more, then ESC
            editor.sets.push([first], [second], undefined);

            await runCommand(new SketchMirrorCommand(), editor);

            const entities = editor.solver.toData().entities;
            expect(entities).toHaveLength(4);
            expect(entities[2].params.map(Math.round)).toEqual([1, -2, 4, -3]);
            expect(entities[3].params.map(Math.round)).toEqual([5, -6, 7, -8]);
            // each round is its own commit, so the mirror shows as it is picked
            expect(editor.commit).toHaveBeenCalledTimes(2);
            // and each pick previewed what the entity under the cursor would leave
            expect(editor.previews.map((p) => p?.map((e) => e.params.map(Math.round)))).toEqual([
                [[1, -2, 4, -3]],
                [[5, -6, 7, -8]],
            ]);
        } finally {
            editor.solver.dispose();
        }
    });

    test("a box pick in the picking loop mirrors its whole catch in one commit", async () => {
        const editor = fakeEditor();
        try {
            const first = editor.solver.addLine(1, 2, 4, 3);
            const second = editor.solver.addLine(5, 6, 7, 8);
            editor.axes.push(SKETCH_X_AXIS_ID);
            editor.sets.push([first, second]);

            await runCommand(new SketchMirrorCommand(), editor);

            expect(editor.solver.toData().entities).toHaveLength(4);
            expect(editor.commit).toHaveBeenCalledTimes(1);
        } finally {
            editor.solver.dispose();
        }
    });

    test("cancelling the first entity pick ends the loop with what it already mirrored", async () => {
        const editor = fakeEditor();
        try {
            const first = editor.solver.addLine(1, 2, 4, 3);
            editor.axes.push(SKETCH_X_AXIS_ID);
            editor.sets.push([first], undefined);

            await runCommand(new SketchMirrorCommand(), editor);

            expect(editor.solver.toData().entities).toHaveLength(2);
            expect(editor.commit).toHaveBeenCalledTimes(1);
        } finally {
            editor.solver.dispose();
        }
    });

    test("reports the sources it skipped rather than mirroring them onto themselves", async () => {
        const editor = fakeEditor();
        try {
            const along = editor.solver.addLine(-5, 0, 5, 0);
            const genuine = editor.solver.addLine(1, 2, 4, 3);
            editor.axes.push(SKETCH_X_AXIS_ID);
            editor.selected.push(along, genuine);

            const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
            try {
                await runCommand(new SketchMirrorCommand(), editor);

                expect(pub).toHaveBeenCalledWith("statusBarTip", "sketch.mirrorSkippedSelfMirror{0}", 1);
                expect(editor.solver.toData().entities).toHaveLength(3);
            } finally {
                pub.mockRestore();
            }
        } finally {
            editor.solver.dispose();
        }
    });

    test("cancelling the line pick leaves the sketch alone", async () => {
        const editor = fakeEditor();
        try {
            const [source] = mirrorPair(editor);
            editor.axes.length = 0;
            editor.selected.push(source);
            const before = JSON.stringify(editor.solver.toData());

            await runCommand(new SketchMirrorCommand(), editor);

            expect(JSON.stringify(editor.solver.toData())).toBe(before);
            expect(editor.commit).not.toHaveBeenCalled();
            expect(editor.clearEntitySelection).not.toHaveBeenCalled();
        } finally {
            editor.solver.dispose();
        }
    });

    test("refuses an external reference as the mirror line", async () => {
        const editor = fakeEditor();
        try {
            const source = editor.solver.addLine(1, 2, 4, 3);
            editor.selected.push(source);
            // an external ref id is ≤ -100; Symmetric cannot target one
            editor.axes.push(-100);

            const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
            try {
                await runCommand(new SketchMirrorCommand(), editor);

                expect(pub).toHaveBeenCalledWith("statusBarTip", "sketch.externalRefAssociativeOnly");
                expect(editor.commit).not.toHaveBeenCalled();
            } finally {
                pub.mockRestore();
            }
        } finally {
            editor.solver.dispose();
        }
    });
});
