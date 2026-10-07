// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

/**
 * A patterned sketch, built into geometry by the real kernel.
 *
 * The point is the path the design rests on: `SketchNode.generateShape` reads the sketch
 * *data* — `profileEntities(data)`, a pure function — rather than the solver that laid the
 * pattern out. An array's instances are written into `SketchData.entities` as ordinary
 * entities precisely so that path needs to know nothing about arrays; this is what says so
 * end to end, through the profile builder and the kernel.
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Plane, ShapeTypes } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { arrayInstanceTotal } from "../../src/sketch/arrayOps";
import { SKETCH_X_AXIS_ID } from "../../src/sketch/sketchModel";
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

/** A closed square drawn as four lines, in the order that walks it counter-clockwise. */
function square(solver: SketchSolver, x0: number, y0: number, size: number): number[] {
    const x1 = x0 + size;
    const y1 = y0 + size;
    const corners: [number, number][] = [
        [x0, y0],
        [x1, y0],
        [x1, y1],
        [x0, y1],
    ];
    return corners.map((corner, index) => {
        const next = corners[(index + 1) % corners.length];
        return solver.addLine(corner[0], corner[1], next[0], next[1]);
    });
}

function emptyDocument(): TestDocument {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    return doc;
}

function sketchNode(data: ReturnType<SketchSolver["toData"]>): SketchNode {
    return new SketchNode({ document: emptyDocument(), plane: Plane.XY, data });
}

/** Every sketch node a document holds — the tree's own type name is what tells them apart. */
function sketchesOf(doc: TestDocument): SketchNode[] {
    return doc.modelManager.findNodes((node) => node.constructor.name === "SketchNode") as SketchNode[];
}

/**
 * The closed regions the sketch builds — the node's own profile faces, which the mesher
 * derives from the data (`sketchProfiles`), rather than the shape's sub-shapes: the shape
 * carries the edges alone, and it is the profile builder that closes them into regions.
 */
function profileFaces(sketch: SketchNode): number {
    return sketch.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face).length ?? 0;
}

describe("a patterned sketch", () => {
    test("builds every instance into its own closed profile", () => {
        const solver = new SketchSolver(Plane.XY);
        const source = square(solver, 0, 0, 10);
        const added = solver.addArray(
            { type: "linear", x: { count: 3, spacing: 20 }, y: { count: 1, spacing: 0 } },
            source,
        );
        expect(added.isOk).toBe(true);
        solver.solve(true);

        const sketch = sketchNode(solver.toData());

        expect(sketch.shape.isOk).toBe(true);
        // three squares, each closed into a region of its own — the instances are geometry the
        // data path sees, not rows only the live solver knows about
        expect(profileFaces(sketch)).toBe(3);
        expect(sketch.shape.unchecked()!.findSubShapes(ShapeTypes.edge)).toHaveLength(12);
        solver.dispose();
    });

    test("comes back whole from a save and load of the whole document", async () => {
        const solver = new SketchSolver(Plane.XY);
        const source = square(solver, 0, 0, 10);
        solver.addArray(
            { type: "linear", x: { count: 3, spacing: 20 }, y: { count: 1, spacing: 0 } },
            source,
        );
        solver.solve(true);
        const doc = emptyDocument();
        doc.modelManager.addNode(new SketchNode({ document: doc, plane: Plane.XY, data: solver.toData() }));

        // the document's own serializer, not a hand-rebuilt tree: the pattern is a field of
        // the sketch's JSON blob, and this is what says it survives the blob being written
        // and read back
        const reloaded = emptyDocument();
        await reloaded.modelManager.deserialize(doc.modelManager.serialize());

        const [sketch] = sketchesOf(reloaded);
        expect(sketch.data.arrays).toHaveLength(1);
        expect(arrayInstanceTotal(sketch.data.arrays![0].pattern)).toBe(3);
        expect(sketch.shape.isOk).toBe(true);
        expect(profileFaces(sketch)).toBe(3);
        solver.dispose();
    });

    test("leaves a construction seed out of the regions it builds", () => {
        const solver = new SketchSolver(Plane.XY);
        const source = square(solver, 0, 0, 10);
        solver.setConstruction(source[0], true);
        solver.addArray(
            { type: "linear", x: { count: 2, spacing: 20 }, y: { count: 1, spacing: 0 } },
            source,
        );
        solver.solve(true);

        const sketch = sketchNode(solver.toData());

        expect(sketch.shape.isOk).toBe(true);
        // one edge of each square is construction, so neither closes — the instances copy the
        // flag off the seed exactly as the construction toggle already does
        expect(profileFaces(sketch)).toBe(0);
        solver.dispose();
    });
});
