// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IShape } from "@chili3d/core";
import type { FeatureTimelineState } from "../src/features/bodyTracking";
import type { EdgeRef } from "../src/features/edgeRef";
import type { FeatureData, LoftSectionData, NeutralPlaneRef } from "../src/features/feature";
import {
    type DependencyTimeline,
    dependencyFeatures,
    dependentFeatures,
    type FeatureSubshapeRefs,
    referencedSubshapeIds,
} from "../src/features/featureDependencies";
import type { ProfileRef } from "../src/features/profileRef";

const HOST = "host";

function state(faceIds?: (string | undefined)[], edgeIds?: (string | undefined)[]): FeatureTimelineState {
    return { shape: {} as IShape, faceIds, edgeIds };
}

function timeline(
    states: (FeatureTimelineState | undefined)[],
    output?: FeatureTimelineState,
): DependencyTimeline {
    return { stateAt: (index) => states[index], outputState: () => output };
}

function edgeRef(edgeId?: string): EdgeRef {
    return { kind: "line", start: { x: 0, y: 0, z: 0 }, end: { x: 1, y: 0, z: 0 }, edgeId };
}

function profileRef(id?: string): ProfileRef {
    return { edges: [], id };
}

function extrude(id: string, extra?: Record<string, unknown>): FeatureData {
    return { id, type: "extrude", depth: 5, ...extra } as FeatureData;
}

function fillet(id: string, ...edgeIds: (string | undefined)[]): FeatureData {
    return { id, type: "fillet", radius: 1, edges: edgeIds.map((edgeId) => edgeRef(edgeId)) };
}

function refsOf(feature: FeatureData): FeatureSubshapeRefs {
    return referencedSubshapeIds(feature, HOST);
}

describe("dependentFeatures", () => {
    test("flags a downstream feature whose ref names an id the feature contributed", () => {
        const features = [extrude("f1"), fillet("f2", "e-born")];
        const tl = timeline([undefined, state(["fa"], ["e-born", "e-x"])]);

        expect(dependentFeatures(tl, features, 0, HOST)).toEqual(["f2"]);
    });

    test("ignores refs carried THROUGH the feature — only what it births counts", () => {
        const features = [extrude("f1"), extrude("f2"), fillet("f3", "e1")];
        const tl = timeline([undefined, state(["fa"], ["e1"]), state(["fa", "fb"], ["e1", "e-born2"])]);

        // Feature 1 contributed only "e-born2"/"fb"; the fillet names feature 0's edge.
        expect(dependentFeatures(tl, features, 1, HOST)).toEqual([]);
        // Suppressing feature 0 strands that same ref: everything is its contribution.
        expect(dependentFeatures(tl, features, 0, HOST)).toEqual(["f3"]);
    });

    test("a downstream ref on a merged (compound) id does not count as the feature's contribution", () => {
        const features = [
            extrude("f1"),
            extrude("f2"),
            extrude("f3", { source: { nodeId: HOST, profiles: [profileRef("A|B")] } }),
        ];
        // Feature 1 merged faces A and B: the compound still overlaps both inputs.
        const tl = timeline([undefined, state(["A", "B"], []), state(["A|B"], [])]);

        expect(dependentFeatures(tl, features, 1, HOST)).toEqual([]);
    });

    test("refs onto OTHER nodes never count, even when the id strings collide", () => {
        const features = [
            extrude("f1"),
            extrude("f2", { source: { nodeId: "other-body", profiles: [profileRef("fa")] } }),
        ];
        const tl = timeline([undefined, state(["fa"], [])]);

        expect(dependentFeatures(tl, features, 0, HOST)).toEqual([]);
    });

    test("a kind the chain could not track under-warns instead of guessing", () => {
        const edgeOnly = timeline([undefined, state(undefined, ["e1"]), state(undefined, ["e1", "e-born"])]);
        // Faces are untracked: the downstream face ref cannot be attributed either way.
        const faceDependent = [
            extrude("f1"),
            extrude("f2"),
            extrude("f3", { source: { nodeId: HOST, profiles: [profileRef("fa")] } }),
        ];
        expect(dependentFeatures(edgeOnly, faceDependent, 1, HOST)).toEqual([]);

        const edgeDependent = [extrude("f1"), extrude("f2"), fillet("f3", "e-born")];
        expect(dependentFeatures(edgeOnly, edgeDependent, 1, HOST)).toEqual(["f3"]);
    });

    test("returns undefined when no kind is tracked at all", () => {
        const features = [extrude("f1"), fillet("f2", "e-born")];

        expect(dependentFeatures(timeline([undefined, state()]), features, 0, HOST)).toBeUndefined();
    });

    test("returns undefined for a feature the committed run never reached", () => {
        const features = [extrude("f1"), fillet("f2", "e-born")];
        // Only index 0 was visited (a rollback truncated the run).
        const tl = timeline([undefined], state(["fa"], ["e-born"]));

        expect(dependentFeatures(tl, features, 1, HOST)).toBeUndefined();
    });

    test("the last evaluated feature's after-state is the chain output", () => {
        const features = [extrude("f1"), fillet("f2", "e-born")];
        // No state entering a (nonexistent) third feature: the output stands in.
        const withOutput = timeline([undefined, state(["fa"], ["e1"])], state(["fa", "f-fillet"], ["e1"]));
        expect(dependentFeatures(withOutput, features, 1, HOST)).toEqual([]);
        // Without it the contribution is unknowable.
        expect(
            dependentFeatures(timeline([undefined, state(["fa"], ["e1"])]), features, 1, HOST),
        ).toBeUndefined();
    });

    test("a suppressed downstream feature is listed — its refs dangle once it comes back", () => {
        const features = [extrude("f1"), { ...fillet("f2", "e-born"), suppressed: true } as FeatureData];
        const tl = timeline([undefined, state(["fa"], ["e-born"])]);

        expect(dependentFeatures(tl, features, 0, HOST)).toEqual(["f2"]);
    });

    test("returns undefined for an out-of-range index", () => {
        expect(dependentFeatures(timeline([]), [extrude("f1")], 5, HOST)).toBeUndefined();
    });
});

describe("dependencyFeatures", () => {
    test("the first feature depends on nothing", () => {
        expect(dependencyFeatures(timeline([undefined]), [extrude("f1")], 0, HOST)).toEqual([]);
    });

    test("lists the upstream features whose contributed ids the feature's refs name", () => {
        const features = [extrude("f1"), extrude("f2"), fillet("f3", "e1", "e-born2")];
        const tl = timeline([undefined, state(["fa"], ["e1"]), state(["fa", "fb"], ["e1", "e-born2"])]);

        // f3 names an edge f0 birthed ("e1") and one f1 birthed ("e-born2").
        expect(dependencyFeatures(tl, features, 2, HOST)).toEqual(["f1", "f2"]);
        // f2 names nothing — no upstream dependency.
        expect(dependencyFeatures(tl, features, 1, HOST)).toEqual([]);
    });

    test("ignores refs carried through an intermediate feature", () => {
        const features = [extrude("f1"), extrude("f2"), fillet("f3", "e1")];
        const tl = timeline([undefined, state(["fa"], ["e1"]), state(["fa", "fb"], ["e1", "e-born2"])]);

        expect(dependencyFeatures(tl, features, 2, HOST)).toEqual(["f1"]);
    });

    test("a ref onto another node never counts, even when the id strings collide", () => {
        const features = [
            extrude("f1"),
            extrude("f2", { source: { nodeId: "other-body", profiles: [profileRef("fa")] } }),
        ];
        const tl = timeline([undefined, state(["fa"], [])]);

        expect(dependencyFeatures(tl, features, 1, HOST)).toEqual([]);
    });

    test("returns undefined when the run never reached the feature", () => {
        const features = [extrude("f1"), fillet("f2", "e-born")];
        // Only index 0 was visited (a rollback truncated the run).
        expect(
            dependencyFeatures(timeline([undefined], state(["fa"], ["e-born"])), features, 1, HOST),
        ).toBeUndefined();
    });

    test("returns undefined for an out-of-range index", () => {
        expect(dependencyFeatures(timeline([]), [extrude("f1")], 5, HOST)).toBeUndefined();
    });
});

describe("referencedSubshapeIds", () => {
    test("fillet and chamfer name their edges", () => {
        expect(refsOf(fillet("f", "e1", undefined, "e2"))).toEqual({ faces: [], edges: ["e1", "e2"] });
        const chamfer = { id: "c", type: "chamfer", distance: 1, edges: [edgeRef("e3")] } as FeatureData;
        expect(refsOf(chamfer)).toEqual({ faces: [], edges: ["e3"] });
    });

    test("shell and draft name their faces; draft also names a host neutral plane", () => {
        const shell = { id: "s", type: "shell", faces: [profileRef("fa")], thickness: 1 } as FeatureData;
        expect(refsOf(shell)).toEqual({ faces: ["fa"], edges: [] });

        const plane: NeutralPlaneRef = {
            kind: "face",
            ref: { nodeId: HOST, normal: { x: 0, y: 0, z: 1 }, offset: 0, faceId: "fp" },
        };
        const draft = {
            id: "d",
            type: "draft",
            faces: [profileRef("fa")],
            neutralPlane: plane,
            angle: 3,
        } as FeatureData;
        expect(refsOf(draft)).toEqual({ faces: ["fa", "fp"], edges: [] });

        const datum: NeutralPlaneRef = { kind: "datum", name: "XY" };
        expect(refsOf({ ...draft, neutralPlane: datum } as FeatureData)).toEqual({
            faces: ["fa"],
            edges: [],
        });
    });

    test("mirror names a host plane face only", () => {
        const mirror = (nodeId: string): FeatureData =>
            ({
                id: "m",
                type: "mirror",
                plane: {
                    kind: "face",
                    ref: { nodeId, normal: { x: 0, y: 0, z: 1 }, offset: 0, faceId: "fp" },
                },
            }) as FeatureData;
        expect(refsOf(mirror(HOST))).toEqual({ faces: ["fp"], edges: [] });
        expect(refsOf(mirror("other-body"))).toEqual({ faces: [], edges: [] });
    });

    test("hole names its host seat face only", () => {
        const hole = (nodeId: string, faceId?: string): FeatureData =>
            ({
                id: "h",
                type: "hole",
                face: { nodeId, normal: { x: 0, y: 0, z: 1 }, offset: 0, faceId },
                points: [[1, 1]],
                style: "simple",
                diameter: 5,
            }) as FeatureData;
        expect(refsOf(hole(HOST, "fh"))).toEqual({ faces: ["fh"], edges: [] });
        expect(refsOf(hole("other-body", "fh"))).toEqual({ faces: [], edges: [] });
        // No tracked faceId (a fingerprint-only ref) names nothing the id algebra can track.
        expect(refsOf(hole(HOST))).toEqual({ faces: [], edges: [] });
    });

    test("extrude names own-chain source/end faces and direction, not foreign ones", () => {
        const feature = extrude("e", {
            profiles: [profileRef("p1")],
            source: { nodeId: HOST, profiles: [profileRef("s1")] },
            endFace: { nodeId: HOST, profile: profileRef("t1") },
            direction: { nodeId: HOST, edge: edgeRef("d1") },
        });
        expect(refsOf(feature)).toEqual({ faces: ["p1", "s1", "t1"], edges: ["d1"] });

        const foreign = extrude("e", {
            source: { nodeId: "other", profiles: [profileRef("s1")] },
            endFace: { nodeId: "other", profile: profileRef("t1") },
            direction: { nodeId: "other", edge: edgeRef("d1") },
        });
        expect(refsOf(foreign)).toEqual({ faces: [], edges: [] });
    });

    test("revolve names its own-chain axis edge and profile ids", () => {
        const feature = {
            id: "r",
            type: "revolve",
            sketchId: "sk",
            axis: { point: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: 1 } },
            axisSource: { nodeId: HOST, edge: edgeRef("a1") },
            angle: 90,
            profiles: [profileRef("p1")],
        } as FeatureData;
        expect(refsOf(feature)).toEqual({ faces: ["p1"], edges: ["a1"] });
    });

    test("sweep names own-chain source faces and path edges", () => {
        const feature = {
            id: "s",
            type: "sweep",
            source: { nodeId: HOST, profiles: [profileRef("s1")] },
            path: { nodeId: HOST, edges: [edgeRef("p1"), edgeRef()] },
        } as FeatureData;
        expect(refsOf(feature)).toEqual({ faces: ["s1"], edges: ["p1"] });
    });

    test("thicken names its own-chain source faces", () => {
        const feature = {
            id: "t",
            type: "thicken",
            source: { nodeId: HOST, profiles: [profileRef("s1")] },
            thickness: 2,
        } as FeatureData;
        expect(refsOf(feature)).toEqual({ faces: ["s1"], edges: [] });
    });

    test("loft names host profile and edge sections; vertices carry no id", () => {
        const sections: LoftSectionData[] = [
            { kind: "profile", nodeId: HOST, profile: profileRef("p1") },
            { kind: "edge", nodeId: HOST, edge: edgeRef("e1") },
            { kind: "vertex", nodeId: HOST, vertex: { point: { x: 0, y: 0, z: 0 } } },
            { kind: "profile", nodeId: "other", profile: profileRef("p2") },
        ];
        const feature = {
            id: "l",
            type: "loft",
            sections,
            isSolid: true,
            isRuled: false,
            continuity: "g1",
        } as unknown as FeatureData;
        expect(refsOf(feature)).toEqual({ faces: ["p1"], edges: ["e1"] });
    });

    test("patterns name their own-chain direction and axis edges", () => {
        const linear = {
            id: "p",
            type: "pattern",
            mode: "linear",
            count: 3,
            spacing: 10,
            direction: { nodeId: HOST, edge: edgeRef("d1") },
            direction2: { nodeId: "other", edge: edgeRef("d2") },
        } as FeatureData;
        expect(refsOf(linear)).toEqual({ faces: [], edges: ["d1"] });

        const circular = {
            id: "p",
            type: "pattern",
            mode: "circular",
            count: 3,
            axis: { nodeId: HOST, edge: edgeRef("a1") },
        } as FeatureData;
        expect(refsOf(circular)).toEqual({ faces: [], edges: ["a1"] });

        const curve = {
            id: "p",
            type: "pattern",
            mode: "curve",
            count: 3,
            path: { nodeId: HOST, edges: [edgeRef("e1"), edgeRef("e2")] },
        } as FeatureData;
        expect(refsOf(curve)).toEqual({ faces: [], edges: ["e1", "e2"] });

        const foreignPath = {
            ...curve,
            path: { nodeId: "other", edges: [edgeRef("e3")] },
        } as FeatureData;
        expect(refsOf(foreignPath)).toEqual({ faces: [], edges: [] });
    });

    test("a primitive names its own-chain direction override", () => {
        const feature = {
            id: "b",
            type: "primitive",
            primitive: "box",
            direction: { nodeId: HOST, edge: edgeRef("d1") },
        } as FeatureData;
        expect(refsOf(feature)).toEqual({ faces: [], edges: ["d1"] });
        expect(refsOf(extrude("e"))).toEqual({ faces: [], edges: [] });
    });

    test("booleans and ribs name nodes and sketch entities, not tracked sub-shapes", () => {
        const boolean = { id: "b", type: "boolean", operation: "fuse", toolIds: ["t1"] } as FeatureData;
        expect(refsOf(boolean)).toEqual({ faces: [], edges: [] });
        const rib = { id: "r", type: "rib", sketchId: "sk", entityIds: [1, 2], thickness: 2 } as FeatureData;
        expect(refsOf(rib)).toEqual({ faces: [], edges: [] });
    });
});

describe("the dependency cache", () => {
    test("a rebuilt chain is recomputed, never served stale", () => {
        // The timeline OBJECT outlives a rebuild — a body owns one and `commit` swaps its arrays in
        // place — so an answer cached by timeline alone would freeze at the first ask and describe
        // the wrong feature as soon as rows shift under an edit.
        const features = [
            { id: "f0", type: "offsetFace", faces: [], distance: 1 },
            { id: "f1", type: "offsetFace", faces: [{ id: "born0" }], distance: 1 },
        ] as unknown as FeatureData[];
        let states = [
            { shape: {}, faceIds: [], edgeIds: [] },
            { shape: {}, faceIds: ["born0", "kept"], edgeIds: [] },
            { shape: {}, faceIds: ["born0", "kept"], edgeIds: [] },
        ];
        const timeline = {
            stateAt: (index: number) => states[index],
            outputState: () => states[states.length - 1],
        } as unknown as DependencyTimeline;

        // First run: f0's state contributed `born0`, which f1 names.
        expect(dependencyFeatures(timeline, features, 1, "host")).toEqual(["f0"]);

        // Second run, same objects: f0 now contributes nothing, so the same question has a
        // different answer and a cache that only knew the index would miss it.
        states = [
            { shape: {}, faceIds: [], edgeIds: [] },
            { shape: {}, faceIds: [], edgeIds: [] },
            { shape: {}, faceIds: [], edgeIds: [] },
        ];
        expect(dependencyFeatures(timeline, features, 1, "host")).toEqual([]);
    });

    test("a multi-component id is judged by every component it names", () => {
        // `idsOverlap` is component intersection, so "is this id new?" is asked of each of its
        // components — an id that shares one with anything the state already had is not new.
        const features = [
            { id: "f0", type: "offsetFace", faces: [], distance: 1 },
            { id: "f1", type: "offsetFace", faces: [{ id: "B|C" }], distance: 1 },
        ] as unknown as FeatureData[];
        const states = [
            { shape: {}, faceIds: [], edgeIds: [] },
            { shape: {}, faceIds: ["A|B"], edgeIds: [] },
            { shape: {}, faceIds: ["A|B", "B|C"], edgeIds: [] },
        ];
        const timeline = {
            stateAt: (index: number) => states[index],
            outputState: () => states[states.length - 1],
        } as unknown as DependencyTimeline;

        // f0 supplied `A|B`, which f1's `B|C` overlaps on `B` — so f1 depends on f0, and that is
        // the same reading the pairwise scan gave.
        expect(dependencyFeatures(timeline, features, 1, "host")).toEqual(["f0"]);
    });
});
