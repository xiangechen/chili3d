// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type IEdge, type IFace, Plane, ShapeTypes } from "@chili3d/core";
import {
    createMockApplication,
    createMockVisualWithDocument,
    expectVolume,
    TestDocument,
} from "@chili3d/core/test-utils";
import type { FeatureData } from "../../src/features/feature";
import { ParametricBodyNode } from "../../src/parametricBodyNode";
import type { SketchData } from "../../src/sketch/sketchModel";
import { SketchNode } from "../../src/sketch/sketchNode";

/**
 * The scaffolding the conformance cases build on: a document, a sketch, and a feature
 * chain. Split out of the cases so each one reads as its closed form and the feature
 * data it takes to get there, with nothing else in between.
 *
 * The wasm bootstrap stays in the case file's own `beforeAll` — that is where the suite
 * convention puts it (`packages/parametric/test/sketch/setup.ts` has no kernel in it),
 * and a helper that installed it on import would make the suite depend on import order.
 */
export const WASM_BINARY = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../wasm/lib/chili-wasm.wasm"),
);

/** A closed rectangle profile, `x0..x1` by `y0..y1`, as four lines. */
export function rect(x0: number, y0: number, x1: number, y1: number): SketchData {
    return {
        entities: [
            { id: 1, type: "line", params: [x0, y0, x1, y0] },
            { id: 2, type: "line", params: [x1, y0, x1, y1] },
            { id: 3, type: "line", params: [x1, y1, x0, y1] },
            { id: 4, type: "line", params: [x0, y1, x0, y0] },
        ],
        constraints: [],
    };
}

/** A circle profile centred at `cx, cy`. */
export function circle(cx: number, cy: number, r: number): SketchData {
    return { entities: [{ id: 1, type: "circle", params: [cx, cy, r] }], constraints: [] };
}

/** An empty document with a visual — the container every case's nodes are added to. */
export function newDocument(): TestDocument {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as unknown as typeof doc.visual;
    return doc;
}

/** A sketch node added to `doc`, on `Plane.XY` unless another plane is given. */
export function addSketch(doc: TestDocument, sketch: SketchData, plane = Plane.XY): SketchNode {
    const sketchNode = new SketchNode({ document: doc, plane, data: sketch });
    doc.modelManager.addNode(sketchNode);
    return sketchNode;
}

/** A document and one sketch in it — the single-profile cases' whole setup. */
export function scene(sketch: SketchData, plane = Plane.XY): { doc: TestDocument; sketchNode: SketchNode } {
    const doc = newDocument();
    return { doc, sketchNode: addSketch(doc, sketch, plane) };
}

/**
 * A body whose feature chain is exactly `features` applied to a sketch. It takes the
 * scene for its document (and for the sketch id the features name), so the common shape
 * of a case is `bodyWith(scene(rect(...)), [extrudeFeature(...)])`.
 */
export function bodyWith({ doc }: ReturnType<typeof scene>, features: FeatureData[]): ParametricBodyNode {
    const body = new ParametricBodyNode({ document: doc, features });
    doc.modelManager.addNode(body);
    return body;
}

/** The `index`-th face of a sketch node's display mesh — the profile an extrude takes. */
export function profileOf(sketchNode: SketchNode, index = 0): IFace {
    const faces = sketchNode.mesh.faces;
    if (faces === undefined) throw new Error("the sketch has no closed profile to extrude");
    const closed = faces.range.filter((entry) => entry.shape.shapeType === ShapeTypes.face);
    const face = closed[index];
    if (face === undefined) throw new Error(`the sketch has no profile ${index}`);
    return face.shape as unknown as IFace;
}

export function facesOf(body: ParametricBodyNode): IFace[] {
    return body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
}

export function edgesOf(body: ParametricBodyNode): IEdge[] {
    return body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[];
}

/** The +Z face of a body whose first feature extruded a profile on `Plane.XY`. */
export function topFaceIndex(body: ParametricBodyNode): number {
    return facesOf(body).findIndex((face) => face.normal(0, 0)[1].z > 1 - 1e-6);
}

/**
 * `expectVolume` on the shape a body built — the form every case here wants. A node with
 * no shape is a failed chain, and reading it as a volume would report a missing shape as
 * a wrong number.
 */
export function expectBodyVolume(body: ParametricBodyNode, expected: number, digits = 6): void {
    const shape = body.shape.unchecked();
    if (shape === undefined) throw new Error("the body built no shape to measure");
    expectVolume(shape, expected, digits);
}
