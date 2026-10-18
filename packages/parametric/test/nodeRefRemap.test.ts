// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import "../src/features"; // registers the handlers whose nodeIds() supply the allowlist
import type { BooleanFeatureData, ExtrudeFeatureData } from "../src/features/feature";
import { remapFeatureRefs } from "../src/features/nodeRefRemap";

describe("remapFeatureRefs", () => {
    test("rewrites every node reference a feature reports", () => {
        const feature: ExtrudeFeatureData = {
            id: "e1",
            type: "extrude",
            sketchId: "sketch-old",
            source: { nodeId: "body-old", profiles: [] },
            endFace: { nodeId: "body-old", profile: { edges: [] } },
            depth: 10,
        };
        const mapping = new Map([
            ["sketch-old", "sketch-new"],
            ["body-old", "body-new"],
        ]);

        const remapped = remapFeatureRefs(feature, mapping) as ExtrudeFeatureData;

        expect(remapped.sketchId).toBe("sketch-new");
        expect(remapped.source?.nodeId).toBe("body-new");
        expect(remapped.endFace?.nodeId).toBe("body-new");
        expect(remapped.depth).toBe(10);
    });

    test("reaches references nested in arrays", () => {
        const feature: BooleanFeatureData = {
            id: "b1",
            type: "boolean",
            operation: "cut",
            toolIds: ["body-old", "other"],
        };

        const remapped = remapFeatureRefs(feature, new Map([["body-old", "body-new"]])) as BooleanFeatureData;

        expect(remapped.toolIds).toEqual(["body-new", "other"]);
    });

    test("replaces only whole ids, never a scoped id that embeds one", () => {
        const feature: ExtrudeFeatureData = {
            id: "e1",
            type: "extrude",
            sketchId: "sketch-old",
            source: {
                nodeId: "body-old",
                profiles: [{ edges: [], id: "sketch:sketch-old:1" }],
            },
            depth: 10,
        };

        const remapped = remapFeatureRefs(
            feature,
            new Map([
                ["sketch-old", "sketch-new"],
                ["body-old", "body-new"],
            ]),
        ) as ExtrudeFeatureData;

        expect(remapped.sketchId).toBe("sketch-new");
        expect(remapped.source?.nodeId).toBe("body-new");
        expect(remapped.source?.profiles[0].id).toBe("sketch:sketch-old:1");
    });

    test("leaves a feature with no references untouched", () => {
        const feature = { id: "s1", type: "shell", thickness: 2 } as never;
        expect(remapFeatureRefs(feature, new Map([["a", "b"]]))).toBe(feature);
    });
});
