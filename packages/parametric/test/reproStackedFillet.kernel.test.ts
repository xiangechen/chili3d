// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CurveUtils, type IEdge, type IFace, Plane, ShapeTypes, Transaction } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { captureEdgeRef } from "../src/features/edgeRef";
import { captureProfileRef } from "../src/features/profileRef";
import { ParametricBodyNode } from "../src/parametricBodyNode";
import { ConstraintKind, type SketchData } from "../src/sketch/sketchModel";
import { SketchNode } from "../src/sketch/sketchNode";
import "./sketch/setup";

const WASM_BINARY = readFileSync(
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../wasm/lib/chili-wasm.wasm"),
);

beforeAll(async () => {
    await initWasm({ wasmBinary: WASM_BINARY });
    Object.defineProperty(globalThis, "shapeFactory", {
        value: new ShapeFactory(),
        writable: true,
        configurable: true,
    });
});

const rect = (x0: number, y0: number, x1: number, y1: number): SketchData => ({
    entities: [
        { id: 1, type: "line", params: [x0, y0, x1, y0] },
        { id: 2, type: "line", params: [x1, y0, x1, y1] },
        { id: 3, type: "line", params: [x1, y1, x0, y1] },
        { id: 4, type: "line", params: [x0, y1, x0, y0] },
    ],
    constraints: [],
});

function newDoc(): TestDocument {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    return doc;
}

/** Extrude `data`, fillet its four vertical edges, then every edge of the top face. */
function stackedFillets(doc: TestDocument, data: SketchData, depth: number): ParametricBodyNode {
    const sketch = new SketchNode({ document: doc, plane: Plane.XY, data });
    doc.modelManager.addNode(sketch);
    const profiles = sketch.mesh.faces?.range.filter((x) => x.shape.shapeType === ShapeTypes.face) ?? [];
    const body = new ParametricBodyNode({
        document: doc,
        features: [
            {
                id: "e1",
                type: "extrude",
                sketchId: sketch.id,
                depth,
                profiles: [captureProfileRef(profiles[0].shape as unknown as IFace)],
            },
        ],
    });
    doc.modelManager.addNode(body);
    pickFillet(body, "f1", 2, (edge) => {
        const s = edge.startPoint();
        const e = edge.endPoint();
        return Math.abs(s.x - e.x) < 1e-6 && Math.abs(s.y - e.y) < 1e-6 && Math.abs(s.z - e.z) > 1e-6;
    });
    pickFillet(body, "f2", 1, (edge) => {
        const zs = [edge.startPoint().z, edge.endPoint().z];
        return zs.every((z) => Math.abs(z - depth) < 1e-6);
    });
    return body;
}

/** Captures the refs the fillet command would store for the edges the predicate picks. */
function pickFillet(
    body: ParametricBodyNode,
    id: string,
    radius: number,
    pick: (edge: IEdge) => boolean,
): void {
    const edges = body.shape.unchecked()!.findSubShapes(ShapeTypes.edge) as IEdge[];
    const refs = edges
        .map((edge, index) => ({ edge, index }))
        .filter(({ edge }) => pick(edge))
        .map(({ edge, index }) => {
            const edgeId = body.edgeIdAt(index);
            return captureEdgeRef(edge, edgeId, body.edgeIdIsShared(edgeId));
        });
    expect(refs.length).toBeGreaterThan(0);
    body.setFeaturesEmitShapeChanged([...body.features, { id, type: "fillet", radius, edges: refs }]);
}

const errors = (body: ParametricBodyNode) =>
    body
        .featureItems()
        .map((x) => `${x.id}=${x.error ?? "ok"}`)
        .join("|");

const round = (x: number) => Math.round(x * 1e4) / 1e4;

/**
 * Sorted geometry of the solid: the face count plus every edge's ends. Orientation is
 * deliberately ignored — a rebuild may report the same edge traversed the other way,
 * and the id scheme (not the orientation flag) is what must stay put.
 */
function shapeFingerprint(body: ParametricBodyNode): string[] {
    const shape = body.shape.unchecked()!;
    const edges = shape.findSubShapes(ShapeTypes.edge) as IEdge[];
    const faces = shape.findSubShapes(ShapeTypes.face).length;
    return [
        `faces:${faces}`,
        ...edges.map((edge) => {
            const s = edge.startPoint();
            const t = edge.endPoint();
            const basis = edge.curve.basisCurve;
            const radius = CurveUtils.isCircle(basis) ? ` r${round(basis.radius)}` : "";
            const ends = [
                `${round(s.x)},${round(s.y)},${round(s.z)}`,
                `${round(t.x)},${round(t.y)},${round(t.z)}`,
            ].sort();
            return `${basis.curveType}${radius} ${ends[0]}~${ends[1]}`;
        }),
    ].sort();
}

test("the stacked fillets survive repeated grow/shrink edits of the rectangle", () => {
    const doc = newDoc();
    const body = stackedFillets(doc, rect(0, 0, 40, 20), 10);
    const sketch = doc.modelManager.findNodes((n) => n instanceof SketchNode)[0] as SketchNode;
    expect(errors(body)).toBe("e1=ok|f1=ok|f2=ok");
    const settled = shapeFingerprint(body);

    const sizes: [number, number][] = [];
    for (let cycle = 0; cycle < 6; cycle++) {
        sizes.push([60, 30], [15, 50], [80, 12], [20, 60], [15, 8]);
    }
    sizes.push([40, 20]);

    for (const [w, h] of sizes) {
        sketch.setDataEmitShapeChanged(rect(0, 0, w, h));
        expect([`${w}x${h}`, errors(body)]).toEqual([`${w}x${h}`, "e1=ok|f1=ok|f2=ok"]);
    }

    // Back at the starting rectangle the SAME edges must be there — a drifted fillet
    // (rounded onto other edges by a re-anchored ref) changes this set.
    expect(shapeFingerprint(body)).toEqual(settled);
});

/** The rectangle as the sketch tool builds it: corners joined, one dimension driven by "w". */
function dimensionedRect(): SketchData {
    const join = (a: number, b: number) => ({
        id: 10 + a,
        kind: ConstraintKind.P2PCoincident,
        refs: [
            { entityId: a, pointIndex: 1 },
            { entityId: b, pointIndex: 0 },
        ],
    });
    return {
        entities: [
            { id: 1, type: "line", params: [0, 0, 40, 0] },
            { id: 2, type: "line", params: [40, 0, 40, 20] },
            { id: 3, type: "line", params: [40, 20, 0, 20] },
            { id: 4, type: "line", params: [0, 20, 0, 0] },
        ],
        constraints: [
            join(1, 2),
            join(2, 3),
            join(3, 4),
            join(4, 1),
            {
                id: 20,
                kind: ConstraintKind.Horizontal,
                refs: [
                    { entityId: 1, pointIndex: 0 },
                    { entityId: 1, pointIndex: 1 },
                ],
            },
            {
                id: 21,
                kind: ConstraintKind.Vertical,
                refs: [
                    { entityId: 2, pointIndex: 0 },
                    { entityId: 2, pointIndex: 1 },
                ],
            },
            // Entities 3 and 4 need pinning too: without them the rectangle can SHEAR,
            // and repeated solves turn it into a trapezoid (measured while writing this).
            {
                id: 24,
                kind: ConstraintKind.Horizontal,
                refs: [
                    { entityId: 3, pointIndex: 0 },
                    { entityId: 3, pointIndex: 1 },
                ],
            },
            {
                id: 25,
                kind: ConstraintKind.Vertical,
                refs: [
                    { entityId: 4, pointIndex: 0 },
                    { entityId: 4, pointIndex: 1 },
                ],
            },
            {
                id: 22,
                kind: ConstraintKind.P2PDistance,
                refs: [
                    { entityId: 1, pointIndex: 0 },
                    { entityId: 1, pointIndex: 1 },
                ],
                datum: "w",
            },
            {
                id: 23,
                kind: ConstraintKind.P2PDistance,
                refs: [
                    { entityId: 2, pointIndex: 0 },
                    { entityId: 2, pointIndex: 1 },
                ],
                datum: 20,
            },
        ],
    };
}

function setWidth(doc: TestDocument, expression: string) {
    Transaction.execute(doc, "edit variables", () => {
        doc.variables.setItems([{ id: "v1", name: "w", expression, type: "length" }]);
    });
}

test("the stacked fillets survive a dimensioned rectangle edited through a sketch session", () => {
    const doc = newDoc();
    setWidth(doc, "40");
    const body = stackedFillets(doc, dimensionedRect(), 10);
    expect(errors(body)).toBe("e1=ok|f1=ok|f2=ok");
    const settled = shapeFingerprint(body);

    // Each cycle is a sketch-editing session: the body rolls back to before the extrude
    // while the dimension is driven up and down, then the session ends and the chain replays.
    for (let cycle = 0; cycle < 6; cycle++) {
        body.setRollbackIndex(0);
        setWidth(doc, "70");
        setWidth(doc, "25");
        body.setRollbackIndex(undefined);
        expect(`cycle ${cycle}: ${errors(body)}`).toBe(`cycle ${cycle}: e1=ok|f1=ok|f2=ok`);
    }

    setWidth(doc, "40");
    expect(errors(body)).toBe("e1=ok|f1=ok|f2=ok");
    expect(shapeFingerprint(body)).toEqual(settled);
});
