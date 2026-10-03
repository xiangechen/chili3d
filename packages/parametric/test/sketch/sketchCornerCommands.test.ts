// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { CancelableCommand, type I18nKeys, type ICommand, Plane, PubSub } from "@chili3d/core";
import { rs } from "@rstest/core";
import { SketchChamferCommand, SketchFilletCommand } from "../../src/sketch/commands/sketchCornerCommands";
import { SketchEditor, type SketchEntityTypeFilter } from "../../src/sketch/editor/sketchEditor";
import { ConstraintKind, type DimensionAnchor, type SketchPointRef } from "../../src/sketch/sketchModel";
import { SketchSolver } from "../../src/sketch/solver";
import "./setup";

function fakeEditor() {
    const solver = new SketchSolver(Plane.XY);
    /** One entry per pick: a number for a click, an array for a rubber-band box. */
    const entityQueue: (number | number[])[] = [];
    const selection = new Set<number>();
    let picks = 0;
    const fake = {
        node: { plane: Plane.XY },
        solver,
        solve: rs.fn((_fine: boolean) => {}),
        commit: rs.fn(() => {}),
        screenTolerance: () => 0,
        /** Hook that runs after each pick, for standing in for the option panel mid-command. */
        onPick: undefined as ((count: number) => void) | undefined,
        pickEntities: rs.fn((_prompt: I18nKeys, _type?: SketchEntityTypeFilter) => {
            const next = entityQueue.shift();
            fake.onPick?.(++picks);
            return Promise.resolve(next === undefined ? undefined : Array.isArray(next) ? next : [next]);
        }),
        selectedEntityIds: () => [...selection],
        clearEntitySelection: () => selection.clear(),
        dimensionAnchors: new Map<number, DimensionAnchor>(),
        entityQueue,
        selection,
    };
    return fake;
}

type FakeEditor = ReturnType<typeof fakeEditor>;

/** A corner command plus the option the app would have handed it. */
interface CommandSpec {
    command: ICommand;
    option: { name: string; value: number };
}

/**
 * The app supplies command options through the static property cache that
 * `beforeExecute` reads back, so a value assigned on the instance would be
 * overwritten by whatever the last run saved. Prime the cache instead, then
 * restore isolation.
 */
async function runCommand(spec: CommandSpec, editor: FakeEditor): Promise<void> {
    const cache: Map<string, any> = (CancelableCommand as any)._propertiesCache;
    const had = cache.has(spec.option.name);
    const previous = cache.get(spec.option.name);
    const getActive = rs.spyOn(SketchEditor, "getActive").mockReturnValue(editor as any);
    try {
        cache.set(spec.option.name, spec.option.value);
        await spec.command.execute({ activeView: { document: {} } } as any);
    } finally {
        getActive.mockRestore();
        if (had) cache.set(spec.option.name, previous);
        else cache.delete(spec.option.name);
    }
}

const ref = (entityId: number, pointIndex: number): SketchPointRef => ({ entityId, pointIndex });

/** Two lines meeting at the origin, joined by a coincidence. */
function corner(editor: FakeEditor): [number, number] {
    const l1 = editor.solver.addLine(0, 0, 10, 0);
    const l2 = editor.solver.addLine(0, 0, 0, 10);
    editor.solver.addConstraint({
        kind: ConstraintKind.P2PCoincident,
        refs: [ref(l1, 0), ref(l2, 0)],
    });
    return [l1, l2];
}

function arcsOf(editor: FakeEditor) {
    return editor.solver.entities().filter((e) => e.type === "arc");
}

function kindsOf(editor: FakeEditor, kind: ConstraintKind): number {
    return editor.solver.toData().constraints.filter((c) => c.kind === kind).length;
}

function fillet(radius: number) {
    const command = new SketchFilletCommand();
    command.radius = radius;
    return { command, option: { name: "radius", value: radius } };
}

function chamfer(length: number) {
    const command = new SketchChamferCommand();
    command.length = length;
    return { command, option: { name: "length", value: length } };
}

describe("SketchFilletCommand", () => {
    test("rounds a selected corner in a single commit and drops the selection", async () => {
        const editor = fakeEditor();
        try {
            const [l1, l2] = corner(editor);
            editor.selection.add(l1);
            editor.selection.add(l2);

            await runCommand(fillet(2), editor);

            expect(arcsOf(editor).length).toBe(1);
            expect(arcsOf(editor)[0].params[0]).toBeCloseTo(2, 6);
            expect(editor.commit).toHaveBeenCalledTimes(1);
            expect(editor.solve).toHaveBeenCalledTimes(1);
            // the command consumed the selection the highlight was still claiming
            expect(editor.selectedEntityIds()).toEqual([]);

            // the radius label is anchored away from the material: this corner's centre
            // sits at (2,2) and the sketch occupies the first quadrant, so the leader
            // has to leave along −x−y to reach the outside
            const radiusConstraint = editor.solver
                .toData()
                .constraints.find((c) => c.kind === ConstraintKind.Radius)!;
            const anchor = editor.dimensionAnchors.get(radiusConstraint.id);
            expect(anchor?.kind).toBe("vector");
            const vector = anchor as Extract<DimensionAnchor, { kind: "vector" }>;
            expect(vector.dx).toBeCloseTo(-Math.SQRT2, 6);
            expect(vector.dy).toBeCloseTo(-Math.SQRT2, 6);
        } finally {
            editor.solver.dispose();
        }
    });

    test("picks two lines when nothing is selected", async () => {
        const editor = fakeEditor();
        try {
            const [l1, l2] = corner(editor);
            editor.entityQueue.push(l1, l2);

            await runCommand(fillet(1), editor);

            expect(arcsOf(editor).length).toBe(1);
            expect(editor.commit).toHaveBeenCalledTimes(1);
        } finally {
            editor.solver.dispose();
        }
    });

    // A lone selected line is half of the pair the command wants, so it seeds the pick
    // loop: one more pick finishes the corner. Dropping it would make the user pick the
    // same line again.
    test("keeps a single selected line as the first half of the pair", async () => {
        const editor = fakeEditor();
        try {
            const [l1, l2] = corner(editor);
            editor.selection.add(l1);
            editor.entityQueue.push(l2);

            await runCommand(fillet(1), editor);

            expect(arcsOf(editor).length).toBe(1);
            expect(editor.commit).toHaveBeenCalledTimes(1);
        } finally {
            editor.solver.dispose();
        }
    });

    // The panel writes the option straight onto the command instance while it is still
    // open, so a value resolved once up front goes stale the moment the user edits it
    // between picks — the arc came out at the radius the command had started with.
    test("takes an option edited mid-command, not the one it started with", async () => {
        const editor = fakeEditor();
        try {
            const [l1, l2] = corner(editor);
            const spec = fillet(1);
            editor.entityQueue.push(l1, l2);
            editor.onPick = (count) => {
                if (count === 1) spec.command.radius = 5;
            };

            await runCommand(spec, editor);

            const arc = arcsOf(editor)[0];
            const radius = Math.hypot(arc.params[2] - arc.params[0], arc.params[3] - arc.params[1]);
            expect(radius).toBeCloseTo(5, 6);
        } finally {
            editor.solver.dispose();
        }
    });

    test("a box during the pick converts every corner it caught in one commit", async () => {
        const editor = fakeEditor();
        try {
            const [l1, l2] = corner(editor);
            // the box answers the whole set at once, as `pickEntities` does
            editor.entityQueue.push([l1, l2]);

            await runCommand(fillet(1), editor);

            expect(arcsOf(editor).length).toBe(1);
            expect(editor.commit).toHaveBeenCalledTimes(1);
        } finally {
            editor.solver.dispose();
        }
    });

    test("a box that caught a single line still waits for a partner", async () => {
        const editor = fakeEditor();
        try {
            const [l1, l2] = corner(editor);
            editor.entityQueue.push([l1], l2);

            await runCommand(fillet(1), editor);

            expect(arcsOf(editor).length).toBe(1);
            expect(editor.commit).toHaveBeenCalledTimes(1);
        } finally {
            editor.solver.dispose();
        }
    });

    test("a box that caught nothing is ignored, not treated as a pick", async () => {
        const editor = fakeEditor();
        try {
            const [l1, l2] = corner(editor);
            editor.entityQueue.push([]);
            editor.entityQueue.push([l1, l2]);

            await runCommand(fillet(1), editor);

            expect(arcsOf(editor).length).toBe(1);
            expect(editor.commit).toHaveBeenCalledTimes(1);
        } finally {
            editor.solver.dispose();
        }
    });

    test("rounds every corner of a selected rectangle in one commit", async () => {
        const editor = fakeEditor();
        try {
            const bottom = editor.solver.addLine(0, 0, 10, 0);
            const right = editor.solver.addLine(10, 0, 10, 10);
            const top = editor.solver.addLine(10, 10, 0, 10);
            const left = editor.solver.addLine(0, 10, 0, 0);
            for (const [a, ai, b, bi] of [
                [bottom, 1, right, 0],
                [right, 1, top, 0],
                [top, 1, left, 0],
                [left, 1, bottom, 0],
            ] as const) {
                editor.solver.addConstraint({
                    kind: ConstraintKind.P2PCoincident,
                    refs: [ref(a, ai), ref(b, bi)],
                });
            }
            for (const id of [bottom, right, top, left]) editor.selection.add(id);

            await runCommand(fillet(1), editor);

            expect(arcsOf(editor).length).toBe(4);
            expect(editor.commit).toHaveBeenCalledTimes(1);
        } finally {
            editor.solver.dispose();
        }
    });

    test("reports a radius that does not fit and changes nothing", async () => {
        const editor = fakeEditor();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            const [l1, l2] = corner(editor);
            editor.selection.add(l1);
            editor.selection.add(l2);
            const before = JSON.stringify(editor.solver.toData());

            await runCommand(fillet(20), editor);

            expect(pub).toHaveBeenCalledWith("displayError", expect.any(String));
            expect(JSON.stringify(editor.solver.toData())).toBe(before);
            expect(editor.commit).not.toHaveBeenCalled();
        } finally {
            pub.mockRestore();
            editor.solver.dispose();
        }
    });

    test("reports two picked lines that share no endpoint", async () => {
        const editor = fakeEditor();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            const l1 = editor.solver.addLine(0, 0, 10, 0);
            const l2 = editor.solver.addLine(0, 5, 10, 5);
            editor.entityQueue.push(l1, l2);

            await runCommand(fillet(1), editor);

            expect(pub).toHaveBeenCalledWith("displayError", expect.any(String));
            expect(arcsOf(editor).length).toBe(0);
            expect(editor.commit).not.toHaveBeenCalled();
        } finally {
            pub.mockRestore();
            editor.solver.dispose();
        }
    });

    test("an aborted pick leaves the sketch alone", async () => {
        const editor = fakeEditor();
        try {
            corner(editor);
            // empty queue: the first pick resolves undefined

            await runCommand(fillet(1), editor);

            expect(arcsOf(editor).length).toBe(0);
            expect(editor.commit).not.toHaveBeenCalled();
        } finally {
            editor.solver.dispose();
        }
    });
});

describe("SketchChamferCommand", () => {
    test("cuts a selected corner and pins the trimmed lengths", async () => {
        const editor = fakeEditor();
        try {
            const [l1, l2] = corner(editor);
            editor.selection.add(l1);
            editor.selection.add(l2);

            await runCommand(chamfer(3), editor);

            const lines = editor.solver.entities().filter((e) => e.type === "line");
            expect(lines.length).toBe(3);
            // the two trimmed lengths plus the cut's own span
            expect(kindsOf(editor, ConstraintKind.P2PDistance)).toBe(3);
            expect(editor.commit).toHaveBeenCalledTimes(1);
        } finally {
            editor.solver.dispose();
        }
    });
});
