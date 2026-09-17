// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import "../src/features"; // registers all feature handlers
import type { EdgeRef } from "../src/features/edgeRef";
import type { RevolveFeatureData } from "../src/features/feature";
import { featureHandler } from "../src/features/feature";
import type { ProfileRef } from "../src/features/profileRef";

const PROFILES: ProfileRef[] = [
    {
        edges: [{ kind: "line", start: { x: 1, y: 0, z: 0 }, end: { x: 2, y: 0, z: 0 } }],
        center: { x: 1.5, y: 0, z: 0 },
    },
];
const EDGES: EdgeRef[] = [
    { kind: "line", start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0, z: 3 }, edgeId: "e1:4" },
];

describe("FeatureHandler.applyResolvedRefs", () => {
    describe("extrude", () => {
        const base = { id: "e1", type: "extrude", sketchId: "s1", depth: 5 };

        test("writes resolved profiles into a sketch-sourced feature", () => {
            const next = featureHandler("extrude")!.applyResolvedRefs!(base, { resolvedProfiles: PROFILES });
            expect(next).toEqual({ ...base, profiles: PROFILES });
        });

        test("writes resolved profiles into source.profiles of a press-pull feature", () => {
            const feature = { ...base, source: { nodeId: "b1", profiles: [] as ProfileRef[] } };
            const next = featureHandler("extrude")!.applyResolvedRefs!(feature, {
                resolvedProfiles: PROFILES,
            });
            expect(next.source?.profiles).toBe(PROFILES);
            expect(next.profiles).toBeUndefined();
        });

        test("returns the same object without resolved profiles", () => {
            expect(featureHandler("extrude")!.applyResolvedRefs!(base, {})).toBe(base);
        });
    });

    describe("fillet/chamfer", () => {
        test.each([
            { feature: { id: "f1", type: "fillet", radius: 1, edges: [] as EdgeRef[] } },
            { feature: { id: "c1", type: "chamfer", distance: 1, edges: [] as EdgeRef[] } },
        ])("$feature.type writes resolved edges", ({ feature }) => {
            const next = featureHandler(feature.type)!.applyResolvedRefs!(feature, { resolvedEdges: EDGES });
            expect(next.edges).toBe(EDGES);
        });

        test.each([
            { feature: { id: "f1", type: "fillet", radius: 1, edges: [] as EdgeRef[] } },
            { feature: { id: "c1", type: "chamfer", distance: 1, edges: [] as EdgeRef[] } },
        ])("$feature.type returns the same object without resolved edges", ({ feature }) => {
            expect(featureHandler(feature.type)!.applyResolvedRefs!(feature, {})).toBe(feature);
        });
    });

    describe("revolve", () => {
        const base: RevolveFeatureData = {
            id: "r1",
            type: "revolve",
            sketchId: "s1",
            axis: { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } },
            angle: 90,
        };
        const withAxis: RevolveFeatureData = {
            ...base,
            axisSource: {
                nodeId: "b1",
                edge: { kind: "line", start: { x: 0, y: 0, z: 0 }, end: { x: 0, y: 0, z: 1 } },
            },
        };

        test("writes resolved profiles", () => {
            const next = featureHandler("revolve")!.applyResolvedRefs!(base, { resolvedProfiles: PROFILES });
            expect(next).toEqual({ ...base, profiles: PROFILES });
        });

        test("writes the first resolved edge into axisSource.edge", () => {
            const next = featureHandler("revolve")!.applyResolvedRefs!(withAxis, { resolvedEdges: EDGES });
            expect(next.axisSource?.edge).toBe(EDGES[0]);
            expect(next.axisSource?.nodeId).toBe("b1");
        });

        test("applies profiles and the axis edge together", () => {
            const next = featureHandler("revolve")!.applyResolvedRefs!(withAxis, {
                resolvedProfiles: PROFILES,
                resolvedEdges: EDGES,
            });
            expect(next.profiles).toBe(PROFILES);
            expect(next.axisSource?.edge).toBe(EDGES[0]);
        });

        test("resolved edges without an axisSource leave the feature unchanged", () => {
            expect(featureHandler("revolve")!.applyResolvedRefs!(base, { resolvedEdges: EDGES })).toBe(base);
        });

        test("returns the same object without resolved refs", () => {
            expect(featureHandler("revolve")!.applyResolvedRefs!(base, {})).toBe(base);
        });
    });
});
