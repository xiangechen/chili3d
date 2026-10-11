// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { round } from "@chili3d/core/test-utils";
import { initWasm, ShapeFactory } from "@chili3d/wasm";
import { captureEdgeRef } from "../src/features/edgeRef";
import type { ExtrudeFeatureData, FeatureData, FilletFeatureData } from "../src/features/feature";
import { captureProfileRef } from "../src/features/profileRef";
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

/**
 * What the chain's per-feature cache keys off, pinned by outcome rather than by reading the
 * key. The cache lets an edit recompute only from the feature that changed, which means a
 * reason it fails to notice is a feature showing a stale shape — the failure mode is silent
 * and looks like the edit did nothing.
 *
 * `rebuildFromUpstream`/`handleWatchedNodeChanged` are driven through the public doors here
 * (`setFeaturesEmitShapeChanged` and the sketch's own setter), so the keys are exercised the
 * way the app exercises them.
 */
describe("the feature chain recomputes when its inputs move", () => {
    /** A 40×30×h box with an r fillet on one vertical edge, and the pieces to change it. */
    function filletedBox(depth: number, radius = 4) {
        const doc = newDocument();
        const sketch = addSketch(doc, rect(-20, -15, 20, 15));
        const extrudeFeature: ExtrudeFeatureData = {
            id: "e1",
            type: "extrude",
            sketchId: sketch.id,
            profiles: [captureProfileRef(profileOf(sketch))],
            depth,
        };
        const body = bodyWith({ doc, sketchNode: sketch }, [extrudeFeature]);
        // The edges of the box as it stands now: the vertical ones are the only 20-long
        // ones when the depth is 20, so read them by position on this exact box instead.
        const vertical = edgesOf(body).findIndex((edge) => round(edge.length()) === depth);
        const fillet: FilletFeatureData = {
            id: "f1",
            type: "fillet",
            radius,
            edges: [captureEdgeRef(edgesOf(body)[vertical], body.edgeIdAt(vertical))],
        };
        body.setFeaturesEmitShapeChanged([extrudeFeature, fillet] as FeatureData[]);
        return { doc, sketch, body, extrudeFeature, fillet };
    }

    const box = (h: number) => 40 * 30 * h;
    const box2 = (h: number) => 20 * 30 * h;
    const corner = (r: number, h: number) => (1 - Math.PI / 4) * r ** 2 * h;

    test("an edit to a feature below recomputes the features above it", () => {
        const { body } = filletedBox(20);
        expectBodyVolume(body, box(20) - corner(4, 20));

        const changed = body.features.map(
            (feature): FeatureData =>
                feature.id === "e1" && feature.type === "extrude" ? { ...feature, depth: 30 } : feature,
        );
        body.setFeaturesEmitShapeChanged(changed);

        expectBodyVolume(body, box(30) - corner(4, 30));
    });

    test("suppressing a feature rebuilds the chain without it, and un-suppressing puts it back", () => {
        const { body } = filletedBox(20);
        const withSuppression = (suppressed: boolean) =>
            body.features.map(
                (feature): FeatureData =>
                    feature.id === "f1" && feature.type === "fillet" ? { ...feature, suppressed } : feature,
            );

        body.setFeaturesEmitShapeChanged(withSuppression(true));
        expectBodyVolume(body, box(20));

        body.setFeaturesEmitShapeChanged(withSuppression(false));
        expectBodyVolume(body, box(20) - corner(4, 20));
    });

    test("a later edit does not resurrect the value from before the suppression", () => {
        // The cache is indexed by position in the list, and a suppressed feature is skipped
        // without storing an entry — so the entries after it sit at different positions
        // than they did. If a lookup could land on the wrong one, this is where the stale
        // number would come back.
        const { body } = filletedBox(20);
        body.setFeaturesEmitShapeChanged(
            body.features.map(
                (feature): FeatureData =>
                    feature.id === "f1" && feature.type === "fillet"
                        ? { ...feature, suppressed: true }
                        : feature,
            ),
        );
        expectBodyVolume(body, box(20));

        body.setFeaturesEmitShapeChanged(
            body.features.map(
                (feature): FeatureData =>
                    feature.id === "e1" && feature.type === "extrude" ? { ...feature, depth: 30 } : feature,
            ),
        );

        expectBodyVolume(body, box(30));
        expect(body.featureItems().map((item) => item.error)).toEqual([undefined, undefined]);
    });

    test("a sketch edit reaches the feature that reads it, and only that far", () => {
        const { sketch, body } = filletedBox(20);
        expectBodyVolume(body, box(20) - corner(4, 20));

        // A 20-wide box instead of 40: the fillet follows the same edge of the new box.
        sketch.setDataEmitShapeChanged(rect(-10, -15, 10, 15));

        // The fillet's radius is unchanged, but the box it rounds is not: the volume has to
        // be the new box's, not the old one's with a fillet taken off.
        expectBodyVolume(body, box2(20) - corner(4, 20));
    });
});
