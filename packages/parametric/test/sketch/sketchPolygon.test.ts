// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { CommandStore, Plane, Precision, PubSub, XYZ } from "@chili3d/core";
import { createMockShape, setupShapeFactoryMock } from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import {
    addRegularPolygon,
    regularPolygonLayout,
    regularPolygonVertices,
    SketchPolygonCommand,
} from "../../src/sketch/commands/sketchPolygon";
import { SketchEditor } from "../../src/sketch/editor/sketchEditor";
import {
    ConstraintKind,
    isStructuralConstraint,
    profileEntities,
    type SketchPointRef,
} from "../../src/sketch/sketchModel";
import { SketchSolver } from "../../src/sketch/solver";
import { constraintTargetEntities } from "../../src/sketch/solverEntities";
import "./setup";

const SIDES = 6;
const CENTER: [number, number] = [0, 0];
const PICK: [number, number] = [10, 0];

function solverWithPolygon(
    sides = SIDES,
    circumscribed = false,
    picked: [number, number] = PICK,
): { solver: SketchSolver; lineIds: number[]; circleId: number; incircleId?: number } {
    const solver = new SketchSolver(Plane.XY);
    const layout = regularPolygonLayout(CENTER, picked, sides, circumscribed);
    return { solver, ...addRegularPolygon(solver, layout) };
}

/** The vertex at `pointIndex` 0 of every edge, i.e. each vertex of the loop once. */
function verticesOf(solver: SketchSolver, lineIds: number[]): [number, number][] {
    return lineIds.map((id) => solver.pointOf({ entityId: id, pointIndex: 0 }));
}

function distance(a: [number, number], b: [number, number]): number {
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** The id of the solver's construction circle; a missing one is the failure, not undefined. */
function circleIdOf(solver: SketchSolver): number {
    const circle = solver.entities().find((entity) => entity.type === "circle");
    if (circle === undefined) throw new Error("the polygon has no carrier circle");
    return circle.id;
}

/** How far the line is from being tangent to the circle: |distance(center, line) − radius|. */
function tangencyGap(solver: SketchSolver, lineId: number, circleId: number): number {
    const [x1, y1] = solver.pointOf({ entityId: lineId, pointIndex: 0 });
    const [x2, y2] = solver.pointOf({ entityId: lineId, pointIndex: 1 });
    const [cx, cy] = solver.pointOf({ entityId: circleId, pointIndex: 0 });
    const radius = solver.entity(circleId)?.params[2];
    if (radius === undefined) throw new Error(`no circle entity ${circleId}`);
    const distance = Math.abs((x2 - x1) * (cy - y1) - (y2 - y1) * (cx - x1)) / Math.hypot(x2 - x1, y2 - y1);
    return Math.abs(distance - radius);
}

/** Every pair of values agrees to `digits` — the shape is as regular as it should be. */
function expectAllEqual(values: number[], digits = 6): void {
    for (const value of values) expect(value).toBeCloseTo(values[0], digits);
}

describe("regularPolygonLayout", () => {
    test("inscribed reads the pick as the circumradius and the first vertex's angle", () => {
        expect(regularPolygonLayout(CENTER, [0, 7], 4, false)).toEqual({
            center: CENTER,
            circumradius: 7,
            first: Math.PI / 2,
            sides: 4,
        });
    });

    test("circumscribed reads the pick as the apothem and backs half a step off it", () => {
        const layout = regularPolygonLayout(CENTER, [10, 0], 4, true);

        expect(layout.circumradius).toBeCloseTo((10 * 2) / Math.SQRT2, 12);
        expect(layout.incircle).toBe(10);
        expect(layout.first).toBeCloseTo(-Math.PI / 4, 12);
    });

    test("circumscribed keeps the circumradius off a general pick direction", () => {
        const sides = 5;
        const layout = regularPolygonLayout(CENTER, [0, 3], sides, true);

        expect(layout.circumradius).toBeCloseTo(3 / Math.cos(Math.PI / sides), 12);
        expect(layout.incircle).toBe(3);
        expect(layout.first).toBeCloseTo(Math.PI / 2 - Math.PI / sides, 12);
    });

    test("inscribed has no incircle — its pick is already the carrier's radius", () => {
        expect(regularPolygonLayout(CENTER, [10, 0], 4, false).incircle).toBeUndefined();
    });
});

describe("regularPolygonVertices", () => {
    test("lays the vertices evenly on the circumradius, closed by the edge list", () => {
        const sides = 5;
        const layout = regularPolygonLayout(CENTER, [4, 0], sides, false);
        const vertices = regularPolygonVertices(layout);

        expect(vertices).toHaveLength(sides);
        for (const [u, v] of vertices) expect(Math.hypot(u, v)).toBeCloseTo(4, 12);
        // consecutive radii differ by exactly one step, read as the shortest sweep so
        // the atan2 wrap at ±π cannot show up as a two-step jump
        const angles = vertices.map(([u, v]) => Math.atan2(v, u));
        for (let i = 1; i < sides; i++) {
            const delta = angles[i] - angles[i - 1];
            const sweep = Math.atan2(Math.sin(delta), Math.cos(delta));
            expect(sweep).toBeCloseTo((Math.PI * 2) / sides, 12);
        }
    });
});

describe("addRegularPolygon", () => {
    test("adds N lines and one construction circle", () => {
        const { solver, lineIds, circleId } = solverWithPolygon();

        expect(lineIds).toHaveLength(SIDES);
        expect(solver.entity(circleId)?.type).toBe("circle");
        expect(solver.isConstruction(circleId)).toBe(true);
        expect(solver.entities()).toHaveLength(SIDES + 1);
        solver.dispose();
    });

    test("closes the loop, pins every vertex on the circle and equalizes the edges", () => {
        const { solver, circleId } = solverWithPolygon();
        const kinds = solver.toData().constraints.map((c) => c.kind);

        expect(kinds.filter((k) => k === ConstraintKind.P2PCoincident)).toHaveLength(SIDES);
        expect(kinds.filter((k) => k === ConstraintKind.PointOnCircle)).toHaveLength(SIDES);
        expect(kinds.filter((k) => k === ConstraintKind.EqualLength)).toHaveLength(SIDES - 1);

        for (const ref of solver
            .toData()
            .constraints.filter((c) => c.kind === ConstraintKind.PointOnCircle)) {
            expect(ref.refs[1]).toEqual({ entityId: circleId, pointIndex: 0 });
        }
        solver.dispose();
    });

    test("inscribed puts the first vertex on the pick direction at the picked distance", () => {
        const { solver, lineIds } = solverWithPolygon(SIDES, false, [0, 10]);
        const first = verticesOf(solver, lineIds)[0];

        expect(first[0]).toBeCloseTo(0, 9);
        expect(first[1]).toBeCloseTo(10, 9);
        solver.dispose();
    });

    test("circumscribed puts the first edge's midpoint on the pick direction", () => {
        const sides = 4;
        const { solver, lineIds } = solverWithPolygon(sides, true, [10, 0]);
        const vertices = verticesOf(solver, lineIds);
        // the edge between vertex 0 and vertex 1 — its midpoint lies on the apothem
        const mid: [number, number] = [
            (vertices[0][0] + vertices[1][0]) / 2,
            (vertices[0][1] + vertices[1][1]) / 2,
        ];

        expect(mid[0]).toBeCloseTo(10, 9);
        expect(mid[1]).toBeCloseTo(0, 9);
        solver.dispose();
    });
});

describe("circumscribed mode's picked circle", () => {
    test("adds the picked circle alongside the carrier through the vertices", () => {
        const picked = 25;
        const { solver, circleId, incircleId } = solverWithPolygon(SIDES, true, [0, picked]);

        expect(incircleId).toBeDefined();
        expect(solver.entity(incircleId!)?.params[2]).toBeCloseTo(picked, 9);
        // both circles are ordinary construction geometry: drawn, pickable, deletable
        expect(solver.isConstruction(circleId)).toBe(true);
        expect(solver.isConstruction(incircleId!)).toBe(true);
        const targets = constraintTargetEntities(solver).map((e) => e.id);
        expect(targets).toContain(circleId);
        expect(targets).toContain(incircleId!);
        expect(solver.entities()).toHaveLength(SIDES + 2);
        solver.dispose();
    });

    test("inscribed has only the one circle, and it is construction", () => {
        const { solver, circleId, incircleId } = solverWithPolygon(SIDES, false);

        expect(incircleId).toBeUndefined();
        expect(solver.isConstruction(circleId)).toBe(true);
        expect(constraintTargetEntities(solver).map((e) => e.id)).toContain(circleId);
        expect(solver.entities()).toHaveLength(SIDES + 1);
        solver.dispose();
    });

    test("pins the picked circle tangent to three edges, and it is tangent to them all", () => {
        const sides = 6;
        const picked = 30;
        const { solver, lineIds, incircleId } = solverWithPolygon(sides, true, [0, picked]);
        const tangencies = solver
            .toData()
            .constraints.filter((c) => c.kind === ConstraintKind.TangentLineCircle);

        // three, spread out: the circle's three unknowns take exactly three equations
        expect(tangencies).toHaveLength(3);
        const constrained = new Set(tangencies.map((c) => c.refs[0].entityId));
        expect(constrained.size).toBe(3);
        expect(lineIds.filter((id) => constrained.has(id)).map((id) => lineIds.indexOf(id))).toEqual([
            0, 2, 4,
        ]);

        // every edge, not just the pinned three, is tangent — a regular polygon has one incircle
        expect(Math.max(...lineIds.map((id) => tangencyGap(solver, id, incircleId!)))).toBeLessThan(1e-8);
        solver.dispose();
    });

    test("every polygon constraint is an ordinary user constraint, not a structural one", () => {
        const { solver, lineIds, circleId, incircleId } = solverWithPolygon(SIDES, true);
        const [onCarrier] = solver
            .toData()
            .constraints.filter((c) => c.kind === ConstraintKind.PointOnCircle);
        const [onPicked] = solver
            .toData()
            .constraints.filter((c) => c.kind === ConstraintKind.TangentLineCircle);

        // only the arc's self-referential PointOnArc is structural; every polygon
        // constraint names two visible entities, so it is shown and deletable
        expect(isStructuralConstraint(onCarrier)).toBe(false);
        expect(isStructuralConstraint(onPicked)).toBe(false);
        expect(circleId).toBeDefined();
        expect(incircleId).toBeDefined();
        expect(lineIds).toHaveLength(SIDES);
        solver.dispose();
    });

    test("the carrier survives a round trip as ordinary construction geometry", () => {
        const { solver, circleId } = solverWithPolygon(SIDES, true);
        const data = solver.toData();
        const reloaded = new SketchSolver(Plane.XY, data);
        const carrier = data.entities.find((entity) => entity.id === circleId);

        expect(carrier).toBeDefined();
        expect(carrier!.construction).toBe(true);
        // the internal flag is gone from the format entirely
        expect("internal" in carrier!).toBe(false);
        expect(reloaded.isConstruction(circleId)).toBe(true);
        reloaded.dispose();
        solver.dispose();
    });

    test("neither circle builds a profile — only the N edges do", () => {
        const { solver, lineIds, circleId, incircleId } = solverWithPolygon(SIDES, true);
        const profiles = profileEntities(solver.toData()).map((e) => e.id);

        expect(profiles).toHaveLength(SIDES);
        expect(profiles).not.toContain(circleId);
        expect(profiles).not.toContain(incircleId);
        expect(new Set(profiles)).toEqual(new Set(lineIds));
        solver.dispose();
    });

    test.each([
        false,
        true,
    ])("deleting every edge leaves no ghost the user cannot remove (%s)", (circumscribed) => {
        const { solver, lineIds } = solverWithPolygon(SIDES, circumscribed);
        for (const id of lineIds) solver.removeEntity(id);

        // the circles outlive the edges; each must stay a pick target, or the sketch
        // could never be cleaned back to dofs 0
        const survivors = solver.entities().map((entity) => entity.id);
        expect(survivors).toHaveLength(circumscribed ? 2 : 1);
        const targets = new Set(constraintTargetEntities(solver).map((entity) => entity.id));
        for (const id of survivors) expect(targets.has(id)).toBe(true);

        // and each is genuinely removable, leaving nothing eating dofs forever
        for (const id of survivors) solver.removeEntity(id);
        expect(solver.entities()).toEqual([]);
        solver.solve(true);
        expect(solver.diagnose().dofs).toBe(0);
        solver.dispose();
    });
});

describe("polygon rigidity", () => {
    test.each([
        { sides: 3, circumscribed: false },
        { sides: 6, circumscribed: true },
    ])("the constraint set carries no redundancy at a regular $sides-gon (circumscribed $circumscribed)", ({
        sides,
        circumscribed,
    }) => {
        const { solver } = solverWithPolygon(sides, circumscribed);
        solver.solve(true);

        expect(solver.diagnose().redundant).toEqual([]);
        solver.dispose();
    });

    test.each([false, true])("dragging a vertex keeps it regular (circumscribed %s)", (circumscribed) => {
        const sides = 6;
        const { solver, lineIds, circleId, incircleId } = solverWithPolygon(sides, circumscribed);
        solver.solve(true);

        const dragged: SketchPointRef = { entityId: lineIds[0], pointIndex: 0 };
        solver.beginDrag([dragged]);
        solver.dragTo(dragged, 18, 4);
        solver.endDrag();

        const center = solver.pointOf({ entityId: circleId, pointIndex: 0 });
        const vertices = verticesOf(solver, lineIds);
        // every vertex still sits on the construction circle, at the same radius
        expectAllEqual(
            vertices.map((vertex) => distance(center, vertex)),
            6,
        );
        // every edge is still the same length
        expectAllEqual(
            lineIds.map((id) => {
                const start = solver.pointOf({ entityId: id, pointIndex: 0 });
                const end = solver.pointOf({ entityId: id, pointIndex: 1 });
                return distance(start, end);
            }),
            6,
        );
        // and the vertices are still evenly spaced around the center
        const angles = vertices.map(([u, v]) => Math.atan2(v - center[1], u - center[0]));
        for (let i = 0; i < sides; i++) {
            const next = angles[(i + 1) % sides];
            // the signed shortest sweep, so the atan2 wrap at ±π cannot read as a huge step
            const sweep = Math.atan2(Math.sin(next - angles[i]), Math.cos(next - angles[i]));
            expect(sweep).toBeCloseTo((Math.PI * 2) / sides, 6);
        }
        // circumscribed: the picked circle followed the polygon instead of drifting off it
        if (incircleId !== undefined) {
            expect(Math.max(...lineIds.map((id) => tangencyGap(solver, id, incircleId)))).toBeLessThan(1e-6);
        }
        solver.dispose();
    });
});

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

describe("SketchPolygonCommand", () => {
    test("is registered under the key the ribbon's draw group names", () => {
        const data = CommandStore.getComandData("sketch.polygon");

        expect(data).toBeDefined();
        expect(data!.icon).toBe("icon-polygon");
    });

    test("builds the polygon from the two picks and commits once", () => {
        const editor = fakeEditor();
        const command = new SketchPolygonCommand();
        command.sides = 5;
        runCommand(command, editor, [CENTER, PICK]);

        expect(editor.solver.entities()).toHaveLength(6);
        expect(editor.solve).toHaveBeenCalledWith(true);
        expect(editor.commit).toHaveBeenCalledTimes(1);
        editor.solver.dispose();
    });

    test("construction mode turns the polygon's edges — never the carrier circle — into construction", () => {
        const editor = fakeEditor();
        const command = new SketchPolygonCommand();
        command.construction = true;
        runCommand(command, editor, [CENTER, PICK]);

        const lines = editor.solver.entities().filter((e) => e.type === "line");
        expect(lines).toHaveLength(SIDES);
        expect(editor.solver.isConstruction(circleIdOf(editor.solver))).toBe(true);
        expect(lines.every((line) => editor.solver.isConstruction(line.id))).toBe(true);
        editor.solver.dispose();
    });

    test("refuses a polygon whose circumradius is degenerate", () => {
        const editor = fakeEditor();
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            runCommand(new SketchPolygonCommand(), editor, [CENTER, [Precision.Distance / 2, 0]]);

            expect(pub).toHaveBeenCalledWith("displayError", expect.any(String));
            expect(editor.solver.entities()).toEqual([]);
            expect(editor.commit).not.toHaveBeenCalled();
        } finally {
            pub.mockRestore();
            editor.solver.dispose();
        }
    });

    test("the sides option floors decimals and refuses fewer than three", () => {
        const command = new SketchPolygonCommand();

        command.sides = 4.7;
        expect(command.sides).toBe(4);
        command.sides = 2;
        expect(command.sides).toBe(4);
    });

    test("previews the polygon, its side edges, its radius line and the carrier circle", () => {
        setupShapeFactoryMock({ circle: () => createMockShape() });
        const command = new SketchPolygonCommand();
        const editor = fakeEditor();
        const getActive = rs.spyOn(SketchEditor, "getActive").mockReturnValue(editor as any);
        try {
            (command as any).stepDatas = [{ point: new XYZ({ x: 0, y: 0, z: 0 }) }];
            const data = (command as any).getSteps()[1].handleStepData();

            expect(data.refPoint()).toEqual(new XYZ({ x: 0, y: 0, z: 0 }));
            // marker + radius line + N edges + the construction circle
            expect(data.preview(new XYZ({ x: 10, y: 0, z: 0 }))).toHaveLength(3 + SIDES);
            expect(data.preview(undefined)).toHaveLength(1);
        } finally {
            getActive.mockRestore();
            editor.solver.dispose();
        }
    });
});
