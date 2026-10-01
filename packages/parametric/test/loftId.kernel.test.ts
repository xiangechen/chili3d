// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type IEdge, type IFace, Plane, ShapeTypes, XYZ } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { allProfiles, sketchProfiles } from "../src/features/profileBuilder";
import { captureProfileRef } from "../src/features/profileRef";
import { ParametricBodyNode } from "../src/parametricBodyNode";
import { type SketchData, SketchNode } from "../src/sketch";
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

// A 20x20 square. The mirrored variant keeps every entity id on the same segment with
// swapped endpoints (reversed winding), re-enumerating the wire on rebuild — stable ids
// must keep indexing the same geometry across it.
const square = (mirrored: boolean): SketchData => ({
    entities: mirrored
        ? [
              { id: 1, type: "line", params: [10, -10, -10, -10] },
              { id: 2, type: "line", params: [10, 10, 10, -10] },
              { id: 3, type: "line", params: [-10, 10, 10, 10] },
              { id: 4, type: "line", params: [-10, -10, -10, 10] },
          ]
        : [
              { id: 1, type: "line", params: [-10, -10, 10, -10] },
              { id: 2, type: "line", params: [10, -10, 10, 10] },
              { id: 3, type: "line", params: [10, 10, -10, 10] },
              { id: 4, type: "line", params: [-10, 10, -10, -10] },
          ],
    constraints: [],
});

const Z30_PLANE = new Plane({
    origin: new XYZ({ x: 0, y: 0, z: 30 }),
    normal: XYZ.unitZ,
    xvec: XYZ.unitX,
});

function profileSection(sketch: SketchNode) {
    const profileSet = sketchProfiles(sketch);
    expect(profileSet.isOk).toBe(true);
    const profiles = allProfiles(profileSet.value);
    expect(profiles).toHaveLength(1);
    return { kind: "profile" as const, nodeId: sketch.id, profile: captureProfileRef(profiles[0]) };
}

function loftBody() {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;
    const sketch1 = new SketchNode({ document: doc, id: "sk1", plane: Plane.XY, data: square(false) });
    const sketch2 = new SketchNode({ document: doc, id: "sk2", plane: Z30_PLANE, data: square(false) });
    doc.modelManager.addNode(sketch1, sketch2);
    const body = new ParametricBodyNode({
        document: doc,
        id: "b1",
        features: [
            {
                id: "l1",
                type: "loft",
                sections: [profileSection(sketch1), profileSection(sketch2)],
                isSolid: true,
                isRuled: false,
                continuity: "c2",
            },
        ],
    });
    doc.modelManager.addNode(body);
    expect(body.shape.isOk).toBe(true);
    return { doc, sketch1, body };
}

function facesOf(body: ParametricBodyNode): IFace[] {
    return body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
}

function centerOf(face: IFace): XYZ {
    const box = face.boundingBox();
    return new XYZ({
        x: (box.min.x + box.max.x) / 2,
        y: (box.min.y + box.max.y) / 2,
        z: (box.min.z + box.max.z) / 2,
    });
}

const round = (value: number) => {
    const r = Math.round(value * 1e6) / 1e6;
    return r === 0 ? 0 : r;
};

const byCoords = (a: number[], b: number[]) =>
    a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || (a[3] ?? 0) - (b[3] ?? 0);

/** id → geometry of every face and edge, for a same-geometry comparison across a rebuild. */
function idSnapshot(body: ParametricBodyNode) {
    const shape = body.shape.unchecked()!;
    const faces: Record<string, number[][]> = {};
    for (const [index, face] of (shape.findSubShapes(ShapeTypes.face) as IFace[]).entries()) {
        const id = body.faceIdAt(index) ?? "?";
        const center = centerOf(face);
        const entry = [round(center.x), round(center.y), round(center.z), round(face.area())];
        if (faces[id] === undefined) faces[id] = [entry];
        else faces[id].push(entry);
    }
    const edges: Record<string, number[][][]> = {};
    for (const [index, edge] of (shape.findSubShapes(ShapeTypes.edge) as IEdge[]).entries()) {
        const id = body.edgeIdAt(index) ?? "?";
        // The mid sample is the bbox center: pointAt reads the curve's native
        // parameter, which flips with the edge's direction on a rewound rebuild.
        const box = edge.boundingBox();
        const mid = new XYZ({
            x: (box.min.x + box.max.x) / 2,
            y: (box.min.y + box.max.y) / 2,
            z: (box.min.z + box.max.z) / 2,
        });
        const points = [edge.startPoint(), mid, edge.endPoint()]
            .map((p) => [round(p.x), round(p.y), round(p.z)])
            .sort(byCoords);
        if (edges[id] === undefined) edges[id] = [points];
        else edges[id].push(points);
    }
    for (const list of Object.values(faces)) list.sort(byCoords);
    for (const list of Object.values(edges)) list.sort((a, b) => byCoords(a[0], b[0]));
    return { faces, edges };
}

describe("loft ids from the kernel cap channel (real kernel)", () => {
    test("side faces take the section edge seeds, the caps take :start/:end", () => {
        const { body } = loftBody();

        expect(body.hasTrackedIds("face")).toBe(true);
        const faces = facesOf(body);
        expect(faces).toHaveLength(6);
        const ids = faces.map((_, index) => body.faceIdAt(index));

        // The four side faces are generated from section edges (either section's —
        // the kernel attributes a side to whichever end's edge it reports).
        const sides = ids.filter((id) => id !== undefined && /:ent\d+$/.test(id));
        expect(sides).toHaveLength(4);
        for (const id of sides) expect(id).toMatch(/^sketch:sk[12]:e[\d.]+:ent\d+$/);

        // Exactly one start cap and one end cap, on the geometrically correct faces.
        const starts = faces.filter((_, index) => body.faceIdAt(index)?.endsWith(":start"));
        const ends = faces.filter((_, index) => body.faceIdAt(index)?.endsWith(":end"));
        expect(starts).toHaveLength(1);
        expect(ends).toHaveLength(1);
        expect(centerOf(starts[0]).z).toBeCloseTo(0);
        expect(centerOf(ends[0]).z).toBeCloseTo(30);
    });

    test("the ids keep indexing the same geometry across a mirrored rebuild", () => {
        const { sketch1, body } = loftBody();
        const before = idSnapshot(body);
        const startCapId = facesOf(body)
            .map((_, index) => body.faceIdAt(index))
            .find((id) => id?.endsWith(":start"));
        expect(startCapId).toMatch(/^sketch:sk1:e[\d.]+:start$/);

        sketch1.setDataEmitShapeChanged(square(true));

        expect(body.shape.isOk).toBe(true);
        expect(idSnapshot(body)).toEqual(before);
        const startAfter = facesOf(body)
            .map((_, index) => body.faceIdAt(index))
            .find((id) => id?.endsWith(":start"));
        expect(startAfter).toBe(startCapId);
    });
});
