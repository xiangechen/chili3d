// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    EMPTY_SCOPE,
    type ICameraController,
    LENGTH_UNITS,
    Plane,
    PubSub,
    Result,
    type Scope,
    XYZ,
} from "@chili3d/core";
import {
    createMockApplication,
    createMockView,
    createMockVisualWithDocument,
    TestDocument,
} from "@chili3d/core/test-utils";
import { rs } from "@rstest/core";
import { ToggleDrivenConstraintCommand } from "../../src/sketch/commands/sketchConstraints";
import { SketchEditor } from "../../src/sketch/editor/sketchEditor";
import { ConstraintKind, type SketchConstraintData, type SketchPointRef } from "../../src/sketch/sketchModel";
import { SketchNode } from "../../src/sketch/sketchNode";
import { SketchSolver } from "../../src/sketch/solver";
import "./setup";

const ref = (entityId: number, pointIndex: number): SketchPointRef => ({ entityId, pointIndex });

/** A horizontal line with one driving length dimension — the setup a reference reads off. */
function setup() {
    const solver = new SketchSolver(Plane.XY);
    const line = solver.addLine(0, 0, 100, 0);
    const refs = [ref(line, 0), ref(line, 1)];
    const horizontal = solver.addConstraint({ kind: ConstraintKind.Horizontal, refs });
    const dimension = solver.addConstraint({
        kind: ConstraintKind.P2PDistance,
        refs,
        datum: 100,
    });
    solver.solve(true);
    return { solver, line, refs, horizontal, dimension };
}

function constraintOf(solver: SketchSolver, id: number): SketchConstraintData {
    const constraint = solver.toData().constraints.find((c) => c.id === id);
    expect(constraint).toBeDefined();
    return constraint as SketchConstraintData;
}

/** The length the sketch is actually at, read off the geometry rather than off a datum. */
function measuredLength(solver: SketchSolver, refs: SketchPointRef[]): number {
    const [a, b] = [solver.pointOf(refs[0]), solver.pointOf(refs[1])];
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

describe("a driven dimension", () => {
    test("measures the geometry without constraining it", () => {
        const { solver, refs, dimension } = setup();
        try {
            // take the driving dimension out of the equation first, so what is left
            // to move is the geometry alone
            expect(solver.setDriven(dimension, true)).toBe(true);
            solver.solve(true);
            const free = solver.dofs();

            // a second one over the same edges costs no degree of freedom: garlic solves
            // around a driven constraint rather than with it
            solver.addConstraint({ kind: ConstraintKind.P2PDistance, refs, datum: 100, driven: true });
            solver.solve(true);
            expect(solver.dofs()).toBe(free);
            expect(constraintOf(solver, dimension).driven).toBe(true);
        } finally {
            solver.dispose();
        }
    });

    test("follows the geometry: the solve writes its datum back", () => {
        const { solver, line, refs, dimension } = setup();
        try {
            solver.setDriven(dimension, true);
            solver.solve(true);

            // the dimension stops driving, so the geometry is free to move — and the
            // value it reports is whatever the geometry became, not the 100 it started at
            solver.setPointPosition(ref(line, 1), 140, 0);
            solver.solve(true);
            expect(measuredLength(solver, refs)).toBeCloseTo(140, 6);
            expect(constraintOf(solver, dimension).datum).toBeCloseTo(140, 6);
        } finally {
            solver.dispose();
        }
    });

    test("a parameter edit does not push it back to its old measurement", () => {
        const { solver, line, dimension } = setup();
        try {
            solver.setDriven(dimension, true);
            solver.solve(true);
            solver.setPointPosition(ref(line, 1), 140, 0);
            solver.solve(true);
            expect(constraintOf(solver, dimension).datum).toBeCloseTo(140, 6);

            // re-resolving the parameters rewrites every datum that the user drives; a
            // driven one is not the user's to drive, so the measurement must stand
            expect(solver.setScope(EMPTY_SCOPE)).toBe(false);
            expect(constraintOf(solver, dimension).datum).toBeCloseTo(140, 6);
        } finally {
            solver.dispose();
        }
    });

    test("is not a constraint, so it is never reported as one", () => {
        const { solver, dimension } = setup();
        try {
            solver.setDriven(dimension, true);
            solver.solve(true);

            const report = solver.diagnose();
            expect(report.conflicting).toEqual([]);
            expect(report.redundant).toEqual([]);
        } finally {
            solver.dispose();
        }
    });

    test("refuses a datum written into it — a reference is read-only", () => {
        const { solver, dimension } = setup();
        try {
            solver.setDriven(dimension, true);
            solver.solve(true);

            const refused = solver.setDatumSource(dimension, 50);
            expect(refused.isOk).toBe(false);
            solver.solve(true);
            // and the value it reports is still the geometry's
            expect(constraintOf(solver, dimension).datum).toBeCloseTo(100, 6);
        } finally {
            solver.dispose();
        }
    });

    test("goes back to driving with the value it was reading", () => {
        const { solver, line, refs, dimension } = setup();
        try {
            solver.setDriven(dimension, true);
            solver.solve(true);
            solver.setPointPosition(ref(line, 1), 140, 0);
            solver.solve(true);
            const free = solver.dofs();

            expect(solver.setDriven(dimension, false)).toBe(true);
            solver.solve(true);

            // driving again: it holds the length it was measuring, and takes the dof back
            expect(constraintOf(solver, dimension).driven).toBeUndefined();
            expect(solver.dofs()).toBe(free - 1);
            expect(measuredLength(solver, refs)).toBeCloseTo(140, 6);
        } finally {
            solver.dispose();
        }
    });

    test("keeps its id, its refs and its reading across the round trip", () => {
        const { solver, refs, dimension } = setup();
        try {
            solver.setDriven(dimension, true);
            solver.solve(true);
            const asDriven = constraintOf(solver, dimension);
            expect(asDriven.id).toBe(dimension);
            expect(asDriven.refs).toEqual(refs);
            expect(asDriven.datum).toBeCloseTo(100, 6);
        } finally {
            solver.dispose();
        }
    });

    test("reports nothing to change when it is already in that mode", () => {
        const { solver, dimension } = setup();
        try {
            expect(solver.setDriven(dimension, false)).toBe(false);
            expect(solver.setDriven(dimension, true)).toBe(true);
            expect(solver.setDriven(dimension, true)).toBe(false);
        } finally {
            solver.dispose();
        }
    });

    test("a constraint with no datum cannot be driven — garlic refuses the mode", () => {
        const { solver, horizontal } = setup();
        try {
            expect(solver.setDriven(horizontal, true)).toBe(false);
            expect(constraintOf(solver, horizontal).driven).toBeUndefined();
        } finally {
            solver.dispose();
        }
    });

    test("a pin cannot be driven — the point would come loose instead of being measured", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const line = solver.addLine(0, 0, 100, 0);
            const pin = solver.addConstraint({
                kind: ConstraintKind.Fix,
                refs: [ref(line, 0)],
                datums: [...solver.pointOf(ref(line, 0))],
            });
            solver.solve(true);
            const pinned = solver.dofs();

            // A Fix carries datums — its coordinates — so it passes every structural "has a
            // datum" test, and garlic takes it as a reference without complaint. What comes
            // back is not a measurement of anything: it is the pin's two degrees of freedom.
            expect(solver.setDriven(pin, true)).toBe(false);
            solver.solve(true);
            expect(solver.dofs()).toBe(pinned);
            expect(constraintOf(solver, pin).driven).toBeUndefined();
        } finally {
            solver.dispose();
        }
    });

    test("an expression is the user's, so a round trip through a reference keeps it", () => {
        const scope = (w: number): Scope => new Map([["w", { value: w, unit: LENGTH_UNITS }]]);
        const solver = new SketchSolver(Plane.XY, undefined, scope(10));
        try {
            const line = solver.addLine(0, 0, 10, 0);
            const refs = [ref(line, 0), ref(line, 1)];
            const dimension = solver.addConstraint({
                kind: ConstraintKind.P2PDistance,
                refs,
                datum: 20,
            });
            solver.solve(true);
            expect(solver.setDatumSource(dimension, "w * 2").isOk).toBe(true);
            solver.solve(true);

            solver.setDriven(dimension, true);
            solver.solve(true);
            // a reference reads the geometry: the number is the measurement, not the expression
            expect(constraintOf(solver, dimension).datum).toBeCloseTo(20, 6);

            solver.setDriven(dimension, false);
            solver.solve(true);
            expect(constraintOf(solver, dimension).datum).toBe("w * 2");

            // and it is still the expression, not a snapshot of what it once evaluated to
            expect(solver.setScope(scope(30))).toBe(true);
            solver.solve(true);
            expect(measuredLength(solver, refs)).toBeCloseTo(60, 6);
        } finally {
            solver.dispose();
        }
    });

    test("survives a reload: the flag and the value are both persisted", () => {
        const { solver, dimension } = setup();
        try {
            solver.setDriven(dimension, true);
            solver.solve(true);
            const data = solver.toData();

            const reloaded = new SketchSolver(Plane.XY, data);
            try {
                const constraint = constraintOf(reloaded, dimension);
                expect(constraint.driven).toBe(true);
                expect(constraint.datum).toBeCloseTo(100, 6);
                // ...and it comes back as a reference rather than a constraint: reloading
                // must not quietly turn a measurement into a lock
                reloaded.solve(true);
                expect(reloaded.dofs()).toBe(solver.dofs());
            } finally {
                reloaded.dispose();
            }
        } finally {
            solver.dispose();
        }
    });

    test("mixed with a driving dimension on the same edges, neither blocks the other", () => {
        const { solver, refs, dimension } = setup();
        try {
            solver.setDriven(dimension, true);
            solver.solve(true);

            // the driving one is free to restate what the reference is measuring; a
            // reference is not a duplicate of anything, which is the point of one
            const second = solver.addConstraint({
                kind: ConstraintKind.P2PDistance,
                refs,
                datum: 100,
            });
            solver.solve(true);
            expect(constraintOf(solver, second).driven).toBeUndefined();
            expect(constraintOf(solver, dimension).driven).toBe(true);
        } finally {
            solver.dispose();
        }
    });
});
/**
 * A live sketch session, for the tests that go through the editor and the command rather
 * than the solver alone: the badges refresh on every solve, so the view needs the pieces
 * an annotation manager reaches for.
 */
function setupEditor() {
    const camera = {
        cameraPosition: new XYZ({ x: 0, y: 0, z: 500 }),
        cameraTarget: XYZ.zero,
        cameraUp: XYZ.unitY,
        cameraType: "perspective" as "perspective" | "orthographic",
        lookAt: rs.fn(),
        fitContent: rs.fn(),
    };
    const app = createMockApplication();
    const doc = new TestDocument({ application: app, selection: { clearSelection: rs.fn() } as any });
    doc.visual = createMockVisualWithDocument(doc) as any;
    const view = createMockView({ document: doc, cameraController: camera as unknown as ICameraController });
    (app as any).activeView = view;
    (view as any).htmlText = rs.fn(() => ({ dispose: rs.fn() }));
    (doc.visual.context as any).displayMesh = rs.fn(() => 1);
    (doc.visual.context as any).removeMesh = rs.fn();

    const previous = Object.getOwnPropertyDescriptor(globalThis, "shapeFactory");
    Object.defineProperty(globalThis, "shapeFactory", {
        value: {
            line: () => Result.ok({ isEqual: () => false }),
            circle: () => Result.ok({ isEqual: () => false }),
            arc: () => Result.ok({ isEqual: () => false }),
            wire: () => Result.ok({ isEqual: () => false }),
            combine: () => Result.ok({ isEqual: () => false }),
        },
        writable: true,
        configurable: true,
    });

    return {
        app,
        doc,
        view,
        restoreFactory: () => {
            if (previous) Object.defineProperty(globalThis, "shapeFactory", previous);
            else delete (globalThis as any).shapeFactory;
        },
    };
}

describe("ToggleDrivenConstraintCommand", () => {
    /** A line with a driving length dimension, and nothing selected yet. */
    function setupDimension() {
        const ctx = setupEditor();
        const node = new SketchNode({ document: ctx.doc, plane: Plane.XY });
        const editor = SketchEditor.enter(node);
        editor.solver.addLine(0, 0, 100, 0);
        const refs = [
            { entityId: 1, pointIndex: 0 },
            { entityId: 1, pointIndex: 1 },
        ];
        const horizontal = editor.solver.addConstraint({ kind: ConstraintKind.Horizontal, refs });
        const dimension = editor.solver.addConstraint({
            kind: ConstraintKind.P2PDistance,
            refs,
            datum: 100,
        });
        editor.solve(true);
        return { ...ctx, node, editor, horizontal, dimension };
    }

    const tips: string[] = [];
    const onTip = (key: string) => tips.push(key);

    /**
     * Subscribes only once the session is up: building it solves, and the solve publishes
     * its own status tips (`sketch.dofs{0}` and friends), which are not what is under test.
     */
    function setupWithTips() {
        tips.length = 0;
        const ctx = setupDimension();
        PubSub.default.sub("statusBarTip", onTip);
        return ctx;
    }

    test("the selected dimension becomes a reference, freeing its degree of freedom", async () => {
        const { app, editor, dimension, restoreFactory } = setupWithTips();
        try {
            const constrained = editor.solver.dofs();
            editor.annotations.selectConstraints([dimension]);

            await new ToggleDrivenConstraintCommand().execute(app);
            expect(editor.solver.toData().constraints.find((c) => c.id === dimension)?.driven).toBe(true);
            // it no longer holds the sketch: the geometry can move again, and the status
            // bar says so — the only thing the toggle reports
            expect(editor.solver.dofs()).toBe(constrained + 1);
            expect(tips).toContain("sketch.dofs{0}");
            expect(tips).not.toContain("sketch.drivenSelectDimension");
            editor.exit();
        } finally {
            PubSub.default.remove("statusBarTip", onTip);
            restoreFactory();
        }
    });

    test("running it again on the reference turns it back into a dimension", async () => {
        const { app, editor, dimension, restoreFactory } = setupWithTips();
        try {
            editor.annotations.selectConstraints([dimension]);
            await new ToggleDrivenConstraintCommand().execute(app);
            const free = editor.solver.dofs();

            // the selection survives the toggle, so the second run is the same gesture
            expect(editor.annotations.selectedConstraintIds).toEqual([dimension]);
            await new ToggleDrivenConstraintCommand().execute(app);

            expect(
                editor.solver.toData().constraints.find((c) => c.id === dimension)?.driven,
            ).toBeUndefined();
            expect(editor.solver.dofs()).toBe(free - 1);
            editor.exit();
        } finally {
            PubSub.default.remove("statusBarTip", onTip);
            restoreFactory();
        }
    });

    test("a mixed selection converges on driven", async () => {
        const { app, editor, horizontal, dimension, restoreFactory } = setupWithTips();
        try {
            // one of each: the dimension is a reference, the alignment is not
            editor.solver.setDriven(dimension, true);
            editor.solve(true);
            const second = editor.solver.addConstraint({
                kind: ConstraintKind.P2PDistance,
                refs: [
                    { entityId: 1, pointIndex: 0 },
                    { entityId: 1, pointIndex: 1 },
                ],
                datum: 100,
            });
            editor.solve(true);
            editor.annotations.selectConstraints([dimension, second, horizontal]);

            await new ToggleDrivenConstraintCommand().execute(app);

            const constraints = editor.solver.toData().constraints;
            expect(constraints.find((c) => c.id === dimension)?.driven).toBe(true);
            expect(constraints.find((c) => c.id === second)?.driven).toBe(true);
            // a geometric constraint has no datum to write back, so it stays as it was
            expect(constraints.find((c) => c.id === horizontal)?.driven).toBeUndefined();
            editor.exit();
        } finally {
            PubSub.default.remove("statusBarTip", onTip);
            restoreFactory();
        }
    });

    test("nothing selected says what to select instead of doing nothing", async () => {
        const { app, editor, dimension, restoreFactory } = setupWithTips();
        try {
            await new ToggleDrivenConstraintCommand().execute(app);
            expect(tips).toEqual(["sketch.drivenSelectDimension"]);
            expect(
                editor.solver.toData().constraints.find((c) => c.id === dimension)?.driven,
            ).toBeUndefined();
            editor.exit();
        } finally {
            PubSub.default.remove("statusBarTip", onTip);
            restoreFactory();
        }
    });

    test("a selection of geometric constraints alone says the same thing", async () => {
        const { app, editor, horizontal, restoreFactory } = setupWithTips();
        try {
            editor.annotations.selectConstraints([horizontal]);
            await new ToggleDrivenConstraintCommand().execute(app);

            expect(tips).toEqual(["sketch.drivenSelectDimension"]);
            expect(
                editor.solver.toData().constraints.find((c) => c.id === horizontal)?.driven,
            ).toBeUndefined();
            editor.exit();
        } finally {
            PubSub.default.remove("statusBarTip", onTip);
            restoreFactory();
        }
    });

    test("a selected pin says it too, rather than quietly letting the point go", async () => {
        const { app, editor, restoreFactory } = setupWithTips();
        try {
            const pin = editor.solver.addConstraint({
                kind: ConstraintKind.Fix,
                refs: [{ entityId: 1, pointIndex: 0 }],
                datums: [...editor.solver.pointOf({ entityId: 1, pointIndex: 0 })],
            });
            editor.solve(true);
            // the pin's own solve reported a status of its own, and the session was already up
            // when it did; what this test is about is what the command goes on to say
            tips.length = 0;
            const pinned = editor.solver.dofs();
            editor.annotations.selectConstraints([pin]);

            await new ToggleDrivenConstraintCommand().execute(app);

            // a Fix wears its coordinates as `datums`, which is what a dimension wears as a
            // reading, so the selection has to be read through the kind rather than the shape
            expect(tips).toEqual(["sketch.drivenSelectDimension"]);
            expect(editor.solver.toData().constraints.find((c) => c.id === pin)?.driven).toBeUndefined();
            expect(editor.solver.dofs()).toBe(pinned);
            editor.exit();
        } finally {
            PubSub.default.remove("statusBarTip", onTip);
            restoreFactory();
        }
    });
});
