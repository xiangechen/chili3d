// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { type ICameraController, Plane, ShapeTypes, XYZ } from "@chili3d/core";
import {
    createMockApplication,
    createMockView,
    createMockVisualWithDocument,
    TestDocument,
} from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { rs } from "@rstest/core";
import type { FeatureData } from "../../src/features/feature";
import { ParametricBodyNode } from "../../src/parametricBodyNode";
import { type SketchData, SketchNode } from "../../src/sketch";
import { SketchEditor } from "../../src/sketch/editor/sketchEditor";
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

afterEach(() => {
    rs.restoreAllMocks();
});

const rect = (min: number, max: number): SketchData => ({
    entities: [
        { id: 1, type: "line", params: [min, min, max, min] },
        { id: 2, type: "line", params: [max, min, max, max] },
        { id: 3, type: "line", params: [max, max, min, max] },
        { id: 4, type: "line", params: [min, max, min, min] },
    ],
    constraints: [],
});

/** Editor environment: camera, view and visual mocks, mirroring the app shell. */
function setupEditorEnvironment() {
    const camera = {
        cameraPosition: new XYZ({ x: 0, y: -200, z: 200 }),
        cameraTarget: XYZ.zero,
        cameraUp: XYZ.unitZ,
        cameraType: "perspective" as "perspective" | "orthographic",
        lookAt: rs.fn(),
        fitContent: rs.fn(),
    };
    const app = createMockApplication();
    const doc = new TestDocument({ application: app, selection: { clearSelection: rs.fn() } as any });
    doc.visual = createMockVisualWithDocument(doc, { viewHandler: { canRotate: true } as any }) as any;
    const view = createMockView({ document: doc, cameraController: camera as unknown as ICameraController });
    (app as any).activeView = view;
    return doc;
}

function faceCount(body: ParametricBodyNode): number {
    return body.shape.unchecked()!.findSubShapes(ShapeTypes.face).length;
}

/**
 * Two bodies both consuming the edited sketch, the cut-consumer `y` created BEFORE
 * its boolean tool `z` — the rollback map's insertion order then places the
 * consumer first (it is seeded on its own `edited`-consuming feature, `z` only
 * propagates in), so insertion order alone would restore `y` against `z`'s session
 * preview. `y` = base box + pad from `edited` + cut by `z`; `z` = box + tower from
 * `edited`; editing `edited` rolls both back to their base boxes (index 1).
 */
function setup() {
    const doc = setupEditorEnvironment();
    const base = new SketchNode({ document: doc, plane: Plane.XY, data: rect(-20, 20) });
    doc.modelManager.addNode(base);
    const yBase = new SketchNode({ document: doc, plane: Plane.XY, data: rect(-15, 15) });
    doc.modelManager.addNode(yBase);
    const edited = new SketchNode({ document: doc, plane: Plane.XY, data: rect(-5, 5) });
    doc.modelManager.addNode(edited);

    const y = new ParametricBodyNode({
        document: doc,
        id: "y-body",
        features: [
            { id: "y-base", type: "extrude", sketchId: yBase.id, depth: 22 },
            { id: "y-pad", type: "extrude", sketchId: edited.id, depth: 25, operation: "fuse" },
            { id: "y-cut", type: "boolean", operation: "cut", toolIds: ["z-body"] },
        ] as FeatureData[],
    });
    doc.modelManager.addNode(y);
    const z = new ParametricBodyNode({
        document: doc,
        id: "z-body",
        features: [
            { id: "z-base", type: "extrude", sketchId: base.id, depth: 20 },
            { id: "z-tower", type: "extrude", sketchId: edited.id, depth: 30, operation: "fuse" },
        ] as FeatureData[],
    });
    doc.modelManager.addNode(z);
    // y was created before its tool existed; both evaluate now that z is there
    expect(z.shape.isOk).toBe(true);
    expect(y.shape.isOk).toBe(true);
    expect(y.featureItems().map((x) => x.error)).toEqual([undefined, undefined, undefined]);
    expect(z.featureItems().map((x) => x.error)).toEqual([undefined, undefined]);
    return { doc, edited, y, z };
}

test("on session exit a cut-consumer restores after its rolled-back tool, never against the preview", () => {
    const { edited, y, z } = setup();
    const settledYFaces = faceCount(y);
    const settledZFaces = faceCount(z);
    const settledYBox = y.shape.unchecked()!.boundingBox();
    expect(settledYFaces).toBeGreaterThan(6);
    expect(settledZFaces).toBeGreaterThan(6);

    // Record the restore sequence and probe z's state when y re-evaluates.
    const events: string[] = [];
    let zRollbackAtYRestore: number | undefined | "unreached" = "unreached";
    let zFacesAtYRestore: number | undefined;
    for (const [body, tag] of [
        [y, "y"],
        [z, "z"],
    ] as const) {
        const original = body.setRollbackIndex.bind(body);
        body.setRollbackIndex = (index) => {
            if (index === undefined) {
                events.push(`restore-${tag}`);
                if (body === y) {
                    zRollbackAtYRestore = z.rollbackIndex;
                    zFacesAtYRestore = faceCount(z);
                }
            }
            const restored = original(index);
            if (index === undefined) events.push(`restored-${tag}:${restored}`);
            return restored;
        };
    }

    const editor = SketchEditor.enter(edited);
    try {
        // both rolled back to their first edited-sketch feature — base boxes only
        expect(y.rollbackIndex).toBe(1);
        expect(z.rollbackIndex).toBe(1);
        expect(faceCount(y)).toBe(6);
        expect(faceCount(z)).toBe(6);
    } finally {
        editor.exit();
    }

    // the tool fully restored BEFORE the consumer's own restore re-evaluated it,
    // and every restore evaluation succeeded (`true` — no err shape anywhere)
    expect(events).toEqual(["restore-z", "restored-z:true", "restore-y", "restored-y:true"]);
    expect(zRollbackAtYRestore).toBeUndefined();
    expect(zFacesAtYRestore).toBe(settledZFaces);

    // the final shapes are exactly the settled pre-session ones
    expect(y.rollbackIndex).toBeUndefined();
    expect(z.rollbackIndex).toBeUndefined();
    expect(y.shape.isOk).toBe(true);
    expect(z.shape.isOk).toBe(true);
    expect(y.featureItems().map((x) => x.error)).toEqual([undefined, undefined, undefined]);
    expect(z.featureItems().map((x) => x.error)).toEqual([undefined, undefined]);
    expect(faceCount(y)).toBe(settledYFaces);
    expect(faceCount(z)).toBe(settledZFaces);
    const restoredYBox = y.shape.unchecked()!.boundingBox();
    expect(restoredYBox.min.x).toBeCloseTo(settledYBox.min.x, 6);
    expect(restoredYBox.min.z).toBeCloseTo(settledYBox.min.z, 6);
    expect(restoredYBox.max.x).toBeCloseTo(settledYBox.max.x, 6);
    expect(restoredYBox.max.z).toBeCloseTo(settledYBox.max.z, 6);
});

test("unrelated rolled-back bodies restore without regression", () => {
    const doc = setupEditorEnvironment();
    const base = new SketchNode({ document: doc, plane: Plane.XY, data: rect(-20, 20) });
    doc.modelManager.addNode(base);
    const edited = new SketchNode({ document: doc, plane: Plane.XY, data: rect(-5, 5) });
    doc.modelManager.addNode(edited);
    // two independent bodies, each consuming `edited` after its own base feature —
    // no dependency between them, both roll back to index 1
    const make = (tag: string, min: number, depth: number) => {
        const own = new SketchNode({ document: doc, plane: Plane.XY, data: rect(min, -min) });
        doc.modelManager.addNode(own);
        const body = new ParametricBodyNode({
            document: doc,
            id: `${tag}-body`,
            features: [
                { id: `${tag}-base`, type: "extrude", sketchId: own.id, depth },
                { id: `${tag}-pad`, type: "extrude", sketchId: edited.id, depth, operation: "fuse" },
            ] as FeatureData[],
        });
        doc.modelManager.addNode(body);
        expect(body.shape.isOk).toBe(true);
        return body;
    };
    const first = make("first", -15, 22);
    const second = make("second", -10, 15);
    const settled = [faceCount(first), faceCount(second)];

    const events: string[] = [];
    for (const [body, tag] of [
        [first, "first"],
        [second, "second"],
    ] as const) {
        const original = body.setRollbackIndex.bind(body);
        body.setRollbackIndex = (index) => {
            if (index !== undefined) return original(index);
            events.push(tag);
            return original(index);
        };
    }

    const editor = SketchEditor.enter(edited);
    try {
        expect(first.rollbackIndex).toBe(1);
        expect(second.rollbackIndex).toBe(1);
    } finally {
        editor.exit();
    }

    // insertion order among unrelated bodies is stable, and both fully restore
    expect(events).toEqual(["first", "second"]);
    expect(faceCount(first)).toBe(settled[0]);
    expect(faceCount(second)).toBe(settled[1]);
    expect(first.shape.isOk).toBe(true);
    expect(second.shape.isOk).toBe(true);
});
