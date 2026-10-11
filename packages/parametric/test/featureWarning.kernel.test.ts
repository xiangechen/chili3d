// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { I18n, type IFace, ShapeTypes } from "@chili3d/core";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { captureEdgeRef } from "../src/features/edgeRef";
import type {
    BooleanFeatureData,
    ExtrudeFeatureData,
    FeatureData,
    FilletFeatureData,
    ShellFeatureData,
} from "../src/features/feature";
import { captureProfileRef, type ProfileRef } from "../src/features/profileRef";
import type { ParametricBodyNode } from "../src/parametricBodyNode";
import type { SketchData, SketchEntityData } from "../src/sketch/sketchModel";
import {
    addSketch,
    bodyWith,
    edgesOf,
    expectBodyVolume,
    newDocument,
    profileOf,
    rect,
    WASM_BINARY,
} from "./conformance/_scene";

beforeAll(async () => {
    await initWasm({ wasmBinary: WASM_BINARY });
    Object.defineProperty(globalThis, "shapeFactory", {
        value: new ShapeFactory(),
        writable: true,
        configurable: true,
    });
});

/** A closed rectangle as four lines, numbered from `base` so two of them can share a sketch. */
function rectEntities(base: number, x0: number, y0: number, x1: number, y1: number): SketchEntityData[] {
    return [
        { id: base, type: "line", params: [x0, y0, x1, y0] },
        { id: base + 1, type: "line", params: [x1, y0, x1, y1] },
        { id: base + 2, type: "line", params: [x1, y1, x0, y1] },
        { id: base + 3, type: "line", params: [x0, y1, x0, y0] },
    ];
}

const SQUARE_A = rectEntities(1, 0, 0, 10, 10);
const SQUARE_B = rectEntities(5, 20, 0, 30, 10);
const SQUARE_C = rectEntities(9, 40, 0, 50, 10);
const twoSquares: SketchData = { entities: [...SQUARE_A, ...SQUARE_B], constraints: [] };

const warnings = (body: ParametricBodyNode) => body.featureItems().map((item) => item.warning);
const errors = (body: ParametricBodyNode) => body.featureItems().map((item) => item.error);
const missingOf = (body: ParametricBodyNode, index = 0) => body.featureItems()[index].missingInputs ?? [];

describe("a feature that lost one of its picks", () => {
    /** An extrude over both squares, ready to have one of them taken away. */
    function extrudedOverBoth() {
        const doc = newDocument();
        const sketch = addSketch(doc, twoSquares);
        const body = bodyWith({ doc, sketchNode: sketch }, [
            {
                id: "e1",
                type: "extrude",
                sketchId: sketch.id,
                profiles: [captureProfileRef(profileOf(sketch, 0)), captureProfileRef(profileOf(sketch, 1))],
                depth: 5,
            } satisfies ExtrudeFeatureData,
        ]);
        return { doc, sketch, body };
    }

    test("it builds from the rest, warns, and names the slot that went", () => {
        const { sketch, body } = extrudedOverBoth();
        expectBodyVolume(body, 10 * 10 * 5 * 2);
        expect(warnings(body)).toEqual([undefined]);

        // The second square is deleted from the sketch; its profile ref has nothing to match.
        sketch.setDataEmitShapeChanged({ entities: SQUARE_A, constraints: [] });

        expectBodyVolume(body, 10 * 10 * 5);
        expect(warnings(body)).toEqual([I18n.translate("body.missingInputs{0}", 1)]);
        // 1-based, the way the row counts picks — "input #2", not "#1".
        expect(missingOf(body)).toEqual([
            { key: "profiles", refIndex: 1, label: I18n.translate("body.missingPick{0}", 2) },
        ]);
    });

    test("the lost pick stays on the feature, so it can be put back", () => {
        const { sketch, body } = extrudedOverBoth();
        // Read the shape first: the watched-node rebuild is what the write-back rides on,
        // and a sketch edited before anything has read the body does not produce one yet
        // (the same ordering the cache case has to respect).
        expectBodyVolume(body, 10 * 10 * 5 * 2);
        sketch.setDataEmitShapeChanged({ entities: SQUARE_A, constraints: [] });
        expectBodyVolume(body, 10 * 10 * 5);

        const stored = body.features[0] as ExtrudeFeatureData;
        expect(stored.profiles).toHaveLength(2);

        // Putting the square back is enough: the ref was never dropped, so it matches again.
        sketch.setDataEmitShapeChanged(twoSquares);
        expectBodyVolume(body, 10 * 10 * 5 * 2);
        expect(warnings(body)).toEqual([undefined]);
        expect(missingOf(body)).toEqual([]);
    });

    test("the warning outlives a rebuild that takes the feature from the cache", () => {
        const { doc, sketch, body } = extrudedOverBoth();
        expectBodyVolume(body, 10 * 10 * 5 * 2);
        sketch.setDataEmitShapeChanged({ entities: SQUARE_A, constraints: [] });
        expectBodyVolume(body, 10 * 10 * 5);
        expect(warnings(body)).toEqual([I18n.translate("body.missingInputs{0}", 1)]);

        // A later feature re-runs the chain, but the extrude itself is unchanged and comes
        // from the per-feature cache — the warning has to live in the cache entry too, or a
        // second rebuild would quietly clean a row the user has not fixed.
        const fillet: FilletFeatureData = {
            id: "f1",
            type: "fillet",
            radius: 1,
            edges: [captureEdgeRef(edgesOf(body)[0], body.edgeIdAt(0))],
        };
        body.setFeaturesEmitShapeChanged([...body.features, fillet] as FeatureData[]);

        expect(warnings(body)).toEqual([I18n.translate("body.missingInputs{0}", 1), undefined]);
        expect(missingOf(body)).toEqual([
            { key: "profiles", refIndex: 1, label: I18n.translate("body.missingPick{0}", 2) },
        ]);
    });

    test("the warning outlives a LATER feature that fails the chain", () => {
        const { body, sketch } = extrudedOverBoth();
        expectBodyVolume(body, 10 * 10 * 5 * 2);
        sketch.setDataEmitShapeChanged({ entities: SQUARE_A, constraints: [] });
        expect(warnings(body)).toEqual([I18n.translate("body.missingInputs{0}", 1)]);

        // The chain abandons at this one, so the run never reaches its end — where the
        // per-feature unresolved inputs are normally installed. The extrude's pick is still
        // gone and its row has to keep saying so.
        const broken: ExtrudeFeatureData = {
            id: "e2",
            type: "extrude",
            sketchId: "no-such-sketch",
            profiles: [],
            depth: 5,
        };
        body.setFeaturesEmitShapeChanged([...body.features, broken] as FeatureData[]);

        expect(body.featureItems()[1].error).toBe("Sketch not found");
        expect(warnings(body)).toEqual([I18n.translate("body.missingInputs{0}", 1), undefined]);
        expect(missingOf(body)).toEqual([
            { key: "profiles", refIndex: 1, label: I18n.translate("body.missingPick{0}", 2) },
        ]);
    });
});

describe("a boolean whose tool was deleted", () => {
    test("it combines the tools that are left and names the one that went", () => {
        const doc = newDocument();
        const lower = addSketch(doc, { entities: SQUARE_A, constraints: [] });
        const other = addSketch(doc, { entities: SQUARE_B, constraints: [] });
        const target = bodyWith({ doc, sketchNode: lower }, [
            {
                id: "e1",
                type: "extrude",
                sketchId: lower.id,
                profiles: [captureProfileRef(profileOf(lower))],
                depth: 5,
            } satisfies ExtrudeFeatureData,
        ]);
        // Two tools, fused one after the other: dropping one still leaves a boolean to do.
        const first = bodyWith({ doc, sketchNode: other }, [
            {
                id: "e2",
                type: "extrude",
                sketchId: other.id,
                profiles: [captureProfileRef(profileOf(other))],
                depth: 5,
            } satisfies ExtrudeFeatureData,
        ]);
        const third = addSketch(doc, { entities: SQUARE_C, constraints: [] });
        const second = bodyWith({ doc, sketchNode: third }, [
            {
                id: "e3",
                type: "extrude",
                sketchId: third.id,
                profiles: [captureProfileRef(profileOf(third))],
                depth: 5,
            } satisfies ExtrudeFeatureData,
        ]);
        target.setFeaturesEmitShapeChanged([
            target.features[0],
            {
                id: "b1",
                type: "boolean",
                operation: "fuse",
                toolIds: [first.id, second.id],
                consumeTools: false,
            } satisfies BooleanFeatureData,
        ] as FeatureData[]);
        expectBodyVolume(target, 10 * 10 * 5 * 3);

        // The second tool's node is not in the document any more — a deleted body. Its id
        // stays on the feature, so it can be re-picked once something is there again.
        target.setFeaturesEmitShapeChanged([
            target.features[0],
            {
                ...(target.features[1] as BooleanFeatureData),
                toolIds: [first.id, "deleted-tool-node"],
            },
        ] as FeatureData[]);

        expectBodyVolume(target, 10 * 10 * 5 * 2);
        expect(warnings(target)).toEqual([undefined, I18n.translate("body.missingInputs{0}", 1)]);
        expect(missingOf(target, 1)).toEqual([
            { key: "toolIds", refIndex: 1, label: I18n.translate("body.missingPick{0}", 2) },
        ]);
    });
});

describe("a source-face pick that went", () => {
    test("the shell opens the face it still has and names the pick that went", () => {
        const doc = newDocument();
        const sketch = addSketch(doc, rect(-20, -15, 20, 15));
        const body = bodyWith({ doc, sketchNode: sketch }, [
            {
                id: "e1",
                type: "extrude",
                sketchId: sketch.id,
                profiles: [captureProfileRef(profileOf(sketch))],
                depth: 20,
            } satisfies ExtrudeFeatureData,
        ]);
        const faces = body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[];
        const top = faces.findIndex((face) => face.normal(0, 0)[1].z > 1 - 1e-6);
        const live = captureProfileRef(faces[top], body.faceIdAt(top));

        // A pick the plate never had: a circle-bounded region is not this 40×30×20 box, and
        // its region fingerprint is far outside the 2×characteristic-length gate, so nothing
        // scores finite against it.
        const gone: ProfileRef = {
            edges: [
                { kind: "circle", center: { x: 500, y: 500, z: 0 }, radius: 5, axis: { x: 0, y: 0, z: 1 } },
            ],
            center: { x: 500, y: 500, z: 0 },
            area: 25,
            id: "picked-once",
        };
        body.setFeaturesEmitShapeChanged([
            body.features[0],
            { id: "s1", type: "shell", faces: [live, gone], thickness: 2 } satisfies ShellFeatureData,
        ] as FeatureData[]);

        // The top still opens — the plate loses its cavity, not the whole feature.
        expectBodyVolume(body, 40 * 30 * 20 - 36 * 26 * 18);
        expect(warnings(body)).toEqual([undefined, I18n.translate("body.missingInputs{0}", 1)]);
        expect(missingOf(body, 1)).toEqual([
            { key: "faces", refIndex: 1, label: I18n.translate("body.missingPick{0}", 2) },
        ]);
    });
});

describe("a feature whose two picks name one region", () => {
    test("is refused, not built once with a pick called missing", () => {
        const doc = newDocument();
        const sketch = addSketch(doc, twoSquares);
        const refA = captureProfileRef(profileOf(sketch, 0));
        const body = bodyWith({ doc, sketchNode: sketch }, [
            {
                id: "e1",
                type: "extrude",
                sketchId: sketch.id,
                profiles: [refA, refA],
                depth: 5,
            } satisfies ExtrudeFeatureData,
        ]);

        // Read the shape first: the build is what evaluates the picks and records the row's
        // error, the ordering the write-back case below also has to respect.
        expect(body.shape.isOk).toBe(false);

        // Two picks naming one region cannot both hold under one-claim-per-ref. Building
        // one and calling the other "missing" would claim the user lost a region that is
        // still on screen, so the answer is the feature's own error.
        expect(errors(body)).toEqual(["Sketch profile match is ambiguous after rebuild"]);
        expect(missingOf(body)).toEqual([]);
    });
});

describe("a feature whose picks all resolved", () => {
    test("carries no warning and no placeholders", () => {
        const doc = newDocument();
        const sketch = addSketch(doc, twoSquares);
        const body = bodyWith({ doc, sketchNode: sketch }, [
            {
                id: "e1",
                type: "extrude",
                sketchId: sketch.id,
                profiles: [captureProfileRef(profileOf(sketch, 0))],
                depth: 5,
            } satisfies ExtrudeFeatureData,
        ]);

        expectBodyVolume(body, 10 * 10 * 5);
        expect(warnings(body)).toEqual([undefined]);
        expect(missingOf(body)).toEqual([]);
        expect((body.features[0] as ExtrudeFeatureData).profiles).toHaveLength(1);
        expect(profileOf(sketch, 0).findSubShapes(ShapeTypes.edge)).toHaveLength(4);
    });
});

/** A face's area, for the case that checks a pick's geometry actually left the model. */
const faceCount = (body: ParametricBodyNode) =>
    (body.shape.unchecked()!.findSubShapes(ShapeTypes.face) as IFace[]).length;

describe("placeholders are about picks, not about faces", () => {
    test("a feature with one pick reports nothing to place, whatever the body looks like", () => {
        const doc = newDocument();
        const sketch = addSketch(doc, { entities: SQUARE_A, constraints: [] });
        const body = bodyWith({ doc, sketchNode: sketch }, [
            {
                id: "e1",
                type: "extrude",
                sketchId: sketch.id,
                profiles: [captureProfileRef(profileOf(sketch))],
                depth: 5,
            } satisfies ExtrudeFeatureData,
        ]);

        expect(faceCount(body)).toBe(6);
        expect(missingOf(body)).toEqual([]);
    });
});
