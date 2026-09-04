// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type I18nKeys, type ICommand, Plane, PubSub } from "@chili3d/core";
import { rs } from "@rstest/core";
import {
    CoincidentConstraintCommand,
    EqualConstraintCommand,
    FixConstraintCommand,
    HorizontalAlignConstraintCommand,
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
    originRef,
    SKETCH_X_AXIS_ID,
    SKETCH_Y_AXIS_ID,
    type SketchPointRef,
} from "../../src/sketch/sketchModel";
import { SketchSolver } from "../../src/sketch/solver";
import "./setup";

function fakeEditor() {
    const solver = new SketchSolver(Plane.XY);
    const pointQueue: SketchPointRef[] = [];
    const entityQueue: number[] = [];
    return {
        node: { plane: Plane.XY },
        solver,
        solve: rs.fn((_fine: boolean) => {}),
        commit: rs.fn(() => {}),
        pickPoint: rs.fn((_prompt: I18nKeys) => Promise.resolve(pointQueue.shift())),
        pickEntity: rs.fn((_prompt: I18nKeys, _type?: SketchEntityTypeFilter) =>
            Promise.resolve(entityQueue.shift()),
        ),
        pointQueue,
        entityQueue,
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

            expect(pub).toHaveBeenCalledWith("displayError", expect.any(String));
            expect(editor.solver.toData().constraints).toEqual([]);
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

            expect(pub).toHaveBeenCalledWith("displayError", expect.any(String));
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

    test("two lines pub an error without a constraint", async () => {
        const editor = fakeEditor();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            const l1 = editor.solver.addLine(0, 0, 10, 0);
            const l2 = editor.solver.addLine(0, 5, 10, 5);
            editor.entityQueue.push(l1, l2);

            await runCommand(new TangentConstraintCommand(), editor);

            expect(pub).toHaveBeenCalledWith("displayError", expect.any(String));
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

            expect(pub).toHaveBeenCalledWith("statusBarTip", "sketch.constraintExists");
            expect(constraintsOf(editor, ConstraintKind.Parallel).length).toBe(1);
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
