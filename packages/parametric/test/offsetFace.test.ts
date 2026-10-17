// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { LENGTH_UNITS } from "@chili3d/core";
import { createMockApplication, TestDocument } from "@chili3d/core/test-utils";
import "../src/features"; // registers all feature handlers
import { featureHandler, type OffsetFaceFeatureData } from "../src/features/feature";
import { ParametricBodyNode } from "../src/parametricBodyNode";

describe("offset face feature", () => {
    let doc: TestDocument;

    beforeEach(() => {
        doc = new TestDocument({ application: createMockApplication() });
    });

    function offsetFeature(overrides?: Partial<OffsetFaceFeatureData>): OffsetFaceFeatureData {
        return { id: "o1", type: "offsetFace", faces: [], distance: 2, ...overrides };
    }

    function bodyWith(features: OffsetFaceFeatureData[]) {
        const body = new ParametricBodyNode({ document: doc, features });
        doc.modelManager.addNode(body);
        return body;
    }

    test("is registered with its ribbon identity and reselect", () => {
        const handler = featureHandler("offsetFace");
        expect(handler).toBeDefined();
        expect(handler!.display).toBe("command.feature.offsetFace");
        expect(handler!.icon).toBe("icon-offset");
        expect(handler!.reselectable).toBe(true);
    });

    test("the distance is an editable length row", () => {
        const distance = featureHandler("offsetFace")!.parameters!(offsetFeature()).find(
            (x) => x.key === "distance",
        );

        expect(distance).toEqual({
            key: "distance",
            display: "option.command.distance",
            value: 2,
            unit: LENGTH_UNITS,
        });
    });

    test("a distance of 0 fails loudly instead of moving nothing", () => {
        // Checked before the chain is even looked at: the feature's own value is impossible, and
        // a kernel that "succeeds" with the body unchanged would read as a feature that did
        // nothing rather than one that was wrong.
        const body = bodyWith([offsetFeature({ distance: 0 })]);

        expect(body.shape.isOk).toBe(false);
        expect(body.featureItems()[0].error).toBe("Offset Face: the distance is 0, so nothing moves");
    });

    test("a negative distance passes the sign check and fails only for the missing chain", () => {
        const body = bodyWith([offsetFeature({ distance: -5 })]);

        expect(body.shape.isOk).toBe(false);
        expect(body.featureItems()[0].error).toBe("Offset Face requires a preceding feature");
    });

    test("setParameter writes the distance back", () => {
        const handler = featureHandler("offsetFace")!;
        const updated = handler.setParameter!(offsetFeature(), "distance", "6 mm");

        expect(updated).toEqual(offsetFeature({ distance: "6 mm" }));
    });
});
