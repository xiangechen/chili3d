// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type I18nKeys,
    type ICommand,
    type ParameterValue,
    Plane,
    PubSub,
    type UnitSpec,
} from "@chili3d/core";
import { rs } from "@rstest/core";
import { liveInstanceIds } from "../../src/sketch/arrayOps";
import {
    CoincidentConstraintCommand,
    FixConstraintCommand,
    HorizontalAlignConstraintCommand,
    HorizontalConstraintCommand,
    MidpointConstraintCommand,
    ParallelConstraintCommand,
    PointOnConstraintCommand,
    SymmetricConstraintCommand,
    VerticalAlignConstraintCommand,
    VerticalConstraintCommand,
} from "../../src/sketch/commands/sketchConstraints";
import {
    AngleDimensionCommand,
    DistanceDimensionCommand,
    HorizontalDistanceCommand,
    PointLineDistanceCommand,
    RadiusDimensionCommand,
    VerticalDistanceCommand,
} from "../../src/sketch/commands/sketchDimensions";
import type { DimensionAnchor } from "../../src/sketch/editor/dimensionLayout";
import { SketchEditor, type SketchEntityTypeFilter } from "../../src/sketch/editor/sketchEditor";
import {
    axisLineRefs,
    ConstraintKind,
    type ExternalRefData,
    isDimensionKind,
    SKETCH_X_AXIS_ID,
    type SketchPointRef,
    syncExternalRoles,
} from "../../src/sketch/sketchModel";
import { SketchSolver } from "../../src/sketch/solver";
import {
    allowsConstraintOnEntity,
    allowsConstraintOnRefs,
    constraintTargetEntities,
    isAssociativeConstraintKind,
    measuresOnlyExternalGeometry,
} from "../../src/sketch/solverEntities";
import "./setup";

const EXT_LINE: ExternalRefData = {
    entityId: -100,
    nodeId: "src",
    edge: { kind: "line", start: { x: 0, y: 0, z: 0 }, end: { x: 10, y: 0, z: 0 } },
    role: "reference",
    snapshot: [0, 0, 10, 0],
    type: "line",
};

const EXT_CIRCLE: ExternalRefData = {
    entityId: -101,
    nodeId: "src",
    edge: { kind: "circle", center: { x: 30, y: 0, z: 0 }, radius: 5, axis: { x: 0, y: 0, z: 1 } },
    role: "reference",
    snapshot: [30, 0, 5],
    type: "circle",
};

function fakeEditor() {
    const solver = new SketchSolver(Plane.XY);
    const pointQueue: SketchPointRef[] = [];
    const entityQueue: number[] = [];
    const positionQueue: [number, number][] = [];
    /**
     * What the value dialog is answered with: `typed` stands in for what the user types,
     * and left `undefined` the dialog is answered with the reading it opened on — the
     * "just place it" path. Whether it is reached at all is what a *reference* dimension
     * is told by (`promptDatum` not called).
     */
    const dialog = { typed: undefined as ParameterValue | undefined };
    return {
        node: { plane: Plane.XY },
        solver,
        annotations: { setDimensionPreview: rs.fn(() => {}) },
        dimensionAnchors: new Map<number, DimensionAnchor>(),
        // the solver's own verdict, read by `autoReference` when a dimension lands
        diagnostics: { redundant: [] as number[] },
        solve: rs.fn((_fine: boolean) => {}),
        commit: rs.fn(() => {}),
        // the editor's own datum write, which the dialog's apply callback goes through
        writeDatum: rs.fn((constraintId: number, value: ParameterValue, index = 0) => {
            solver.setDatumSource(constraintId, value, index);
        }),
        promptDatum: rs.fn(
            (
                initial: ParameterValue,
                apply: (value: ParameterValue) => void,
                _unit: UnitSpec,
                _onCancel?: () => void,
                _options?: { positiveOnly?: boolean },
            ) => {
                apply(dialog.typed ?? initial);
                return Promise.resolve();
            },
        ),
        pickPoint: rs.fn((_prompt: I18nKeys) => Promise.resolve(pointQueue.shift())),
        pickEntity: rs.fn((_prompt: I18nKeys, _type?: SketchEntityTypeFilter) =>
            Promise.resolve(entityQueue.shift()),
        ),
        pickEntityAt: rs.fn((_prompt: I18nKeys, _type?: SketchEntityTypeFilter) => {
            const entityId = entityQueue.shift();
            return Promise.resolve(entityId === undefined ? undefined : { entityId, uv: [0, 0] });
        }),
        pickPosition: rs.fn((_prompt: I18nKeys) => Promise.resolve(positionQueue.shift())),
        pointQueue,
        entityQueue,
        positionQueue,
        dialog,
    };
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

/** Seeds both projected references into a fake editor's solver. */
function seedExternals(editor: FakeEditor): void {
    editor.solver.addExternalEntity({ ...EXT_LINE });
    editor.solver.addExternalEntity({ ...EXT_CIRCLE });
}

const REJECTION_TIP: [string, string] = ["statusBarTip", "sketch.externalRefFrozen"];

/** Runs `command` expecting an external pick to be rejected with the tip and no side effects. */
async function expectRejection(command: ICommand, editor: FakeEditor, kind: ConstraintKind): Promise<void> {
    const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
    try {
        await runCommand(command, editor);

        expect(pub).toHaveBeenCalledWith(...REJECTION_TIP);
        expect(editor.solver.toData().constraints.filter((c) => c.kind === kind)).toEqual([]);
        expect(editor.solve).not.toHaveBeenCalled();
        expect(editor.commit).not.toHaveBeenCalled();
    } finally {
        pub.mockRestore();
    }
}

describe("constraintTargetEntities", () => {
    test("enumerates the real entities followed by the seeded external references", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            solver.addLine(0, 0, 10, 0);
            solver.addCircle(20, 0, 5);
            solver.addExternalEntity({ ...EXT_LINE });

            const targets = constraintTargetEntities(solver);

            expect(targets.map((x) => x.id)).toEqual([1, 2, -100]);
            expect(targets.map((x) => x.type)).toEqual(["line", "circle", "line"]);
            expect(targets[2].params).toEqual([0, 0, 10, 0]);
            // a fresh array: appending to it does not disturb the solver's own lists
            targets.push({ id: 999, type: "line", params: [0, 0, 1, 1] });
            expect(solver.entities().length).toBe(2);
        } finally {
            solver.dispose();
        }
    });
});

describe("isAssociativeConstraintKind", () => {
    test.each([
        ConstraintKind.P2PCoincident,
        ConstraintKind.PointOnLine,
        ConstraintKind.PointOnCircle,
        ConstraintKind.PointOnArc,
        ConstraintKind.Parallel,
        ConstraintKind.Perpendicular,
        ConstraintKind.EqualLength,
        ConstraintKind.EqualRadius,
        ConstraintKind.EqualArcRadius,
        ConstraintKind.TangentLineCircle,
        ConstraintKind.TangentCircleCircle,
        ConstraintKind.TangentLineArc,
        ConstraintKind.TangentArcArc,
        ConstraintKind.TangentCircleArc,
    ])("associative kind %s is allowed", (kind) => {
        expect(isAssociativeConstraintKind(kind)).toBe(true);
    });

    test.each([
        ConstraintKind.Horizontal,
        ConstraintKind.Vertical,
        ConstraintKind.HorizontalAlign,
        ConstraintKind.VerticalAlign,
        ConstraintKind.Midpoint,
        ConstraintKind.Symmetric,
        ConstraintKind.Fix,
        ConstraintKind.P2PDistance,
        ConstraintKind.P2LDistance,
        ConstraintKind.HorizontalDistance,
        ConstraintKind.VerticalDistance,
        ConstraintKind.Angle,
        ConstraintKind.Radius,
    ])("non-associative kind %s is rejected", (kind) => {
        expect(isAssociativeConstraintKind(kind)).toBe(false);
    });
});

describe("allowsConstraintOnEntity", () => {
    test("pubs the tip only when an external entity meets a non-associative kind", () => {
        const solver = new SketchSolver(Plane.XY);
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            // real entities accept any kind
            expect(allowsConstraintOnEntity(solver, ConstraintKind.Horizontal, 3)).toBe(true);
            // datum entities (axes/origin) are not external and stay untouched
            expect(allowsConstraintOnEntity(solver, ConstraintKind.Angle, SKETCH_X_AXIS_ID)).toBe(true);
            expect(pub).not.toHaveBeenCalled();

            expect(allowsConstraintOnEntity(solver, ConstraintKind.Horizontal, -100)).toBe(false);
            expect(pub).toHaveBeenCalledWith(...REJECTION_TIP);
            pub.mockClear();

            // associative kinds still target external entities
            expect(allowsConstraintOnEntity(solver, ConstraintKind.Parallel, -100)).toBe(true);
            expect(allowsConstraintOnEntity(solver, ConstraintKind.PointOnLine, -100)).toBe(true);
            expect(pub).not.toHaveBeenCalled();
        } finally {
            pub.mockRestore();
        }
    });

    test("refuses every kind on an array's instance, associative ones included", () => {
        const solver = new SketchSolver(Plane.XY);
        const lineId = solver.addLine(0, 0, 10, 0);
        solver.addArray({ type: "linear", x: { count: 2, spacing: 10 }, y: { count: 1, spacing: 0 } }, [
            lineId,
        ]);
        const instanceId = liveInstanceIds(solver.arrays()[0])[0];
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            for (const kind of [ConstraintKind.Horizontal, ConstraintKind.Parallel, ConstraintKind.Fix]) {
                expect(allowsConstraintOnEntity(solver, kind, instanceId)).toBe(false);
            }
            expect(pub).toHaveBeenCalledWith("statusBarTip", "sketch.arrayInstanceReadOnly");
        } finally {
            pub.mockRestore();
        }
    });
});

describe("rigid constraints still need a side the sketch may move", () => {
    // single-target commands: a projected line leaves the constraint nothing to turn
    test.each([
        {
            name: "horizontal",
            command: () => new HorizontalConstraintCommand(),
            kind: ConstraintKind.Horizontal,
        },
        { name: "vertical", command: () => new VerticalConstraintCommand(), kind: ConstraintKind.Vertical },
    ])("$name on an external line pubs the tip and adds nothing", async ({ command, kind }) => {
        const editor = fakeEditor();
        try {
            editor.solver.addExternalEntity({ ...EXT_LINE });
            editor.entityQueue.push(EXT_LINE.entityId);

            await expectRejection(command(), editor, kind);
        } finally {
            editor.solver.dispose();
        }
    });

    test("fix on an external point pubs the tip and adds nothing", async () => {
        const editor = fakeEditor();
        try {
            editor.solver.addExternalEntity({ ...EXT_LINE });
            editor.pointQueue.push(ref(EXT_LINE.entityId, 0));

            await expectRejection(new FixConstraintCommand(), editor, ConstraintKind.Fix);
        } finally {
            editor.solver.dispose();
        }
    });

    // pair commands: refused only once *both* sides turn out to be projected
    test.each([
        {
            name: "horizontalAlign",
            command: () => new HorizontalAlignConstraintCommand(),
            kind: ConstraintKind.HorizontalAlign,
        },
        {
            name: "verticalAlign",
            command: () => new VerticalAlignConstraintCommand(),
            kind: ConstraintKind.VerticalAlign,
        },
    ])("$name between two external points pubs the tip and adds nothing", async ({ command, kind }) => {
        const editor = fakeEditor();
        try {
            seedExternals(editor);
            editor.pointQueue.push(ref(EXT_LINE.entityId, 0), ref(EXT_CIRCLE.entityId, 0));

            await expectRejection(command(), editor, kind);
        } finally {
            editor.solver.dispose();
        }
    });

    test("midpoint of an external line for an external point pubs the tip and adds nothing", async () => {
        const editor = fakeEditor();
        try {
            seedExternals(editor);
            editor.pointQueue.push(ref(EXT_CIRCLE.entityId, 0));
            editor.entityQueue.push(EXT_LINE.entityId);

            await expectRejection(new MidpointConstraintCommand(), editor, ConstraintKind.Midpoint);
        } finally {
            editor.solver.dispose();
        }
    });

    test("symmetric about an external line, both points external, pubs the tip", async () => {
        const editor = fakeEditor();
        try {
            seedExternals(editor);
            editor.pointQueue.push(ref(EXT_LINE.entityId, 0), ref(EXT_CIRCLE.entityId, 0));
            editor.entityQueue.push(EXT_LINE.entityId);

            await expectRejection(new SymmetricConstraintCommand(), editor, ConstraintKind.Symmetric);
        } finally {
            editor.solver.dispose();
        }
    });
});

describe("a projected edge is the fixed side the sketch moves against", () => {
    test("horizontalAlign levels a real point with a projected endpoint", async () => {
        const editor = fakeEditor();
        try {
            seedExternals(editor);
            const line = editor.solver.addLine(5, 5, 15, 5);
            editor.pointQueue.push(ref(line, 0), ref(EXT_LINE.entityId, 1));
            editor.dialog.typed = undefined;

            await runCommand(new HorizontalAlignConstraintCommand(), editor);

            const found = editor.solver
                .toData()
                .constraints.filter((c) => c.kind === ConstraintKind.HorizontalAlign);
            expect(found.length).toBe(1);
            expect(found[0].refs).toEqual([ref(line, 0), ref(EXT_LINE.entityId, 1)]);
            // the fake editor's solve is a no-op mock — solve for real
            editor.solver.solve(true);
            // the external endpoint is at v = 0, and it is the point that cannot move
            expect(editor.solver.pointOf(ref(line, 0))[1]).toBeCloseTo(0, 6);
        } finally {
            editor.solver.dispose();
        }
    });

    test("midpoint holds a real point at the middle of a projected edge", async () => {
        const editor = fakeEditor();
        try {
            seedExternals(editor);
            const line = editor.solver.addLine(5, 5, 15, 5);
            editor.pointQueue.push(ref(line, 0));
            editor.entityQueue.push(EXT_LINE.entityId);

            await runCommand(new MidpointConstraintCommand(), editor);

            const found = editor.solver
                .toData()
                .constraints.filter((c) => c.kind === ConstraintKind.Midpoint);
            expect(found.length).toBe(1);
            editor.solver.solve(true);
            // the projected edge runs (0,0)→(10,0); its middle is where the point lands
            const [u, v] = editor.solver.pointOf(ref(line, 0));
            expect(u).toBeCloseTo(5, 6);
            expect(v).toBeCloseTo(0, 6);
        } finally {
            editor.solver.dispose();
        }
    });

    test("symmetric about a projected edge reflects a real point across it", async () => {
        const editor = fakeEditor();
        try {
            seedExternals(editor);
            // there is no point entity, so the two points come off lines of their own
            const a = editor.solver.addLine(2, -3, 2.5, -3);
            const b = editor.solver.addLine(3, 3, 3.5, 3);
            editor.pointQueue.push(ref(a, 0), ref(b, 0));
            editor.entityQueue.push(EXT_LINE.entityId);

            await runCommand(new SymmetricConstraintCommand(), editor);

            const found = editor.solver
                .toData()
                .constraints.filter((c) => c.kind === ConstraintKind.Symmetric);
            expect(found.length).toBe(1);
            editor.solver.solve(true);
            // the axis is v = 0, so the two ordinates have to cancel
            const [u1, v1] = editor.solver.pointOf(ref(a, 0));
            const [u2, v2] = editor.solver.pointOf(ref(b, 0));
            expect(u1).toBeCloseTo(u2, 6);
            expect(v1 + v2).toBeCloseTo(0, 6);
        } finally {
            editor.solver.dispose();
        }
    });
});

describe("dimensions onto projected geometry", () => {
    test("a distance to a projected endpoint drives the real point", async () => {
        const editor = fakeEditor();
        try {
            seedExternals(editor);
            const line = editor.solver.addLine(5, 5, 15, 5);
            editor.pointQueue.push(ref(line, 0), ref(EXT_LINE.entityId, 0));
            editor.positionQueue.push([2, 2]);
            editor.dialog.typed = 3;

            await runCommand(new DistanceDimensionCommand(), editor);

            const found = editor.solver
                .toData()
                .constraints.filter((c) => c.kind === ConstraintKind.P2PDistance);
            expect(found.length).toBe(1);
            // at least one side is the user's own geometry, so it drives rather than measures
            expect(found[0].driven).toBeUndefined();
            expect(editor.dialog.typed).toBe(3);
            expect(editor.promptDatum).toHaveBeenCalledTimes(1);
            editor.solver.solve(true);
            const [u, v] = editor.solver.pointOf(ref(line, 0));
            const [eu, ev] = editor.solver.pointOf(ref(EXT_LINE.entityId, 0));
            expect(Math.hypot(u - eu, v - ev)).toBeCloseTo(3, 4);
        } finally {
            editor.solver.dispose();
        }
    });

    test("a point-line distance to a projected edge drives the sketch point", async () => {
        const editor = fakeEditor();
        try {
            seedExternals(editor);
            const line = editor.solver.addLine(5, 5, 15, 5);
            editor.pointQueue.push(ref(line, 0));
            editor.entityQueue.push(EXT_LINE.entityId);
            editor.positionQueue.push([2, 2]);
            editor.dialog.typed = 4;

            await runCommand(new PointLineDistanceCommand(), editor);

            const found = editor.solver
                .toData()
                .constraints.filter((c) => c.kind === ConstraintKind.P2LDistance);
            expect(found.length).toBe(1);
            expect(found[0].driven).toBeUndefined();
            editor.solver.solve(true);
            // the projected edge is the line v = 0, and the point has to sit 4 off it
            expect(Math.abs(editor.solver.pointOf(ref(line, 0))[1])).toBeCloseTo(4, 4);
        } finally {
            editor.solver.dispose();
        }
    });

    test("an axis distance to a projected endpoint drives the real point", async () => {
        const editor = fakeEditor();
        try {
            seedExternals(editor);
            const line = editor.solver.addLine(5, 5, 15, 5);
            editor.pointQueue.push(ref(line, 0), ref(EXT_LINE.entityId, 1));
            editor.positionQueue.push([2, 2]);
            editor.dialog.typed = 25;

            await runCommand(new HorizontalDistanceCommand(), editor);

            const found = editor.solver
                .toData()
                .constraints.filter((c) => c.kind === ConstraintKind.HorizontalDistance);
            expect(found.length).toBe(1);
            expect(found[0].driven).toBeUndefined();
            editor.solver.solve(true);
            // garlic reads the datum as second − first, and the endpoint is at u = 10
            expect(editor.solver.pointOf(ref(line, 0))[0]).toBeCloseTo(-15, 4);
        } finally {
            editor.solver.dispose();
        }
    });

    test("an angle to a projected edge drives the sketch line", async () => {
        const editor = fakeEditor();
        try {
            seedExternals(editor);
            const line = editor.solver.addLine(0, 5, 10, 8);
            editor.entityQueue.push(line, EXT_LINE.entityId);
            editor.positionQueue.push([4, 4]);
            editor.dialog.typed = 0;

            await runCommand(new AngleDimensionCommand(), editor);

            const found = editor.solver.toData().constraints.filter((c) => c.kind === ConstraintKind.Angle);
            expect(found.length).toBe(1);
            expect(found[0].driven).toBeUndefined();
            editor.solver.solve(true);
            const [u1, v1] = editor.solver.pointOf(ref(line, 0));
            const [u2, v2] = editor.solver.pointOf(ref(line, 1));
            // the edge lies along u, so a line at 0° to it has no rise left
            expect(v2 - v1).toBeCloseTo(0, 4);
        } finally {
            editor.solver.dispose();
        }
    });

    test("a projected circle's radius is placed as a reference, with no dialog", async () => {
        const editor = fakeEditor();
        try {
            seedExternals(editor);
            editor.entityQueue.push(EXT_CIRCLE.entityId);
            editor.positionQueue.push([6, 0]);

            await runCommand(new RadiusDimensionCommand(), editor);

            const found = editor.solver.toData().constraints.filter((c) => c.kind === ConstraintKind.Radius);
            expect(found.length).toBe(1);
            // nothing in it can move, so it measures the frozen geometry instead of driving
            expect(found[0].driven).toBe(true);
            expect(found[0].datum).toBeCloseTo(EXT_CIRCLE.snapshot[2], 6);
            expect(editor.promptDatum).not.toHaveBeenCalled();
            expect(editor.commit).toHaveBeenCalledTimes(1);
        } finally {
            editor.solver.dispose();
        }
    });

    test("a distance between two projected points is placed as a reference", async () => {
        const editor = fakeEditor();
        try {
            seedExternals(editor);
            editor.pointQueue.push(ref(EXT_LINE.entityId, 0), ref(EXT_CIRCLE.entityId, 0));
            editor.positionQueue.push([15, 0]);

            await runCommand(new DistanceDimensionCommand(), editor);

            const found = editor.solver
                .toData()
                .constraints.filter((c) => c.kind === ConstraintKind.P2PDistance);
            expect(found.length).toBe(1);
            expect(found[0].driven).toBe(true);
            expect(editor.promptDatum).not.toHaveBeenCalled();
        } finally {
            editor.solver.dispose();
        }
    });

    test("a driving dimension onto a projected edge follows the edge when the source moves", async () => {
        const editor = fakeEditor();
        try {
            seedExternals(editor);
            const line = editor.solver.addLine(5, 5, 15, 5);
            editor.pointQueue.push(ref(line, 0), ref(EXT_LINE.entityId, 0));
            editor.positionQueue.push([2, 2]);
            editor.dialog.typed = 3;

            await runCommand(new DistanceDimensionCommand(), editor);

            // the source part is rebuilt and its edge re-resolves somewhere else — the
            // same path a rebuild takes, the node re-resolving behind the solver's back
            editor.solver.syncExternalRefs([{ ...EXT_LINE, snapshot: [2, 1, 12, 1] }]);
            editor.solver.solve(true);

            const [eu, ev] = editor.solver.pointOf(ref(EXT_LINE.entityId, 0));
            const [u, v] = editor.solver.pointOf(ref(line, 0));
            expect([eu, ev]).toEqual([2, 1]);
            // the reading is what holds; which end of it moved is the solver's business
            expect(Math.hypot(u - eu, v - ev)).toBeCloseTo(3, 4);
        } finally {
            editor.solver.dispose();
        }
    });
});

describe("measuresOnlyExternalGeometry", () => {
    test.each([
        { name: "one external ref", refs: [ref(-100, 0), ref(-100, 1)], expected: true },
        { name: "two of them", refs: [ref(-100, 0), ref(-101, 0)], expected: true },
        { name: "one real ref among them", refs: [ref(-100, 0), ref(4, 0)], expected: false },
        { name: "a datum axis", refs: [ref(SKETCH_X_AXIS_ID, 0), ref(-100, 0)], expected: false },
        { name: "no refs at all", refs: [], expected: false },
    ])("$name reads as external-only: $expected", ({ refs, expected }) => {
        expect(measuresOnlyExternalGeometry(refs)).toBe(expected);
    });
});

describe("isDimensionKind", () => {
    test.each([
        ConstraintKind.P2PDistance,
        ConstraintKind.Radius,
        ConstraintKind.P2LDistance,
        ConstraintKind.Angle,
        ConstraintKind.HorizontalDistance,
        ConstraintKind.VerticalDistance,
        ConstraintKind.ConicRho,
    ])("%s is a dimension", (kind) => {
        expect(isDimensionKind(kind)).toBe(true);
    });

    test.each([
        ConstraintKind.Fix,
        ConstraintKind.Horizontal,
        ConstraintKind.Parallel,
        ConstraintKind.P2PCoincident,
        ConstraintKind.Midpoint,
        ConstraintKind.Symmetric,
    ])("%s is not a dimension", (kind) => {
        expect(isDimensionKind(kind)).toBe(false);
    });
});

describe("syncExternalRoles", () => {
    const refWith = (role: ExternalRefData["role"]): ExternalRefData => ({ ...EXT_LINE, role });

    test("an asserted constraint promotes the ref it names to profile", () => {
        const data = {
            externalRefs: [refWith("reference")],
            constraints: [
                {
                    id: 1,
                    kind: ConstraintKind.Parallel,
                    refs: [ref(1, 0), ref(1, 1), ref(EXT_LINE.entityId, 0), ref(EXT_LINE.entityId, 1)],
                },
            ],
        };

        expect(syncExternalRoles(data)).toBe(true);
        expect(data.externalRefs[0].role).toBe("profile");
    });

    test("a reference dimension does not: reading an edge must not put it in the profile", () => {
        const data = {
            externalRefs: [refWith("reference")],
            constraints: [
                {
                    id: 1,
                    kind: ConstraintKind.Radius,
                    refs: [ref(EXT_CIRCLE.entityId, 0)],
                    datum: 5,
                    driven: true,
                },
            ],
        };

        expect(syncExternalRoles(data)).toBe(false);
        expect(data.externalRefs[0].role).toBe("reference");
    });

    test("a driving dimension still promotes, as every other constraint does", () => {
        const data = {
            externalRefs: [refWith("reference")],
            constraints: [
                {
                    id: 1,
                    kind: ConstraintKind.P2PDistance,
                    refs: [ref(7, 0), ref(EXT_LINE.entityId, 0)],
                    datum: 12,
                },
            ],
        };

        expect(syncExternalRoles(data)).toBe(true);
        expect(data.externalRefs[0].role).toBe("profile");
    });
});

describe("associative constraints still target external references", () => {
    test("coincident links a real point to an external endpoint and the solve follows it", async () => {
        const editor = fakeEditor();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            editor.solver.addExternalEntity({ ...EXT_LINE });
            const line = editor.solver.addLine(5, 5, 15, 5);
            editor.pointQueue.push(ref(line, 0), ref(EXT_LINE.entityId, 0));

            await runCommand(new CoincidentConstraintCommand(), editor);

            const found = editor.solver
                .toData()
                .constraints.filter((c) => c.kind === ConstraintKind.P2PCoincident);
            expect(found.length).toBe(1);
            expect(found[0].refs).toEqual([ref(line, 0), ref(EXT_LINE.entityId, 0)]);
            expect(editor.commit).toHaveBeenCalledTimes(1);
            expect(pub).not.toHaveBeenCalledWith(...REJECTION_TIP);
            // the fake editor's solve is a no-op mock — solve for real
            editor.solver.solve(true);
            const [u, v] = editor.solver.pointOf(ref(line, 0));
            expect(u).toBeCloseTo(0, 6);
            expect(v).toBeCloseTo(0, 6);
        } finally {
            pub.mockRestore();
            editor.solver.dispose();
        }
    });

    test("pointOn constrains a real point onto an external line", async () => {
        const editor = fakeEditor();
        try {
            editor.solver.addExternalEntity({ ...EXT_LINE });
            const line = editor.solver.addLine(5, 5, 15, 5);
            editor.pointQueue.push(ref(line, 0));
            editor.entityQueue.push(EXT_LINE.entityId);

            await runCommand(new PointOnConstraintCommand(), editor);

            const found = editor.solver
                .toData()
                .constraints.filter((c) => c.kind === ConstraintKind.PointOnLine);
            expect(found.length).toBe(1);
            expect(found[0].refs).toEqual([
                ref(line, 0),
                ref(EXT_LINE.entityId, 0),
                ref(EXT_LINE.entityId, 1),
            ]);
            expect(editor.commit).toHaveBeenCalledTimes(1);
        } finally {
            editor.solver.dispose();
        }
    });

    test("parallel against an external line solves the real line parallel to it", async () => {
        const editor = fakeEditor();
        try {
            editor.solver.addExternalEntity({ ...EXT_LINE });
            const line = editor.solver.addLine(0, 5, 10, 8);
            editor.entityQueue.push(line, EXT_LINE.entityId);

            await runCommand(new ParallelConstraintCommand(), editor);

            const found = editor.solver
                .toData()
                .constraints.filter((c) => c.kind === ConstraintKind.Parallel);
            expect(found.length).toBe(1);
            expect(found[0].refs).toEqual([
                ref(line, 0),
                ref(line, 1),
                ref(EXT_LINE.entityId, 0),
                ref(EXT_LINE.entityId, 1),
            ]);
            // the fake editor's solve is a no-op mock — solve for real
            editor.solver.solve(true);
            const y1 = editor.solver.pointOf(ref(line, 0))[1];
            const y2 = editor.solver.pointOf(ref(line, 1))[1];
            expect(y2).toBeCloseTo(y1, 6);
        } finally {
            editor.solver.dispose();
        }
    });
});

describe("real entities are unaffected by the external guard", () => {
    test("horizontal on a real line still applies and commits", async () => {
        const editor = fakeEditor();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            const line = editor.solver.addLine(0, 0, 10, 1);
            editor.entityQueue.push(line);

            await runCommand(new HorizontalConstraintCommand(), editor);

            const found = editor.solver
                .toData()
                .constraints.filter((c) => c.kind === ConstraintKind.Horizontal);
            expect(found.length).toBe(1);
            expect(found[0].refs).toEqual([ref(line, 0), ref(line, 1)]);
            expect(editor.solve).toHaveBeenCalledWith(true);
            expect(editor.commit).toHaveBeenCalledTimes(1);
            expect(pub).not.toHaveBeenCalledWith(...REJECTION_TIP);
        } finally {
            pub.mockRestore();
            editor.solver.dispose();
        }
    });
});
