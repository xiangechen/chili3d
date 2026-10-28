// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type I18nKeys, type ICommand, Plane, PubSub } from "@chili3d/core";
import { rs } from "@rstest/core";
import { liveInstanceIds } from "../../src/sketch/arrayOps";
import {
    CoincidentConstraintCommand,
    EqualConstraintCommand,
    FixConstraintCommand,
    HorizontalAlignConstraintCommand,
    HorizontalConstraintCommand,
    MidpointConstraintCommand,
    ParallelConstraintCommand,
    PerpendicularConstraintCommand,
    PointOnConstraintCommand,
    SymmetricConstraintCommand,
    TangentConstraintCommand,
    VerticalAlignConstraintCommand,
} from "../../src/sketch/commands/sketchConstraints";
import { SketchEditor, type SketchEntityTypeFilter } from "../../src/sketch/editor/sketchEditor";
import {
    axisLineRefs,
    ConstraintKind,
    type ExternalRefData,
    originRef,
    pointRefKey,
    SKETCH_X_AXIS_ID,
    SKETCH_Y_AXIS_ID,
    type SketchPointRef,
} from "../../src/sketch/sketchModel";
import { SketchSolver } from "../../src/sketch/solver";
import "./setup";

/** A projected edge running up the x = 20 line, pinned where the model put it. */
const PROJECTED_EDGE: ExternalRefData = {
    entityId: -100,
    nodeId: "src",
    edge: { kind: "line", start: { x: 20, y: -5, z: 0 }, end: { x: 20, y: 5, z: 0 } },
    role: "reference",
    snapshot: [20, -5, 20, 5],
    type: "line",
};

function fakeEditor() {
    const solver = new SketchSolver(Plane.XY);
    const pointQueue: SketchPointRef[] = [];
    const entityQueue: number[] = [];
    /** Which control points a queued entity pick landed between, when it names a segment. */
    const segmentQueue: [number, number][] = [];
    return {
        node: { plane: Plane.XY },
        solver,
        solve: rs.fn((_fine: boolean) => {}),
        commit: rs.fn(() => {}),
        // the session state of constraints an op dropped behind the editor's back
        forgetConstraints: rs.fn((_ids: Iterable<number>) => {}),
        pickPoint: rs.fn((_prompt: I18nKeys) => Promise.resolve(pointQueue.shift())),
        pickEntity: rs.fn((_prompt: I18nKeys, _type?: SketchEntityTypeFilter) =>
            Promise.resolve(entityQueue.shift()),
        ),
        // the segment-reading commands pick through `pickEntityAt`, which answers with where
        // the click was as well — a line pick answers without a net segment, and one queued
        // here says the click landed between that pair of an entity's control points
        pickEntityAt: rs.fn((_prompt: I18nKeys, _type?: SketchEntityTypeFilter) => {
            const entityId = entityQueue.shift();
            if (entityId === undefined) return Promise.resolve(undefined);
            const segment = segmentQueue.shift();
            return Promise.resolve({ entityId, uv: [0, 0], ...(segment === undefined ? {} : { segment }) });
        }),
        pointQueue,
        entityQueue,
        segmentQueue,
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

function constraintsOf(editor: FakeEditor, kind: ConstraintKind) {
    return editor.solver.toData().constraints.filter((c) => c.kind === kind);
}

const ref = (entityId: number, pointIndex: number): SketchPointRef => ({ entityId, pointIndex });

/** The three kinds the Equal tool can produce — all an Equal pick may add. */
const EQUAL_KINDS: readonly ConstraintKind[] = [
    ConstraintKind.EqualLength,
    ConstraintKind.EqualRadius,
    ConstraintKind.EqualArcRadius,
];

describe("Parallel/PerpendicularConstraintCommand", () => {
    test.each([
        { name: "parallel", command: () => new ParallelConstraintCommand(), kind: ConstraintKind.Parallel },
        {
            name: "perpendicular",
            command: () => new PerpendicularConstraintCommand(),
            kind: ConstraintKind.Perpendicular,
        },
    ])("$name constrains two picked lines and commits", async ({ command, kind }) => {
        const editor = fakeEditor();
        try {
            const l1 = editor.solver.addLine(0, 0, 10, 0);
            const l2 = editor.solver.addLine(0, 5, 10, 5);
            editor.entityQueue.push(l1, l2);

            await runCommand(command(), editor);

            const found = constraintsOf(editor, kind);
            expect(found.length).toBe(1);
            expect(found[0].refs).toEqual([ref(l1, 0), ref(l1, 1), ref(l2, 0), ref(l2, 1)]);
            expect(editor.solve).toHaveBeenCalledWith(true);
            expect(editor.commit).toHaveBeenCalledTimes(1);
        } finally {
            editor.solver.dispose();
        }
    });

    test("cancels without a constraint when the first pick is aborted", async () => {
        const editor = fakeEditor();
        try {
            editor.solver.addLine(0, 0, 10, 0);
            // empty queue: the first pick resolves undefined

            await runCommand(new ParallelConstraintCommand(), editor);

            expect(editor.solver.toData().constraints).toEqual([]);
            expect(editor.solve).not.toHaveBeenCalled();
            expect(editor.commit).not.toHaveBeenCalled();
        } finally {
            editor.solver.dispose();
        }
    });
});

describe("EqualConstraintCommand", () => {
    test("refuses an array's instance as one of the two entities", async () => {
        const editor = fakeEditor();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            const axis = editor.solver.addLine(-5, 0, 5, 0);
            editor.solver.addArray(
                { type: "linear", x: { count: 2, spacing: 20 }, y: { count: 1, spacing: 0 } },
                [axis],
            );
            const instanceId = liveInstanceIds(editor.solver.arrays()[0])[0];
            const other = editor.solver.addLine(0, 5, 10, 5);
            editor.entityQueue.push(instanceId, other);

            await runCommand(new EqualConstraintCommand(), editor);

            expect(pub).toHaveBeenCalledWith("showToast", "sketch.arrayInstanceReadOnly");
            expect(constraintsOf(editor, ConstraintKind.EqualLength)).toEqual([]);
            expect(editor.commit).not.toHaveBeenCalled();
        } finally {
            pub.mockRestore();
            editor.solver.dispose();
        }
    });

    test("two lines produce an EqualLength constraint", async () => {
        const editor = fakeEditor();
        try {
            const l1 = editor.solver.addLine(0, 0, 10, 0);
            const l2 = editor.solver.addLine(0, 5, 12, 5);
            editor.entityQueue.push(l1, l2);

            await runCommand(new EqualConstraintCommand(), editor);

            const found = constraintsOf(editor, ConstraintKind.EqualLength);
            expect(found.length).toBe(1);
            expect(found[0].refs).toEqual([ref(l1, 0), ref(l1, 1), ref(l2, 0), ref(l2, 1)]);
            expect(editor.commit).toHaveBeenCalledTimes(1);
        } finally {
            editor.solver.dispose();
        }
    });

    test("two circles produce an EqualRadius constraint on both centers", async () => {
        const editor = fakeEditor();
        try {
            const c1 = editor.solver.addCircle(0, 0, 5);
            const c2 = editor.solver.addCircle(20, 0, 8);
            editor.entityQueue.push(c1, c2);

            await runCommand(new EqualConstraintCommand(), editor);

            const found = constraintsOf(editor, ConstraintKind.EqualRadius);
            expect(found.length).toBe(1);
            expect(found[0].refs).toEqual([ref(c1, 0), ref(c2, 0)]);
        } finally {
            editor.solver.dispose();
        }
    });

    test("two arcs produce an EqualArcRadius constraint with center and start per arc", async () => {
        const editor = fakeEditor();
        try {
            const a1 = editor.solver.addArc(0, 0, 5, 0, 0, 5);
            const a2 = editor.solver.addArc(30, 0, 38, 0, 30, 8);
            editor.entityQueue.push(a1, a2);

            await runCommand(new EqualConstraintCommand(), editor);

            const found = constraintsOf(editor, ConstraintKind.EqualArcRadius);
            expect(found.length).toBe(1);
            expect(found[0].refs).toEqual([ref(a1, 0), ref(a1, 1), ref(a2, 0), ref(a2, 1)]);
        } finally {
            editor.solver.dispose();
        }
    });

    test("line and circle of different types pub an error without a constraint", async () => {
        const editor = fakeEditor();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            const l = editor.solver.addLine(0, 0, 10, 0);
            const c = editor.solver.addCircle(30, 0, 5);
            editor.entityQueue.push(l, c);

            await runCommand(new EqualConstraintCommand(), editor);

            expect(pub).toHaveBeenCalledWith("displayValidation", expect.any(String));
            expect(editor.solver.toData().constraints).toEqual([]);
            expect(editor.commit).not.toHaveBeenCalled();
        } finally {
            pub.mockRestore();
            editor.solver.dispose();
        }
    });

    test.each([
        {
            name: "two ellipses",
            add: (s: SketchSolver) => [s.addEllipse(0, 0, 10, 0, 0, 5), s.addEllipse(40, 0, 10, 0, 0, 5)],
        },
        {
            name: "two conics",
            add: (s: SketchSolver) => [
                s.addConic(0, 0, 5, 6, 10, 0, 0.5),
                s.addConic(20, 0, 25, 6, 30, 0, 0.5),
            ],
        },
        {
            name: "two beziers",
            add: (s: SketchSolver) => [
                s.addBezier([0, 0, 5, 6, 10, 0, 15, 6]),
                s.addBezier([20, 0, 25, 6, 30, 0, 35, 6]),
            ],
        },
    ])("$name: the pick is refused, not thrown out of the constraint being built", async ({ add }) => {
        const editor = fakeEditor();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            const [e1, e2] = add(editor.solver);
            editor.entityQueue.push(e1, e2);

            await runCommand(new EqualConstraintCommand(), editor);

            expect(pub).toHaveBeenCalledWith("displayValidation", "Equal applies to lines, circles and arcs");
            expect(editor.solver.toData().constraints.filter((c) => EQUAL_KINDS.includes(c.kind))).toEqual(
                [],
            );
            expect(editor.commit).not.toHaveBeenCalled();
        } finally {
            pub.mockRestore();
            editor.solver.dispose();
        }
    });

    test("picking the same entity twice pubs an error without a constraint", async () => {
        const editor = fakeEditor();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            const c = editor.solver.addCircle(0, 0, 5);
            editor.entityQueue.push(c, c);

            await runCommand(new EqualConstraintCommand(), editor);

            expect(pub).toHaveBeenCalledWith("displayValidation", expect.any(String));
            expect(editor.solver.toData().constraints).toEqual([]);
            expect(editor.commit).not.toHaveBeenCalled();
        } finally {
            pub.mockRestore();
            editor.solver.dispose();
        }
    });
});

describe("TangentConstraintCommand", () => {
    test.each([
        {
            name: "line + circle",
            add: (s: SketchSolver) => [s.addLine(0, 0, 10, 0), s.addCircle(30, 0, 5)],
            kind: ConstraintKind.TangentLineCircle,
            refs: (l: number, c: number) => [ref(l, 0), ref(l, 1), ref(c, 0)],
        },
        {
            name: "circle + line normalizes to line-first refs",
            add: (s: SketchSolver) => [s.addCircle(30, 0, 5), s.addLine(0, 0, 10, 0)],
            kind: ConstraintKind.TangentLineCircle,
            refs: (c: number, l: number) => [ref(l, 0), ref(l, 1), ref(c, 0)],
        },
        {
            name: "circle + circle",
            add: (s: SketchSolver) => [s.addCircle(0, 0, 5), s.addCircle(30, 0, 8)],
            kind: ConstraintKind.TangentCircleCircle,
            refs: (c1: number, c2: number) => [ref(c1, 0), ref(c2, 0)],
        },
        {
            name: "line + arc",
            add: (s: SketchSolver) => [s.addLine(0, 0, 10, 0), s.addArc(30, 0, 35, 0, 30, 5)],
            kind: ConstraintKind.TangentLineArc,
            refs: (l: number, a: number) => [ref(l, 0), ref(l, 1), ref(a, 0), ref(a, 1)],
        },
        {
            name: "arc + arc",
            add: (s: SketchSolver) => [s.addArc(0, 0, 5, 0, 0, 5), s.addArc(30, 0, 38, 0, 30, 8)],
            kind: ConstraintKind.TangentArcArc,
            refs: (a1: number, a2: number) => [ref(a1, 0), ref(a1, 1), ref(a2, 0), ref(a2, 1)],
        },
        {
            name: "circle + arc",
            add: (s: SketchSolver) => [s.addCircle(0, 0, 5), s.addArc(30, 0, 38, 0, 30, 8)],
            kind: ConstraintKind.TangentCircleArc,
            refs: (c: number, a: number) => [ref(c, 0), ref(a, 0), ref(a, 1)],
        },
    ])("$name applies the matching tangent constraint", async ({ add, kind, refs }) => {
        const editor = fakeEditor();
        try {
            const [e1, e2] = add(editor.solver);
            editor.entityQueue.push(e1, e2);

            await runCommand(new TangentConstraintCommand(), editor);

            const found = constraintsOf(editor, kind);
            expect(found.length).toBe(1);
            expect(found[0].refs).toEqual(refs(e1, e2));
            expect(editor.solve).toHaveBeenCalledWith(true);
            expect(editor.commit).toHaveBeenCalledTimes(1);
        } finally {
            editor.solver.dispose();
        }
    });

    test("refuses an array's instance as one of the two entities", async () => {
        const editor = fakeEditor();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            const source = editor.solver.addCircle(0, 0, 5);
            editor.solver.addArray(
                { type: "linear", x: { count: 2, spacing: 20 }, y: { count: 1, spacing: 0 } },
                [source],
            );
            const instanceId = liveInstanceIds(editor.solver.arrays()[0])[0];
            const other = editor.solver.addCircle(30, 0, 8);
            editor.entityQueue.push(instanceId, other);

            await runCommand(new TangentConstraintCommand(), editor);

            expect(pub).toHaveBeenCalledWith("showToast", "sketch.arrayInstanceReadOnly");
            expect(constraintsOf(editor, ConstraintKind.TangentCircleCircle)).toEqual([]);
            expect(editor.commit).not.toHaveBeenCalled();
        } finally {
            pub.mockRestore();
            editor.solver.dispose();
        }
    });

    test("two lines pub an error without a constraint", async () => {
        const editor = fakeEditor();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            const l1 = editor.solver.addLine(0, 0, 10, 0);
            const l2 = editor.solver.addLine(0, 5, 10, 5);
            editor.entityQueue.push(l1, l2);

            await runCommand(new TangentConstraintCommand(), editor);

            expect(pub).toHaveBeenCalledWith("displayValidation", expect.any(String));
            expect(editor.solver.toData().constraints).toEqual([]);
            expect(editor.commit).not.toHaveBeenCalled();
        } finally {
            pub.mockRestore();
            editor.solver.dispose();
        }
    });
});

describe("PointOnConstraintCommand", () => {
    test.each([
        {
            name: "point on line",
            add: (s: SketchSolver) => s.addLine(0, 0, 10, 0),
            kind: ConstraintKind.PointOnLine,
            refs: (p: SketchPointRef, e: number) => [p, ref(e, 0), ref(e, 1)],
        },
        {
            name: "point on circle",
            add: (s: SketchSolver) => s.addCircle(30, 0, 5),
            kind: ConstraintKind.PointOnCircle,
            refs: (p: SketchPointRef, e: number) => [p, ref(e, 0)],
        },
        {
            name: "point on arc",
            add: (s: SketchSolver) => s.addArc(30, 0, 35, 0, 30, 5),
            kind: ConstraintKind.PointOnArc,
            refs: (p: SketchPointRef, e: number) => [p, ref(e, 0), ref(e, 1)],
        },
    ])("$name constrains the picked point onto the entity", async ({ add, kind, refs }) => {
        const editor = fakeEditor();
        try {
            const anchor = editor.solver.addLine(-20, -20, -10, -20);
            const entity = add(editor.solver);
            const point = ref(anchor, 0);
            editor.pointQueue.push(point);
            editor.entityQueue.push(entity);

            await runCommand(new PointOnConstraintCommand(), editor);

            const found = constraintsOf(editor, kind);
            // arcs carry a structural PointOnArc constraint, so match by refs instead of count
            expect(found.map((c) => c.refs)).toContainEqual(refs(point, entity));
            expect(editor.commit).toHaveBeenCalledTimes(1);
        } finally {
            editor.solver.dispose();
        }
    });

    test("refuses an incidence a midpoint of that line already holds", async () => {
        const editor = fakeEditor();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            const anchor = editor.solver.addLine(-20, -20, -10, -20);
            const line = editor.solver.addLine(0, 0, 10, 0);
            const point = ref(anchor, 0);
            editor.solver.addConstraint({
                kind: ConstraintKind.Midpoint,
                refs: [point, ref(line, 0), ref(line, 1)],
            });
            editor.pointQueue.push(point);
            editor.entityQueue.push(line);

            await runCommand(new PointOnConstraintCommand(), editor);

            expect(pub).toHaveBeenCalledWith("showToast", "sketch.midpointHoldsPoint");
            expect(constraintsOf(editor, ConstraintKind.PointOnLine)).toEqual([]);
            expect(editor.commit).not.toHaveBeenCalled();
        } finally {
            pub.mockRestore();
            editor.solver.dispose();
        }
    });

    test("refuses an incidence a midpoint holds on a coincident partner", async () => {
        const editor = fakeEditor();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            const anchor = editor.solver.addLine(-20, -20, -10, -20);
            const partner = editor.solver.addLine(-20, 20, -10, 20);
            const line = editor.solver.addLine(0, 0, 10, 0);
            const point = ref(anchor, 0);
            editor.solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [point, ref(partner, 0)],
            });
            // the midpoint holds the partner, and the picked point stands where it does
            editor.solver.addConstraint({
                kind: ConstraintKind.Midpoint,
                refs: [ref(partner, 0), ref(line, 0), ref(line, 1)],
            });
            editor.pointQueue.push(point);
            editor.entityQueue.push(line);

            await runCommand(new PointOnConstraintCommand(), editor);

            expect(pub).toHaveBeenCalledWith("showToast", "sketch.midpointHoldsPoint");
            expect(constraintsOf(editor, ConstraintKind.PointOnLine)).toEqual([]);
        } finally {
            pub.mockRestore();
            editor.solver.dispose();
        }
    });

    test.each([
        {
            name: "a line's own end",
            add: (s: SketchSolver) => s.addLine(0, 0, 10, 0),
            index: 0,
            tip: "sketch.pointOnOwnCurve",
        },
        {
            name: "a circle's center",
            add: (s: SketchSolver) => s.addCircle(0, 0, 5),
            index: 0,
            tip: "sketch.pointOnOwnCenter",
        },
        {
            name: "an arc's center",
            add: (s: SketchSolver) => s.addArc(0, 0, 5, 0, 0, 5),
            index: 0,
            tip: "sketch.pointOnOwnCenter",
        },
        {
            name: "an arc's own rim point",
            add: (s: SketchSolver) => s.addArc(0, 0, 5, 0, 0, 5),
            index: 2,
            tip: "sketch.pointOnOwnCurve",
        },
        {
            name: "an ellipse's center",
            add: (s: SketchSolver) => s.addEllipse(0, 0, 5, 0, 0, 3),
            index: 0,
            tip: "sketch.pointOnOwnCenter",
        },
        {
            name: "an ellipse's axis point",
            add: (s: SketchSolver) => s.addEllipse(0, 0, 5, 0, 0, 3),
            index: 1,
            tip: "sketch.pointOnOwnCurve",
        },
        {
            name: "an ellipseArc's rim point",
            add: (s: SketchSolver) => s.addEllipseArc(0, 0, 5, 0, 0, 3, 5, 0, 0, 3),
            index: 3,
            tip: "sketch.pointOnOwnCurve",
        },
        {
            name: "a conic's start",
            add: (s: SketchSolver) => s.addConic(0, 0, 5, 8, 10, 0, 0.5),
            index: 0,
            tip: "sketch.pointOnOwnCurve",
        },
        {
            name: "a bezier's end pole",
            add: (s: SketchSolver) => s.addBezier([0, 0, 3, 8, 7, 8, 10, 0]),
            index: 3,
            tip: "sketch.pointOnOwnCurve",
        },
    ])("refuses $name", async ({ add, index, tip }) => {
        const editor = fakeEditor();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            const entity = add(editor.solver);
            const before = editor.solver.toData().constraints.length;
            editor.pointQueue.push(ref(entity, index));
            editor.entityQueue.push(entity);

            await runCommand(new PointOnConstraintCommand(), editor);

            expect(pub).toHaveBeenCalledWith("showToast", tip);
            // the arc and the ellipse family carry structural constraints of the same kinds
            expect(editor.solver.toData().constraints.length).toBe(before);
            expect(editor.commit).not.toHaveBeenCalled();
        } finally {
            pub.mockRestore();
            editor.solver.dispose();
        }
    });

    test("refuses the datum origin onto an axis it already lies on", async () => {
        const editor = fakeEditor();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            editor.pointQueue.push(originRef());
            editor.entityQueue.push(SKETCH_X_AXIS_ID);

            await runCommand(new PointOnConstraintCommand(), editor);

            expect(pub).toHaveBeenCalledWith("showToast", "sketch.pointOnOwnCurve");
            expect(constraintsOf(editor, ConstraintKind.PointOnLine)).toEqual([]);
            expect(editor.commit).not.toHaveBeenCalled();
        } finally {
            pub.mockRestore();
            editor.solver.dispose();
        }
    });

    test.each([
        {
            name: "a conic's shoulder control",
            add: (s: SketchSolver) => s.addConic(0, 0, 5, 8, 10, 0, 0.5),
            kind: ConstraintKind.PointOnConic,
            index: 1,
        },
        {
            name: "a bezier's inner pole",
            add: (s: SketchSolver) => s.addBezier([0, 0, 3, 8, 7, 8, 10, 0]),
            kind: ConstraintKind.PointOnBezier,
            index: 1,
        },
    ])("still constrains $name onto its own curve: the curve is not through it", async ({
        add,
        kind,
        index,
    }) => {
        const editor = fakeEditor();
        try {
            const entity = add(editor.solver);
            editor.pointQueue.push(ref(entity, index));
            editor.entityQueue.push(entity);

            await runCommand(new PointOnConstraintCommand(), editor);

            expect(constraintsOf(editor, kind).length).toBe(1);
            expect(editor.commit).toHaveBeenCalledTimes(1);
        } finally {
            editor.solver.dispose();
        }
    });

    test("refuses an array's instance as the target", async () => {
        const editor = fakeEditor();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            const anchor = editor.solver.addLine(-20, -20, -10, -20);
            const axis = editor.solver.addLine(-5, 0, 5, 0);
            editor.solver.addArray(
                { type: "linear", x: { count: 2, spacing: 20 }, y: { count: 1, spacing: 0 } },
                [axis],
            );
            const instanceId = liveInstanceIds(editor.solver.arrays()[0])[0];
            editor.pointQueue.push(ref(anchor, 0));
            editor.entityQueue.push(instanceId);

            await runCommand(new PointOnConstraintCommand(), editor);

            // the instance is placed by its array, so a constraint on it would be overwritten
            // by the next solve — the pick layer cannot tell, this gate is what does
            expect(pub).toHaveBeenCalledWith("showToast", "sketch.arrayInstanceReadOnly");
            expect(constraintsOf(editor, ConstraintKind.PointOnLine)).toEqual([]);
            expect(editor.commit).not.toHaveBeenCalled();
        } finally {
            pub.mockRestore();
            editor.solver.dispose();
        }
    });

    test("refuses a projected edge whose own end the point stands on", async () => {
        const editor = fakeEditor();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            editor.solver.addExternalEntity({ ...PROJECTED_EDGE });
            const holder = editor.solver.addLine(20, -5, 30, -5);
            const point = ref(holder, 0);
            // the drag that landed the point on the projected corner
            editor.solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [point, ref(PROJECTED_EDGE.entityId, 0)],
            });
            editor.pointQueue.push(point);
            editor.entityQueue.push(PROJECTED_EDGE.entityId);

            await runCommand(new PointOnConstraintCommand(), editor);

            // the fixed partner is not in the drag-reading group, but the point does stand on
            // the edge's own end: the incidence says nothing
            expect(pub).toHaveBeenCalledWith("showToast", "sketch.pointOnOwnCurve");
            expect(constraintsOf(editor, ConstraintKind.PointOnLine)).toEqual([]);
            expect(editor.commit).not.toHaveBeenCalled();
        } finally {
            pub.mockRestore();
            editor.solver.dispose();
        }
    });

    test("refuses a datum axis the picked point is coincident with the origin on", async () => {
        const editor = fakeEditor();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            const holder = editor.solver.addLine(0, 0, 10, 0);
            const point = ref(holder, 0);
            editor.solver.addConstraint({ kind: ConstraintKind.P2PCoincident, refs: [point, originRef()] });
            editor.pointQueue.push(point);
            editor.entityQueue.push(SKETCH_X_AXIS_ID);

            await runCommand(new PointOnConstraintCommand(), editor);

            expect(pub).toHaveBeenCalledWith("showToast", "sketch.pointOnOwnCurve");
            expect(constraintsOf(editor, ConstraintKind.PointOnLine)).toEqual([]);
        } finally {
            pub.mockRestore();
            editor.solver.dispose();
        }
    });

    test("settles a pair an older document carries", async () => {
        const editor = fakeEditor();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            const anchor = editor.solver.addLine(-20, -20, -10, -20);
            const line = editor.solver.addLine(0, 0, 10, 0);
            const point = ref(anchor, 0);
            const pointOn = editor.solver.addConstraint({
                kind: ConstraintKind.PointOnLine,
                refs: [point, ref(line, 0), ref(line, 1)],
            });
            editor.solver.addConstraint({
                kind: ConstraintKind.Midpoint,
                refs: [point, ref(line, 0), ref(line, 1)],
            });
            editor.pointQueue.push(point);
            editor.entityQueue.push(line);

            await runCommand(new PointOnConstraintCommand(), editor);

            // the midpoint already says this, so the row still sitting there from an older
            // document is the one this run settles — the mirror of what the midpoint tool does
            expect(constraintsOf(editor, ConstraintKind.PointOnLine)).toEqual([]);
            expect(editor.forgetConstraints).toHaveBeenCalledWith([pointOn]);
            expect(pub).toHaveBeenCalledWith("showToast", "sketch.pointOnSubsumed");
            expect(pub).not.toHaveBeenCalledWith("showToast", "sketch.midpointHoldsPoint");
            expect(editor.commit).toHaveBeenCalledTimes(1);
        } finally {
            pub.mockRestore();
            editor.solver.dispose();
        }
    });

    test("settles a pair whose rows hang off a coincident partner", async () => {
        const editor = fakeEditor();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            const anchor = editor.solver.addLine(-20, -20, -10, -20);
            const partner = editor.solver.addLine(-20, 20, -10, 20);
            const line = editor.solver.addLine(0, 0, 10, 0);
            const point = ref(anchor, 0);
            const peer = ref(partner, 0);
            editor.solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [point, peer],
            });
            // the midpoint holds the partner, which is what holds the picked point there too
            const pointOn = editor.solver.addConstraint({
                kind: ConstraintKind.PointOnLine,
                refs: [peer, ref(line, 0), ref(line, 1)],
            });
            editor.solver.addConstraint({
                kind: ConstraintKind.Midpoint,
                refs: [peer, ref(line, 0), ref(line, 1)],
            });
            editor.pointQueue.push(point);
            editor.entityQueue.push(line);

            await runCommand(new PointOnConstraintCommand(), editor);

            // the incidence the midpoint restates goes, and no second one takes its place —
            // a fresh row on the picked point would only be the same statement moved over
            expect(constraintsOf(editor, ConstraintKind.PointOnLine)).toEqual([]);
            expect(editor.forgetConstraints).toHaveBeenCalledWith([pointOn]);
            expect(pub).toHaveBeenCalledWith("showToast", "sketch.pointOnSubsumed");
            expect(pub).not.toHaveBeenCalledWith("showToast", "sketch.midpointHoldsPoint");
            expect(editor.commit).toHaveBeenCalledTimes(1);
        } finally {
            pub.mockRestore();
            editor.solver.dispose();
        }
    });

    test("a row that merely ends at the picked point is not the picked point's row", async () => {
        const editor = fakeEditor();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            const holder = editor.solver.addLine(-20, 20, -10, 20);
            const line = editor.solver.addLine(0, 0, 10, 0);
            const anchor = editor.solver.addLine(0, 0, 0, -8);
            const point = ref(anchor, 0); // the picked point, standing at the line's own end
            const subject = ref(holder, 0); // a point of the holder, unrelated to the pick
            editor.solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [point, ref(line, 0)],
            });
            // a midpoint and an incidence of the *holder's* point, whose line merely ends where
            // the picked point stands — neither says anything about the picked point
            for (const kind of [ConstraintKind.Midpoint, ConstraintKind.PointOnLine]) {
                editor.solver.addConstraint({
                    kind,
                    refs: [subject, ref(line, 0), ref(line, 1)],
                });
            }
            editor.pointQueue.push(point);
            editor.entityQueue.push(holder);

            await runCommand(new PointOnConstraintCommand(), editor);

            // the pick is a statement of its own: it goes in, and neither the midpoint that
            // holds someone else nor the "already there" tip has anything to say about it
            expect(
                constraintsOf(editor, ConstraintKind.PointOnLine).some(
                    (c) => pointRefKey(c.refs[0]) === pointRefKey(point),
                ),
            ).toBe(true);
            expect(pub).not.toHaveBeenCalledWith("showToast", "sketch.midpointHoldsPoint");
        } finally {
            pub.mockRestore();
            editor.solver.dispose();
        }
    });

    test.each([
        [1, 0],
        [0, 1],
    ])("a conic's shoulder coincident with its own start is read as the shoulder (%s)", async (...order) => {
        const editor = fakeEditor();
        try {
            const conic = editor.solver.addConic(0, 0, 5, 8, 10, 0, 0.5);
            editor.solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: order.map((pointIndex) => ref(conic, pointIndex)),
            });
            const shoulder = ref(conic, 1);
            editor.pointQueue.push(shoulder);
            editor.entityQueue.push(conic);

            await runCommand(new PointOnConstraintCommand(), editor);

            // the shoulder is a handle the curve does not pass through, whichever end of the
            // coincidence it was recorded on — the answer must not be a matter of that order
            expect(
                constraintsOf(editor, ConstraintKind.PointOnConic).some(
                    (c) => pointRefKey(c.refs[0]) === pointRefKey(shoulder),
                ),
            ).toBe(true);
            expect(editor.commit).toHaveBeenCalledTimes(1);
        } finally {
            editor.solver.dispose();
        }
    });

    test("still constrains a point a midpoint holds on another line", async () => {
        const editor = fakeEditor();
        try {
            const anchor = editor.solver.addLine(-20, -20, -10, -20);
            const other = editor.solver.addLine(0, 30, 10, 30);
            const line = editor.solver.addLine(0, 0, 10, 0);
            const point = ref(anchor, 0);
            editor.solver.addConstraint({
                kind: ConstraintKind.Midpoint,
                refs: [point, ref(line, 0), ref(line, 1)],
            });
            editor.pointQueue.push(point);
            editor.entityQueue.push(other);

            await runCommand(new PointOnConstraintCommand(), editor);

            expect(constraintsOf(editor, ConstraintKind.PointOnLine).length).toBe(1);
            expect(editor.commit).toHaveBeenCalledTimes(1);
        } finally {
            editor.solver.dispose();
        }
    });
});

describe("CoincidentConstraintCommand", () => {
    test("fuses the two picked points", async () => {
        const editor = fakeEditor();
        try {
            const anchor = editor.solver.addLine(-20, -20, -10, -20);
            const other = editor.solver.addLine(0, 5, 10, 5);
            editor.pointQueue.push(ref(anchor, 0), ref(other, 0));

            await runCommand(new CoincidentConstraintCommand(), editor);

            const found = constraintsOf(editor, ConstraintKind.P2PCoincident);
            expect(found.length).toBe(1);
            expect(found[0].refs).toEqual([ref(anchor, 0), ref(other, 0)]);
            expect(editor.commit).toHaveBeenCalledTimes(1);
        } finally {
            editor.solver.dispose();
        }
    });

    test("drops the point-on the coincidence restates, and says so", async () => {
        const editor = fakeEditor();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            const line = editor.solver.addLine(0, 0, 10, 0);
            const other = editor.solver.addLine(5, 3, 5, 8);
            const point = ref(other, 0);
            const pointOn = editor.solver.addConstraint({
                kind: ConstraintKind.PointOnLine,
                refs: [point, ref(line, 0), ref(line, 1)],
            });
            editor.pointQueue.push(point, ref(line, 1));

            await runCommand(new CoincidentConstraintCommand(), editor);

            // fusing onto the line's own end holds the point on the line by construction
            expect(constraintsOf(editor, ConstraintKind.PointOnLine)).toEqual([]);
            expect(editor.solver.toData().constraints.map((c) => c.id)).not.toContain(pointOn);
            expect(constraintsOf(editor, ConstraintKind.P2PCoincident).length).toBe(1);
            expect(pub).toHaveBeenCalledWith("showToast", "sketch.coincidentSubsumed");
            // one edit: the row is gone and the coincidence is there together
            expect(editor.commit).toHaveBeenCalledTimes(1);
            expect(editor.solve).toHaveBeenCalledWith(true);
        } finally {
            pub.mockRestore();
            editor.solver.dispose();
        }
    });

    test("drops it whichever of the two points is picked first", async () => {
        const editor = fakeEditor();
        try {
            const line = editor.solver.addLine(0, 0, 10, 0);
            const other = editor.solver.addLine(5, 3, 5, 8);
            const point = ref(other, 0);
            editor.solver.addConstraint({
                kind: ConstraintKind.PointOnLine,
                refs: [point, ref(line, 0), ref(line, 1)],
            });
            editor.pointQueue.push(ref(line, 1), point);

            await runCommand(new CoincidentConstraintCommand(), editor);

            expect(constraintsOf(editor, ConstraintKind.PointOnLine)).toEqual([]);
            expect(constraintsOf(editor, ConstraintKind.P2PCoincident).length).toBe(1);
        } finally {
            editor.solver.dispose();
        }
    });

    test("drops the incidence of a partner standing where the point does", async () => {
        const editor = fakeEditor();
        try {
            const line = editor.solver.addLine(0, 0, 10, 0);
            const anchor = editor.solver.addLine(-20, -20, -10, -20);
            const other = editor.solver.addLine(5, 3, 5, 8);
            const point = ref(anchor, 0);
            // the partner stands where the picked point does and is pinned onto the line
            editor.solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [point, ref(other, 0)],
            });
            editor.solver.addConstraint({
                kind: ConstraintKind.PointOnLine,
                refs: [ref(other, 0), ref(line, 0), ref(line, 1)],
            });
            editor.pointQueue.push(point, ref(line, 1));

            await runCommand(new CoincidentConstraintCommand(), editor);

            expect(constraintsOf(editor, ConstraintKind.PointOnLine)).toEqual([]);
            expect(constraintsOf(editor, ConstraintKind.P2PCoincident).length).toBe(2);
        } finally {
            editor.solver.dispose();
        }
    });

    test("drops the axis incidence a coincidence with the origin restates", async () => {
        const editor = fakeEditor();
        try {
            const other = editor.solver.addLine(5, 3, 5, 8);
            const point = ref(other, 0);
            editor.solver.addConstraint({
                kind: ConstraintKind.PointOnLine,
                refs: [point, ...axisLineRefs(SKETCH_X_AXIS_ID)],
            });
            editor.pointQueue.push(point, originRef());

            await runCommand(new CoincidentConstraintCommand(), editor);

            // the origin is a point of both axes, so the row is the coincidence's own
            expect(constraintsOf(editor, ConstraintKind.PointOnLine)).toEqual([]);
            expect(constraintsOf(editor, ConstraintKind.P2PCoincident).length).toBe(1);
        } finally {
            editor.solver.dispose();
        }
    });

    test("drops the point-on the arc's own end restates, and leaves the arc's structural row", async () => {
        const editor = fakeEditor();
        try {
            const arc = editor.solver.addArc(20, 20, 25, 20, 20, 25);
            const other = editor.solver.addLine(24, 21, 30, 28);
            const point = ref(other, 0);
            editor.solver.addConstraint({
                kind: ConstraintKind.PointOnArc,
                refs: [point, ref(arc, 0), ref(arc, 1)],
            });
            editor.pointQueue.push(point, ref(arc, 1));

            await runCommand(new CoincidentConstraintCommand(), editor);

            const pointOnArc = constraintsOf(editor, ConstraintKind.PointOnArc);
            expect(pointOnArc.length).toBe(1);
            expect(pointOnArc[0].refs).toEqual([ref(arc, 2), ref(arc, 0), ref(arc, 1)]);
        } finally {
            editor.solver.dispose();
        }
    });

    test("keeps a point-on onto another line", async () => {
        const editor = fakeEditor();
        try {
            const line = editor.solver.addLine(0, 0, 10, 0);
            const other = editor.solver.addLine(5, 3, 5, 8);
            const point = ref(other, 0);
            editor.solver.addConstraint({
                kind: ConstraintKind.PointOnLine,
                refs: [point, ref(line, 0), ref(line, 1)],
            });
            editor.pointQueue.push(point, ref(other, 1));

            await runCommand(new CoincidentConstraintCommand(), editor);

            // a coincidence of the line's two ends says nothing about where the point is
            expect(constraintsOf(editor, ConstraintKind.PointOnLine).length).toBe(1);
        } finally {
            editor.solver.dispose();
        }
    });

    test("settles a pair an older document carries", async () => {
        const editor = fakeEditor();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            const line = editor.solver.addLine(0, 0, 10, 0);
            const other = editor.solver.addLine(5, 3, 5, 8);
            const point = ref(other, 0);
            editor.solver.addConstraint({
                kind: ConstraintKind.PointOnLine,
                refs: [point, ref(line, 0), ref(line, 1)],
            });
            editor.solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [point, ref(line, 1)],
            });
            editor.pointQueue.push(point, ref(line, 1));

            await runCommand(new CoincidentConstraintCommand(), editor);

            // the coincidence is already there, and the row it restates goes anyway
            expect(constraintsOf(editor, ConstraintKind.PointOnLine)).toEqual([]);
            expect(constraintsOf(editor, ConstraintKind.P2PCoincident).length).toBe(1);
            expect(pub).toHaveBeenCalledWith("showToast", "sketch.coincidentSubsumed");
        } finally {
            pub.mockRestore();
            editor.solver.dispose();
        }
    });

    test("re-picking the same pair adds nothing and says the constraint exists", async () => {
        const editor = fakeEditor();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            const anchor = editor.solver.addLine(-20, -20, -10, -20);
            const other = editor.solver.addLine(0, 5, 10, 5);
            editor.solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [ref(anchor, 0), ref(other, 0)],
            });
            editor.pointQueue.push(ref(anchor, 0), ref(other, 0));

            await runCommand(new CoincidentConstraintCommand(), editor);

            // a second identical row is a redundancy the solve would report, not a statement
            expect(constraintsOf(editor, ConstraintKind.P2PCoincident).length).toBe(1);
            expect(pub).toHaveBeenCalledWith("showToast", "sketch.constraintExists");
            expect(editor.commit).not.toHaveBeenCalled();
        } finally {
            pub.mockRestore();
            editor.solver.dispose();
        }
    });

    test("leaves a row the picked points only carry alone", async () => {
        const editor = fakeEditor();
        try {
            const line = editor.solver.addLine(0, 0, 10, 0);
            const bystander = editor.solver.addLine(5, 0, 5, 8);
            // the row is the bystander's own, and it happens to carry both of the line's ends
            editor.solver.addConstraint({
                kind: ConstraintKind.PointOnLine,
                refs: [ref(bystander, 0), ref(line, 0), ref(line, 1)],
            });
            // the degenerate pick is the guard: fusing a line's two ends is the one pair whose
            // reads would otherwise take a third point's row with them
            editor.pointQueue.push(ref(line, 0), ref(line, 1));

            await runCommand(new CoincidentConstraintCommand(), editor);

            const pointOn = constraintsOf(editor, ConstraintKind.PointOnLine);
            expect(pointOn.length).toBe(1);
            expect(pointOn[0].refs).toEqual([ref(bystander, 0), ref(line, 0), ref(line, 1)]);
        } finally {
            editor.solver.dispose();
        }
    });

    test("refuses an array's instance as one of the two points", async () => {
        const editor = fakeEditor();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            const axis = editor.solver.addLine(-5, 0, 5, 0);
            editor.solver.addArray(
                { type: "linear", x: { count: 2, spacing: 20 }, y: { count: 1, spacing: 0 } },
                [axis],
            );
            const instanceId = liveInstanceIds(editor.solver.arrays()[0])[0];
            const other = editor.solver.addLine(0, 5, 10, 5);
            editor.pointQueue.push(ref(instanceId, 0), ref(other, 0));

            await runCommand(new CoincidentConstraintCommand(), editor);

            expect(pub).toHaveBeenCalledWith("showToast", "sketch.arrayInstanceReadOnly");
            expect(constraintsOf(editor, ConstraintKind.P2PCoincident)).toEqual([]);
            expect(editor.commit).not.toHaveBeenCalled();
        } finally {
            pub.mockRestore();
            editor.solver.dispose();
        }
    });

    test.each([false, true])("refuses a fuse a midpoint holds away (reversed: %s)", async (reversed) => {
        const editor = fakeEditor();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            const line = editor.solver.addLine(0, 0, 10, 0);
            const other = editor.solver.addLine(5, 0, 5, 8);
            const point = ref(other, 0);
            editor.solver.addConstraint({
                kind: ConstraintKind.Midpoint,
                refs: [point, ref(line, 0), ref(line, 1)],
            });
            const end = ref(line, 1);
            editor.pointQueue.push(...(reversed ? [end, point] : [point, end]));

            await runCommand(new CoincidentConstraintCommand(), editor);

            // the midpoint pins the point at (5,0); fusing it to the line's own end holds only
            // with the line collapsed, so the pick is refused rather than left to the solve
            expect(pub).toHaveBeenCalledWith("showToast", "sketch.midpointBlocksCoincident");
            expect(constraintsOf(editor, ConstraintKind.P2PCoincident)).toEqual([]);
            expect(constraintsOf(editor, ConstraintKind.Midpoint).length).toBe(1);
            expect(editor.commit).not.toHaveBeenCalled();
        } finally {
            pub.mockRestore();
            editor.solver.dispose();
        }
    });

    test.each([
        false,
        true,
    ])("refuses a fuse onto a point the entity's own curve misses (reversed: %s)", async (reversed) => {
        const editor = fakeEditor();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            const circle = editor.solver.addCircle(0, 0, 5);
            const other = editor.solver.addLine(5, 0, 5, 8);
            const point = ref(other, 0);
            editor.solver.addConstraint({
                kind: ConstraintKind.PointOnCircle,
                refs: [point, ref(circle, 0)],
            });
            const center = ref(circle, 0);
            editor.pointQueue.push(...(reversed ? [center, point] : [point, center]));

            await runCommand(new CoincidentConstraintCommand(), editor);

            // a circle's center is a point OF the circle that is not ON it: fusing there
            // contradicts the point-on rather than restating it, so the pick is refused and
            // the row the user placed stays put
            expect(pub).toHaveBeenCalledWith("showToast", "sketch.coincidentOffCurve");
            expect(constraintsOf(editor, ConstraintKind.PointOnCircle).length).toBe(1);
            expect(constraintsOf(editor, ConstraintKind.P2PCoincident)).toEqual([]);
            expect(editor.commit).not.toHaveBeenCalled();
        } finally {
            pub.mockRestore();
            editor.solver.dispose();
        }
    });

    test("fuses onto a size center nothing is held on", async () => {
        const editor = fakeEditor();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            const circle = editor.solver.addCircle(0, 0, 5);
            const other = editor.solver.addLine(5, 0, 5, 8);
            editor.pointQueue.push(ref(other, 0), ref(circle, 0));

            await runCommand(new CoincidentConstraintCommand(), editor);

            // nothing holds the point on the circle, so the fuse is just a move to its center
            expect(pub).not.toHaveBeenCalledWith("showToast", "sketch.coincidentOffCurve");
            expect(constraintsOf(editor, ConstraintKind.P2PCoincident).length).toBe(1);
            expect(editor.commit).toHaveBeenCalledTimes(1);
        } finally {
            pub.mockRestore();
            editor.solver.dispose();
        }
    });

    test("refuses a pair the chain of coincidences already holds", async () => {
        const editor = fakeEditor();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            const a = editor.solver.addLine(0, 0, 5, 0);
            const b = editor.solver.addLine(5, 0, 5, 8);
            const c = editor.solver.addLine(5, 8, 10, 8);
            editor.solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [ref(a, 1), ref(b, 0)],
            });
            editor.solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [ref(b, 0), ref(c, 0)],
            });
            editor.pointQueue.push(ref(a, 1), ref(c, 0));

            await runCommand(new CoincidentConstraintCommand(), editor);

            // the third row over one place is a redundancy the solve would report, and it says
            // nothing the chain does not
            expect(constraintsOf(editor, ConstraintKind.P2PCoincident).length).toBe(2);
            expect(pub).toHaveBeenCalledWith("showToast", "sketch.constraintExists");
            expect(editor.commit).not.toHaveBeenCalled();
        } finally {
            pub.mockRestore();
            editor.solver.dispose();
        }
    });

    test("fuses a point a midpoint holds on another line", async () => {
        const editor = fakeEditor();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            const line = editor.solver.addLine(0, 0, 10, 0);
            const other = editor.solver.addLine(0, 30, 10, 30);
            const point = editor.solver.addLine(5, 0, 5, 8);
            editor.solver.addConstraint({
                kind: ConstraintKind.Midpoint,
                refs: [ref(point, 0), ref(other, 0), ref(other, 1)],
            });
            editor.pointQueue.push(ref(point, 0), ref(line, 1));

            await runCommand(new CoincidentConstraintCommand(), editor);

            // the midpoint is of the far line, so it says nothing about where the point may
            // stand on this one
            expect(pub).not.toHaveBeenCalledWith("showToast", "sketch.midpointBlocksCoincident");
            expect(constraintsOf(editor, ConstraintKind.P2PCoincident).length).toBe(1);
            expect(editor.commit).toHaveBeenCalledTimes(1);
        } finally {
            pub.mockRestore();
            editor.solver.dispose();
        }
    });
});

describe("MidpointConstraintCommand", () => {
    test("constrains a point to the line midpoint", async () => {
        const editor = fakeEditor();
        try {
            const anchor = editor.solver.addLine(-20, -20, -10, -20);
            const line = editor.solver.addLine(0, 0, 10, 0);
            const point = ref(anchor, 0);
            editor.pointQueue.push(point);
            editor.entityQueue.push(line);

            await runCommand(new MidpointConstraintCommand(), editor);

            const found = constraintsOf(editor, ConstraintKind.Midpoint);
            expect(found.length).toBe(1);
            expect(found[0].refs).toEqual([point, ref(line, 0), ref(line, 1)]);
            expect(editor.commit).toHaveBeenCalledTimes(1);
        } finally {
            editor.solver.dispose();
        }
    });

    test("drops the point-on constraint the midpoint restates, and says so", async () => {
        const editor = fakeEditor();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            const anchor = editor.solver.addLine(-20, -20, -10, -20);
            const line = editor.solver.addLine(0, 0, 10, 0);
            const point = ref(anchor, 0);
            editor.solver.addConstraint({
                kind: ConstraintKind.PointOnLine,
                refs: [point, ref(line, 0), ref(line, 1)],
            });
            editor.pointQueue.push(point);
            editor.entityQueue.push(line);

            await runCommand(new MidpointConstraintCommand(), editor);

            expect(constraintsOf(editor, ConstraintKind.PointOnLine)).toEqual([]);
            expect(constraintsOf(editor, ConstraintKind.Midpoint).length).toBe(1);
            expect(pub).toHaveBeenCalledWith("showToast", "sketch.pointOnSubsumed");
            // the swap is one edit: the point-on is gone and the midpoint is there together
            expect(editor.commit).toHaveBeenCalledTimes(1);
        } finally {
            pub.mockRestore();
            editor.solver.dispose();
        }
    });

    test("says nothing when there was nothing to restate", async () => {
        const editor = fakeEditor();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            const anchor = editor.solver.addLine(-20, -20, -10, -20);
            const line = editor.solver.addLine(0, 0, 10, 0);
            editor.pointQueue.push(ref(anchor, 0));
            editor.entityQueue.push(line);

            await runCommand(new MidpointConstraintCommand(), editor);

            expect(constraintsOf(editor, ConstraintKind.Midpoint).length).toBe(1);
            expect(editor.commit).toHaveBeenCalledTimes(1);
            expect(pub).not.toHaveBeenCalledWith("showToast", "sketch.pointOnSubsumed");
        } finally {
            pub.mockRestore();
            editor.solver.dispose();
        }
    });

    test("settles a pair an older document carries", async () => {
        const editor = fakeEditor();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            const anchor = editor.solver.addLine(-20, -20, -10, -20);
            const line = editor.solver.addLine(0, 0, 10, 0);
            const point = ref(anchor, 0);
            const pointOn = editor.solver.addConstraint({
                kind: ConstraintKind.PointOnLine,
                refs: [point, ref(line, 0), ref(line, 1)],
            });
            editor.solver.addConstraint({
                kind: ConstraintKind.Midpoint,
                refs: [point, ref(line, 0), ref(line, 1)],
            });
            editor.pointQueue.push(point);
            editor.entityQueue.push(line);

            await runCommand(new MidpointConstraintCommand(), editor);

            // the tool is asked again for something it already holds, and the redundant row it
            // restates goes with it rather than sitting there for the panel to puzzle over
            expect(constraintsOf(editor, ConstraintKind.PointOnLine)).toEqual([]);
            expect(constraintsOf(editor, ConstraintKind.Midpoint).length).toBe(1);
            expect(editor.forgetConstraints).toHaveBeenCalledWith([pointOn]);
            expect(pub).toHaveBeenCalledWith("showToast", "sketch.pointOnSubsumed");
            expect(pub).not.toHaveBeenCalledWith("showToast", "sketch.constraintExists");
            expect(editor.commit).toHaveBeenCalledTimes(1);
        } finally {
            pub.mockRestore();
            editor.solver.dispose();
        }
    });

    test("settles a pair whose rows hang off a coincident partner", async () => {
        const editor = fakeEditor();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            const anchor = editor.solver.addLine(-20, -20, -10, -20);
            const partner = editor.solver.addLine(-20, 20, -10, 20);
            const line = editor.solver.addLine(0, 0, 10, 0);
            const point = ref(anchor, 0);
            const peer = ref(partner, 0);
            editor.solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [point, peer],
            });
            // the older document's pair sits on the partner; the user picks the other end of
            // the same coincidence
            const pointOn = editor.solver.addConstraint({
                kind: ConstraintKind.PointOnLine,
                refs: [peer, ref(line, 0), ref(line, 1)],
            });
            editor.solver.addConstraint({
                kind: ConstraintKind.Midpoint,
                refs: [peer, ref(line, 0), ref(line, 1)],
            });
            editor.pointQueue.push(point);
            editor.entityQueue.push(line);

            await runCommand(new MidpointConstraintCommand(), editor);

            // a second midpoint would be the same statement written on the neighbour point,
            // which is exactly the redundant pair the tool is here to settle
            expect(constraintsOf(editor, ConstraintKind.PointOnLine)).toEqual([]);
            expect(constraintsOf(editor, ConstraintKind.Midpoint).length).toBe(1);
            expect(editor.forgetConstraints).toHaveBeenCalledWith([pointOn]);
            expect(pub).toHaveBeenCalledWith("showToast", "sketch.pointOnSubsumed");
            expect(pub).not.toHaveBeenCalledWith("showToast", "sketch.constraintExists");
            expect(editor.commit).toHaveBeenCalledTimes(1);
        } finally {
            pub.mockRestore();
            editor.solver.dispose();
        }
    });

    test("drops the incidence of a projected partner standing where the point does", async () => {
        const editor = fakeEditor();
        try {
            editor.solver.addExternalEntity({ ...PROJECTED_EDGE });
            const anchor = editor.solver.addLine(20, -5, 30, -5);
            const line = editor.solver.addLine(0, 0, 10, 0);
            const point = ref(anchor, 0);
            editor.solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [point, ref(PROJECTED_EDGE.entityId, 0)],
            });
            // the projected corner is held on the line; the midpoint holds the point there,
            // so it holds the corner there too
            editor.solver.addConstraint({
                kind: ConstraintKind.PointOnLine,
                refs: [ref(PROJECTED_EDGE.entityId, 0), ref(line, 0), ref(line, 1)],
            });
            editor.pointQueue.push(point);
            editor.entityQueue.push(line);

            await runCommand(new MidpointConstraintCommand(), editor);

            expect(constraintsOf(editor, ConstraintKind.PointOnLine)).toEqual([]);
            expect(constraintsOf(editor, ConstraintKind.Midpoint).length).toBe(1);
        } finally {
            editor.solver.dispose();
        }
    });

    test("refuses a line the picked point stands at the end of, through a projected snap", async () => {
        const editor = fakeEditor();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            editor.solver.addExternalEntity({ ...PROJECTED_EDGE });
            const holder = editor.solver.addLine(20, -5, 30, -5);
            const point = ref(holder, 0);
            editor.solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [point, ref(PROJECTED_EDGE.entityId, 0)],
            });
            editor.pointQueue.push(point);
            editor.entityQueue.push(PROJECTED_EDGE.entityId);

            await runCommand(new MidpointConstraintCommand(), editor);

            // the guard would otherwise let this through and the solve would answer
            // "Conflicting" — the midpoint holds only with the line collapsed
            expect(pub).toHaveBeenCalledWith("showToast", "sketch.midpointOnOwnEnd");
            expect(constraintsOf(editor, ConstraintKind.Midpoint)).toEqual([]);
            expect(editor.commit).not.toHaveBeenCalled();
        } finally {
            pub.mockRestore();
            editor.solver.dispose();
        }
    });

    test("leaves no redundant group behind", async () => {
        const editor = fakeEditor();
        try {
            const line = editor.solver.addLine(0, 0, 10, 0);
            // pin the line: with its ends held, garlic's verdict on the pair is decisive
            for (const pointIndex of [0, 1]) {
                editor.solver.addConstraint({ kind: ConstraintKind.Fix, refs: [ref(line, pointIndex)] });
            }
            const anchor = editor.solver.addLine(-20, -20, -10, -20);
            const point = ref(anchor, 0);
            editor.solver.addConstraint({
                kind: ConstraintKind.PointOnLine,
                refs: [point, ref(line, 0), ref(line, 1)],
            });
            editor.pointQueue.push(point);
            editor.entityQueue.push(line);

            await runCommand(new MidpointConstraintCommand(), editor);
            // the fake editor's solve is a no-op mock — solve for real
            editor.solver.solve(true);

            // keeping both would read as a redundant group of two, which the panel then
            // offers to resolve by deleting either
            expect(editor.solver.diagnose().redundant).toEqual([]);
        } finally {
            editor.solver.dispose();
        }
    });

    test("drops the point-on constraint reached through a coincidence", async () => {
        const editor = fakeEditor();
        try {
            const anchor = editor.solver.addLine(-20, -20, -10, -20);
            const partner = editor.solver.addLine(-20, 20, -10, 20);
            const line = editor.solver.addLine(0, 0, 10, 0);
            const point = ref(anchor, 0);
            // the partner stands where the picked point does and is pinned onto the line
            editor.solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [point, ref(partner, 0)],
            });
            editor.solver.addConstraint({
                kind: ConstraintKind.PointOnLine,
                refs: [ref(partner, 0), ref(line, 0), ref(line, 1)],
            });
            editor.pointQueue.push(point);
            editor.entityQueue.push(line);

            await runCommand(new MidpointConstraintCommand(), editor);

            expect(constraintsOf(editor, ConstraintKind.PointOnLine)).toEqual([]);
            expect(constraintsOf(editor, ConstraintKind.Midpoint).length).toBe(1);
        } finally {
            editor.solver.dispose();
        }
    });

    test("keeps a point-on constraint onto another line", async () => {
        const editor = fakeEditor();
        try {
            const anchor = editor.solver.addLine(-20, -20, -10, -20);
            const other = editor.solver.addLine(0, 30, 10, 30);
            const line = editor.solver.addLine(0, 0, 10, 0);
            const point = ref(anchor, 0);
            editor.solver.addConstraint({
                kind: ConstraintKind.PointOnLine,
                refs: [point, ref(other, 0), ref(other, 1)],
            });
            editor.pointQueue.push(point);
            editor.entityQueue.push(line);

            await runCommand(new MidpointConstraintCommand(), editor);

            // the midpoint says nothing about the other line, so its incidence stays
            expect(constraintsOf(editor, ConstraintKind.PointOnLine).length).toBe(1);
        } finally {
            editor.solver.dispose();
        }
    });

    test.each([0, 1])("refuses the line's own end at pointIndex %i", async (pointIndex) => {
        const editor = fakeEditor();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            const line = editor.solver.addLine(0, 0, 10, 0);
            editor.pointQueue.push(ref(line, pointIndex));
            editor.entityQueue.push(line);

            await runCommand(new MidpointConstraintCommand(), editor);

            expect(pub).toHaveBeenCalledWith("showToast", "sketch.midpointOnOwnEnd");
            expect(constraintsOf(editor, ConstraintKind.Midpoint)).toEqual([]);
            expect(editor.commit).not.toHaveBeenCalled();
        } finally {
            pub.mockRestore();
            editor.solver.dispose();
        }
    });

    test("reports an array's instance rather than the own-end rule it also trips", async () => {
        const editor = fakeEditor();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            const axis = editor.solver.addLine(-5, 0, 5, 0);
            editor.solver.addArray(
                { type: "linear", x: { count: 2, spacing: 20 }, y: { count: 1, spacing: 0 } },
                [axis],
            );
            const instanceId = liveInstanceIds(editor.solver.arrays()[0])[0];
            // an instance's own end trips both rules; the one that says what to do about it
            // is the gate, so the gate is asked first
            editor.pointQueue.push(ref(instanceId, 0));
            editor.entityQueue.push(instanceId);

            await runCommand(new MidpointConstraintCommand(), editor);

            expect(pub).toHaveBeenCalledWith("showToast", "sketch.arrayInstanceReadOnly");
            expect(pub).not.toHaveBeenCalledWith("showToast", "sketch.midpointOnOwnEnd");
            expect(editor.commit).not.toHaveBeenCalled();
        } finally {
            pub.mockRestore();
            editor.solver.dispose();
        }
    });

    test("refuses an end the picked point is coincident with", async () => {
        const editor = fakeEditor();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            const line = editor.solver.addLine(0, 0, 10, 0);
            const holder = editor.solver.addLine(-20, -20, -10, -20);
            const point = ref(holder, 0);
            editor.solver.addConstraint({
                kind: ConstraintKind.P2PCoincident,
                refs: [point, ref(line, 0)],
            });
            editor.pointQueue.push(point);
            editor.entityQueue.push(line);

            await runCommand(new MidpointConstraintCommand(), editor);

            expect(pub).toHaveBeenCalledWith("showToast", "sketch.midpointOnOwnEnd");
            expect(constraintsOf(editor, ConstraintKind.Midpoint)).toEqual([]);
        } finally {
            pub.mockRestore();
            editor.solver.dispose();
        }
    });
});

describe("SymmetricConstraintCommand", () => {
    test("constrains two points symmetric about a line", async () => {
        const editor = fakeEditor();
        try {
            const anchor = editor.solver.addLine(-20, -20, -10, -20);
            const line = editor.solver.addLine(0, 0, 10, 0);
            const p1 = ref(anchor, 0);
            const p2 = ref(anchor, 1);
            editor.pointQueue.push(p1, p2);
            editor.entityQueue.push(line);

            await runCommand(new SymmetricConstraintCommand(), editor);

            const found = constraintsOf(editor, ConstraintKind.Symmetric);
            expect(found.length).toBe(1);
            expect(found[0].refs).toEqual([p1, p2, ref(line, 0), ref(line, 1)]);
            expect(editor.commit).toHaveBeenCalledTimes(1);
        } finally {
            editor.solver.dispose();
        }
    });
});

describe("HorizontalAlign/VerticalAlignConstraintCommand", () => {
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
    ])("$name aligns two picked points", async ({ command, kind }) => {
        const editor = fakeEditor();
        try {
            const anchor = editor.solver.addLine(0, 0, 10, 3);
            const p1 = ref(anchor, 0);
            const p2 = ref(anchor, 1);
            editor.pointQueue.push(p1, p2);

            await runCommand(command(), editor);

            const found = constraintsOf(editor, kind);
            expect(found.length).toBe(1);
            expect(found[0].refs).toEqual([p1, p2]);
            expect(editor.commit).toHaveBeenCalledTimes(1);
        } finally {
            editor.solver.dispose();
        }
    });
});

describe("FixConstraintCommand", () => {
    test("pins the picked point at its current coordinates", async () => {
        const editor = fakeEditor();
        try {
            const line = editor.solver.addLine(3, 4, 8, 9);
            editor.pointQueue.push(ref(line, 0));

            await runCommand(new FixConstraintCommand(), editor);

            const found = constraintsOf(editor, ConstraintKind.Fix);
            expect(found.length).toBe(1);
            expect(found[0].refs).toEqual([ref(line, 0)]);
            expect(found[0].datums).toEqual([3, 4]);
            expect(editor.commit).toHaveBeenCalledTimes(1);
        } finally {
            editor.solver.dispose();
        }
    });
});

describe("duplicate suppression", () => {
    test("re-running parallel on the same lines pubs constraintExists and does not commit", async () => {
        const editor = fakeEditor();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            const l1 = editor.solver.addLine(0, 0, 10, 0);
            const l2 = editor.solver.addLine(0, 5, 10, 5);
            editor.entityQueue.push(l1, l2, l1, l2);

            await runCommand(new ParallelConstraintCommand(), editor);
            await runCommand(new ParallelConstraintCommand(), editor);

            expect(pub).toHaveBeenCalledWith("showToast", "sketch.constraintExists");
            expect(constraintsOf(editor, ConstraintKind.Parallel).length).toBe(1);
            expect(editor.commit).toHaveBeenCalledTimes(1);
        } finally {
            pub.mockRestore();
            editor.solver.dispose();
        }
    });

    test("two different statements on one ring of coincident corners are both taken", async () => {
        const editor = fakeEditor();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            // a closed quad: every corner is a coincidence of two line ends
            const quad = [
                editor.solver.addLine(0, 0, 10, 0),
                editor.solver.addLine(10, 0, 10, 8),
                editor.solver.addLine(10, 8, 0, 8),
                editor.solver.addLine(0, 8, 0, 0),
            ];
            for (let i = 0; i < quad.length; i++) {
                editor.solver.addConstraint({
                    kind: ConstraintKind.P2PCoincident,
                    refs: [ref(quad[i], 1), ref(quad[(i + 1) % quad.length], 0)],
                });
            }
            // one pair of opposite sides is already equal; the other pair is a statement of its
            // own — the corners being fused says nothing about which sides were named
            editor.solver.addConstraint({
                kind: ConstraintKind.EqualLength,
                refs: [ref(quad[0], 0), ref(quad[0], 1), ref(quad[2], 0), ref(quad[2], 1)],
            });
            editor.entityQueue.push(quad[1], quad[3]);

            await runCommand(new EqualConstraintCommand(), editor);

            expect(constraintsOf(editor, ConstraintKind.EqualLength).length).toBe(2);
            expect(pub).not.toHaveBeenCalledWith("showToast", "sketch.constraintExists");
            expect(editor.commit).toHaveBeenCalledTimes(1);
        } finally {
            pub.mockRestore();
            editor.solver.dispose();
        }
    });
});

describe("geometry sanity", () => {
    test("EqualLength makes two unequal lines equal after a real solve", async () => {
        const editor = fakeEditor();
        try {
            const l1 = editor.solver.addLine(0, 0, 10, 0);
            const l2 = editor.solver.addLine(20, 0, 30, 7);
            editor.entityQueue.push(l1, l2);

            await runCommand(new EqualConstraintCommand(), editor);
            // the fake editor's solve is a no-op mock — solve for real
            editor.solver.solve(true);

            const length = (id: number) => {
                const params = editor.solver.entity(id)!.params;
                return Math.hypot(params[2] - params[0], params[3] - params[1]);
            };
            expect(length(l1)).toBeCloseTo(length(l2), 6);
        } finally {
            editor.solver.dispose();
        }
    });
});

describe("datum picks (origin and axes)", () => {
    test("coincident accepts the origin as a picked point", async () => {
        const editor = fakeEditor();
        try {
            const line = editor.solver.addLine(5, 5, 10, 0);
            editor.pointQueue.push(ref(line, 0), originRef());

            await runCommand(new CoincidentConstraintCommand(), editor);

            const found = constraintsOf(editor, ConstraintKind.P2PCoincident);
            expect(found.length).toBe(1);
            expect(found[0].refs).toEqual([ref(line, 0), originRef()]);
            expect(editor.commit).toHaveBeenCalledTimes(1);
        } finally {
            editor.solver.dispose();
        }
    });

    test("pointOn accepts a datum axis and constrains the point onto it", async () => {
        const editor = fakeEditor();
        try {
            const line = editor.solver.addLine(5, 5, 10, 0);
            editor.pointQueue.push(ref(line, 0));
            editor.entityQueue.push(SKETCH_X_AXIS_ID);

            await runCommand(new PointOnConstraintCommand(), editor);

            const found = constraintsOf(editor, ConstraintKind.PointOnLine);
            expect(found.length).toBe(1);
            expect(found[0].refs).toEqual([ref(line, 0), ...axisLineRefs(SKETCH_X_AXIS_ID)]);
            expect(editor.commit).toHaveBeenCalledTimes(1);
        } finally {
            editor.solver.dispose();
        }
    });

    test("symmetric accepts a datum axis as the mirror line", async () => {
        const editor = fakeEditor();
        try {
            const line = editor.solver.addLine(2, 3, 6, 3);
            editor.pointQueue.push(ref(line, 0), ref(line, 1));
            editor.entityQueue.push(SKETCH_Y_AXIS_ID);

            await runCommand(new SymmetricConstraintCommand(), editor);

            const found = constraintsOf(editor, ConstraintKind.Symmetric);
            expect(found.length).toBe(1);
            expect(found[0].refs).toEqual([ref(line, 0), ref(line, 1), ...axisLineRefs(SKETCH_Y_AXIS_ID)]);
            expect(editor.commit).toHaveBeenCalledTimes(1);
        } finally {
            editor.solver.dispose();
        }
    });

    test("parallel accepts a datum axis and solves the line horizontal", async () => {
        const editor = fakeEditor();
        try {
            const line = editor.solver.addLine(0, 5, 10, 8);
            editor.entityQueue.push(line, SKETCH_X_AXIS_ID);

            await runCommand(new ParallelConstraintCommand(), editor);

            const found = constraintsOf(editor, ConstraintKind.Parallel);
            expect(found.length).toBe(1);
            expect(found[0].refs).toEqual([ref(line, 0), ref(line, 1), ...axisLineRefs(SKETCH_X_AXIS_ID)]);
            // the fake editor's solve is a no-op mock — solve for real
            editor.solver.solve(true);
            const [y1, y2] = [editor.solver.pointOf(ref(line, 0))[1], editor.solver.pointOf(ref(line, 1))[1]];
            expect(y2).toBeCloseTo(y1, 6);
        } finally {
            editor.solver.dispose();
        }
    });
});

describe("constraint commands on a control net segment", () => {
    test("parallel reads the line between two handles the way it reads a line", async () => {
        const editor = fakeEditor();
        try {
            const bezier = editor.solver.addBezier([0, 0, 0, 40, 30, 40, 30, 0]);
            const line = editor.solver.addLine(0, 0, 10, 0);
            editor.entityQueue.push(bezier, line);
            // the click landed on the line between the two handles of the bezier
            editor.segmentQueue.push([1, 2]);

            await runCommand(new ParallelConstraintCommand(), editor);

            const parallel = constraintsOf(editor, ConstraintKind.Parallel);
            expect(parallel.length).toBe(1);
            // the handle line is the two control points the click was between; the other
            // segment is the line's own two points
            expect(parallel[0].refs).toEqual([ref(bezier, 1), ref(bezier, 2), ref(line, 0), ref(line, 1)]);
        } finally {
            editor.solver.dispose();
        }
    });

    test("horizontal on a handle line names that pair and commits", async () => {
        const editor = fakeEditor();
        try {
            const bezier = editor.solver.addBezier([0, 0, 0, 40, 30, 40, 30, 0]);
            editor.entityQueue.push(bezier);
            editor.segmentQueue.push([0, 1]);

            await runCommand(new HorizontalConstraintCommand(), editor);

            const horizontal = constraintsOf(editor, ConstraintKind.Horizontal);
            expect(horizontal.length).toBe(1);
            expect(horizontal[0].refs).toEqual([ref(bezier, 0), ref(bezier, 1)]);
        } finally {
            editor.solver.dispose();
        }
    });
});
