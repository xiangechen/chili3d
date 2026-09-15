// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Regression: the stored EdgeRef fingerprint is world-coordinate, but the source
// node's edges are local. A ref captured from a transformed source must be matched
// in the source's local frame — otherwise the world fingerprint double-applies the
// transform to the winner (a snapshot offset by the translation) or ties every
// co-directional edge of the body.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { EditableShapeNode, type IEdge, type INodeVisual, Matrix4, Plane, Result, XYZ } from "@chili3d/core";
import { createMockApplication, createMockVisualWithDocument, TestDocument } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { captureExternalRef, resolveExternalRefs } from "../../src/sketch/externalRef";
import type { ExternalRefData } from "../../src/sketch/sketchModel";
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

test("a ref captured from a translated source resolves in the source's local frame", () => {
    const doc = new TestDocument({ application: createMockApplication() });
    doc.visual = createMockVisualWithDocument(doc) as any;

    // A single-edge source body, translated +10 in Y: its local bottom edge
    // (0,0,0)-(10,0,0) is the world edge (0,10,0)-(10,10,0) the ref was captured from.
    const localEdge = shapeFactory
        .line(new XYZ({ x: 0, y: 0, z: 0 }), new XYZ({ x: 10, y: 0, z: 0 }))
        .unchecked()!;
    const source = new EditableShapeNode({ document: doc, name: "src", shape: Result.ok(localEdge) });
    doc.modelManager.addNode(source);
    const transform = Matrix4.fromTranslation(0, 10, 0);
    const visual = { worldTransform: () => transform } as unknown as INodeVisual;
    doc.visual.context.getVisual = () => visual;

    const worldEdge = localEdge.transformedMul(transform) as IEdge;
    let ref: ExternalRefData;
    try {
        ref = captureExternalRef(-100, source.id, Plane.XY, worldEdge, undefined, "profile")!;
    } finally {
        worldEdge.dispose();
    }
    expect(ref.snapshot).toEqual([0, 10, 10, 10]);

    const [result] = resolveExternalRefs(doc, Plane.XY, [ref]);

    // Not dangling, and not re-anchored to a "winner" offset by another 10mm: the
    // local-frame match resolves exactly, so nothing changed.
    expect(result.mutated).toBe(false);
    expect(result.geometryChanged).toBe(false);
    expect(ref.dangling).toBeUndefined();
    expect(ref.snapshot).toEqual([0, 10, 10, 10]);
    expect(ref.edge).toEqual({
        kind: "line",
        start: { x: 0, y: 10, z: 0 },
        end: { x: 10, y: 10, z: 0 },
        edgeId: undefined,
    });
});
