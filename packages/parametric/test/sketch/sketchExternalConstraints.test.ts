// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type I18nKeys, type ICommand, Plane, PubSub } from "@chili3d/core";
import { rs } from "@rstest/core";
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
import { SketchEditor, type SketchEntityTypeFilter } from "../../src/sketch/editor/sketchEditor";
import {
    ConstraintKind,
    type ExternalRefData,
    SKETCH_X_AXIS_ID,
    type SketchPointRef,
} from "../../src/sketch/sketchModel";
import { SketchSolver } from "../../src/sketch/solver";
import {
    allowsConstraintOnEntity,
    constraintTargetEntities,
    isAssociativeConstraintKind,
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
    return {
        node: { plane: Plane.XY },
        solver,
        annotations: { setDimensionPreview: rs.fn(() => {}) },
        solve: rs.fn((_fine: boolean) => {}),
        commit: rs.fn(() => {}),
        pickPoint: rs.fn((_prompt: I18nKeys) => Promise.resolve(pointQueue.shift())),
        pickEntity: rs.fn((_prompt: I18nKeys, _type?: SketchEntityTypeFilter) =>
            Promise.resolve(entityQueue.shift()),
        ),
        pickPosition: rs.fn((_prompt: I18nKeys) => Promise.resolve(undefined)),
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

const ref = (entityId: number, pointIndex: number): SketchPointRef => ({ entityId, pointIndex });

const REJECTION_TIP: [string, string] = ["statusBarTip", "sketch.externalRefAssociativeOnly"];

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
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            // real entities accept any kind
            expect(allowsConstraintOnEntity(ConstraintKind.Horizontal, 3)).toBe(true);
            // datum entities (axes/origin) are not external and stay untouched
            expect(allowsConstraintOnEntity(ConstraintKind.Angle, SKETCH_X_AXIS_ID)).toBe(true);
            expect(pub).not.toHaveBeenCalled();

            expect(allowsConstraintOnEntity(ConstraintKind.Horizontal, -100)).toBe(false);
            expect(pub).toHaveBeenCalledWith(...REJECTION_TIP);
            pub.mockClear();

            // associative kinds still target external entities
            expect(allowsConstraintOnEntity(ConstraintKind.Parallel, -100)).toBe(true);
            expect(allowsConstraintOnEntity(ConstraintKind.PointOnLine, -100)).toBe(true);
            expect(pub).not.toHaveBeenCalled();
        } finally {
            pub.mockRestore();
        }
    });
});

describe("non-associative constraint commands reject external references", () => {
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
            editor.entityQueue.push(EXT_LINE.entityId);

            await expectRejection(command(), editor, kind);
        } finally {
            editor.solver.dispose();
        }
    });

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
    ])("$name on an external point pubs the tip and adds nothing", async ({ command, kind }) => {
        const editor = fakeEditor();
        try {
            editor.pointQueue.push(ref(EXT_LINE.entityId, 0));

            await expectRejection(command(), editor, kind);
        } finally {
            editor.solver.dispose();
        }
    });

    test("fix on an external point pubs the tip and adds nothing", async () => {
        const editor = fakeEditor();
        try {
            editor.pointQueue.push(ref(EXT_LINE.entityId, 0));

            await expectRejection(new FixConstraintCommand(), editor, ConstraintKind.Fix);
        } finally {
            editor.solver.dispose();
        }
    });

    test("midpoint with an external line pubs the tip and adds nothing", async () => {
        const editor = fakeEditor();
        try {
            const line = editor.solver.addLine(5, 5, 15, 5);
            editor.pointQueue.push(ref(line, 0));
            editor.entityQueue.push(EXT_LINE.entityId);

            await expectRejection(new MidpointConstraintCommand(), editor, ConstraintKind.Midpoint);
        } finally {
            editor.solver.dispose();
        }
    });

    test("symmetric about an external line pubs the tip and adds nothing", async () => {
        const editor = fakeEditor();
        try {
            const line = editor.solver.addLine(5, 5, 15, 5);
            editor.pointQueue.push(ref(line, 0), ref(line, 1));
            editor.entityQueue.push(EXT_LINE.entityId);

            await expectRejection(new SymmetricConstraintCommand(), editor, ConstraintKind.Symmetric);
        } finally {
            editor.solver.dispose();
        }
    });
});

describe("non-associative dimension commands reject external references", () => {
    test("radius on an external circle pubs the tip and adds nothing", async () => {
        const editor = fakeEditor();
        try {
            editor.entityQueue.push(EXT_CIRCLE.entityId);

            await expectRejection(new RadiusDimensionCommand(), editor, ConstraintKind.Radius);
        } finally {
            editor.solver.dispose();
        }
    });

    test("distance to an external point pubs the tip and adds nothing", async () => {
        const editor = fakeEditor();
        try {
            const line = editor.solver.addLine(5, 5, 15, 5);
            editor.pointQueue.push(ref(line, 0), ref(EXT_LINE.entityId, 0));

            await expectRejection(new DistanceDimensionCommand(), editor, ConstraintKind.P2PDistance);
        } finally {
            editor.solver.dispose();
        }
    });

    test("point-line distance with an external line pubs the tip and adds nothing", async () => {
        const editor = fakeEditor();
        try {
            const line = editor.solver.addLine(5, 5, 15, 5);
            editor.pointQueue.push(ref(line, 0));
            editor.entityQueue.push(EXT_LINE.entityId);

            await expectRejection(new PointLineDistanceCommand(), editor, ConstraintKind.P2LDistance);
        } finally {
            editor.solver.dispose();
        }
    });

    test("angle with an external second line pubs the tip and adds nothing", async () => {
        const editor = fakeEditor();
        try {
            const line = editor.solver.addLine(5, 5, 15, 5);
            editor.entityQueue.push(line, EXT_LINE.entityId);

            await expectRejection(new AngleDimensionCommand(), editor, ConstraintKind.Angle);
        } finally {
            editor.solver.dispose();
        }
    });

    test.each([
        {
            name: "horizontalDistance",
            command: () => new HorizontalDistanceCommand(),
            kind: ConstraintKind.HorizontalDistance,
        },
        {
            name: "verticalDistance",
            command: () => new VerticalDistanceCommand(),
            kind: ConstraintKind.VerticalDistance,
        },
    ])("$name to an external point pubs the tip and adds nothing", async ({ command, kind }) => {
        const editor = fakeEditor();
        try {
            const line = editor.solver.addLine(5, 5, 15, 5);
            editor.pointQueue.push(ref(line, 0), ref(EXT_LINE.entityId, 0));

            await expectRejection(command(), editor, kind);
        } finally {
            editor.solver.dispose();
        }
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
