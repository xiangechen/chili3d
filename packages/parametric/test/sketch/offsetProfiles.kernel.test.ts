// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * An offset of a curve, built into geometry by the real kernel.
 *
 * The units say the copy *is* the parallel curve; this says the kernel agrees — that an
 * `offsetCurve` entity reaches `Geom_OffsetCurve` through the entity's own edge builder and
 * comes back as a real edge of the shape, one the profile builder and everything downstream
 * read like any other.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Plane, ShapeTypes } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { entityDomain, evaluateEntity } from "../../src/sketch/curveEval";
import { extendEntity } from "../../src/sketch/extendOps";
import { offsetEntities } from "../../src/sketch/offsetOps";
import { ConstraintKind } from "../../src/sketch/sketchModel";
import { SketchNode } from "../../src/sketch/sketchNode";
import { SketchSolver } from "../../src/sketch/solver";
import "./setup";

const WASM_BINARY = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../wasm/lib/chili-wasm.wasm"),
);

beforeAll(async () => {
    await initWasm({ wasmBinary: WASM_BINARY });
    Object.defineProperty(globalThis, "shapeFactory", {
        value: new ShapeFactory(),
        writable: true,
        configurable: true,
    });
});

function emptyDocument(): TestDocument {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    return doc;
}

function sketchNode(solver: SketchSolver): SketchNode {
    return new SketchNode({ document: emptyDocument(), plane: Plane.XY, data: solver.toData() });
}

/** The closed regions a sketch builds: its profile faces, meshed from the data. */
function profileFaces(sketch: SketchNode): number {
    return sketch.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face).length ?? 0;
}

/** A "D": a base line with a cubic bezier bulging back over it, the two joined at both ends. */
function bulge(solver: SketchSolver): [number, number] {
    const line = solver.addLine(0, 0, 12, 0);
    const curve = solver.addBezier([12, 0, 8, 6, 4, 6, 0, 0]);
    solver.addConstraint({
        kind: ConstraintKind.P2PCoincident,
        refs: [
            { entityId: line, pointIndex: 1 },
            { entityId: curve, pointIndex: 0 },
        ],
    });
    solver.addConstraint({
        kind: ConstraintKind.P2PCoincident,
        refs: [
            { entityId: curve, pointIndex: 3 },
            { entityId: line, pointIndex: 0 },
        ],
    });
    return [line, curve];
}

describe("a sketch offset over a curve", () => {
    test("builds the copy on the side the canvas draws it on", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            // a straight cubic along +x, so "left of its direction" is +y and the two readings
            // of the sign cannot be confused for one another
            const straight = solver.addBezier([0, 0, 4, 0, 8, 0, 12, 0]);
            solver.solve(true);
            const result = offsetEntities(solver, [straight], 1, 0.01);
            expect(result.isOk).toBe(true);
            if (!result.isOk) throw new Error(result.error);

            const copy = solver.entity(result.value.createdEntityIds[0])!;
            const drawn = evaluateEntity(copy, entityDomain(copy)[0]);

            const sketch = sketchNode(solver);
            expect(sketch.shape.isOk).toBe(true);
            const starts = (
                sketch.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as unknown as {
                    startPoint(): { x: number; y: number };
                }[]
            ).map((edge) => edge.startPoint());

            // The shape and the drawing have to agree. `offsetOps` measures a positive distance
            // along the source's *left*, while the kernel's own offset moves along the right of
            // the direction the edge runs in — a sign folded in the wrong way round lands the
            // built copy on the far side of its source, where nothing else can see it.
            const onCopy = starts.filter(
                (start) => Math.hypot(start.x - drawn[0], start.y - drawn[1]) < 1e-6,
            );
            expect(onCopy).toHaveLength(1);
        } finally {
            solver.dispose();
        }
    });

    test("builds an offset copy into an edge of its own", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const sources = bulge(solver);
            solver.solve(true);
            // the shape alone is the one region the D encloses
            expect(profileFaces(sketchNode(solver))).toBe(1);

            const result = offsetEntities(solver, sources, 1, 0.01);
            expect(result.isOk).toBe(true);
            if (!result.isOk) throw new Error(result.error);
            solver.solve(true);

            const sketch = sketchNode(solver);
            expect(sketch.shape.isOk).toBe(true);
            // Four edges: the D and its offset — the offset is a kernel curve in its own right
            // (`Geom_OffsetCurve`: a basis curve and a distance), not a second curve fitted to
            // look like one.
            expect(sketch.shape.unchecked()!.findSubShapes(ShapeTypes.edge)).toHaveLength(4);
            // And the corners are the copies' own: an offset copy has no point to stitch, so
            // the joints of the chain are left unjoined — which the tool counts and the caller
            // reports. What the kernel then makes of two curves that stop near each other at
            // those corners is the profile builder's business, not this test's.
            expect(result.value.noJoin).toBeGreaterThan(0);
        } finally {
            solver.dispose();
        }
    });
});

/**
 * A trimmed or prolonged copy, built by the real kernel.
 *
 * The window is what a copy is cut and grown by, and the kernel is handed it twice: once to
 * evaluate the curve (`curveEval`) and once as the parameter range of the offset edge
 * (`sketchNode`). These tests build the shape and read it back, because the one thing that
 * cannot be checked in a unit test is whether the kernel agrees about where that range is —
 * and a window past a closed source's seam is a range no edge of the source itself covers.
 */
describe("a sketch offset copy that has been edited", () => {
    /** The edges the sketch builds, as their endpoints rounded to 1e-6. */
    function builtEdges(sketch: SketchNode): number[][] {
        return (
            sketch.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as unknown as {
                startPoint(): { x: number; y: number };
                endPoint(): { x: number; y: number };
            }[]
        ).map((edge) => [
            Math.round(edge.startPoint().x * 1e6) / 1e6,
            Math.round(edge.startPoint().y * 1e6) / 1e6,
            Math.round(edge.endPoint().x * 1e6) / 1e6,
            Math.round(edge.endPoint().y * 1e6) / 1e6,
        ]);
    }

    test("builds a trimmed copy over exactly the window it was cut to", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            // a straight cubic from (0, 0) to (12, 0), and its copy one unit above
            const source = solver.addBezier([0, 0, 4, 0, 8, 0, 12, 0]);
            solver.solve(true);
            const result = offsetEntities(solver, [source], 1, 0.01);
            expect(result.isOk).toBe(true);
            if (!result.isOk) throw new Error(result.error);
            const copy = result.value.createdEntityIds[0];
            // the parameter of x = 3 on a cubic drawn at an even rate is 0.25, and x = 9 is 0.75
            expect(solver.setOffsetWindow(copy, [0.25, 0.75]).isOk).toBe(true);

            const sketch = sketchNode(solver);
            expect(sketch.shape.isOk).toBe(true);
            expect(builtEdges(sketch)).toEqual([
                [0, 0, 12, 0],
                [3, 1, 9, 1],
            ]);
        } finally {
            solver.dispose();
        }
    });

    test("builds a copy whose window runs past a closed source's seam", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            // an ellipse beside the X axis, so only the Y axis cuts its copy: the only windows a
            // trim can leave are halves, and one of them runs past the source's own t = 0
            const ellipse = solver.addEllipse(0, 20, 10, 20, 0, 25);
            solver.solve(true);
            const result = offsetEntities(solver, [ellipse], 1, 0.01);
            expect(result.isOk).toBe(true);
            if (!result.isOk) throw new Error(result.error);
            const copy = result.value.createdEntityIds[0];
            // from t = π round the seam to t = 2π, which the source's own edge does not cover
            expect(solver.setOffsetWindow(copy, [Math.PI * 1.5, Math.PI * 2.5]).isOk).toBe(true);

            const sketch = sketchNode(solver);
            expect(sketch.shape.isOk).toBe(true);
            // the copy is one unbroken edge: were the window cut back into the source's own
            // range, or read a turn short, the shape would come back in two pieces or miss a half
            const edges = builtEdges(sketch);
            expect(edges).toHaveLength(2);
            // the source's edge is closed — its two ends are one point — and the copy's is not
            const copyEdge = edges.find((edge) => edge[0] !== edge[2] || edge[1] !== edge[3])!;
            // it starts at the ellipse's own (0, 14) and ends at (0, 26): the bottom and the top
            // of the copy, with the seam at (11, 20) inside it
            expect(Math.hypot(copyEdge[0] - 0, copyEdge[1] - 14)).toBeLessThan(1e-4);
            expect(Math.hypot(copyEdge[2] - 0, copyEdge[3] - 26)).toBeLessThan(1e-4);
        } finally {
            solver.dispose();
        }
    });

    test("builds a copy prolonged past the source it reads, once the source is grown with it", () => {
        const solver = new SketchSolver(Plane.XY);
        try {
            const source = solver.addBezier([0, 0, 4, 0, 8, 0, 12, 0]);
            solver.solve(true);
            const result = offsetEntities(solver, [source], 1, 0.01);
            expect(result.isOk).toBe(true);
            if (!result.isOk) throw new Error(result.error);
            const copy = result.value.createdEntityIds[0];
            const boundary = solver.addLine(15, 0, 15, 3);
            solver.solve(true);

            const extended = extendEntity(solver, {
                targetId: copy,
                targetUv: [11, 1],
                boundaryId: boundary,
                boundaryUv: [15, 2],
                modifyBoundary: false,
                tolerance: 0.01,
            });
            expect(extended.isOk).toBe(true);
            if (!extended.isOk) throw new Error(extended.error);

            const sketch = sketchNode(solver);
            expect(sketch.shape.isOk).toBe(true);
            // the copy now reaches the boundary's line, which is only buildable because the
            // source was grown under it — off the source's end the kernel has no basis to
            // offset, and the edge would come back short (or not at all)
            const copyEdge = builtEdges(sketch).find((edge) => edge[1] > 0)!;
            expect(copyEdge).toEqual([0, 1, 15, 1]);
        } finally {
            solver.dispose();
        }
    });
});
