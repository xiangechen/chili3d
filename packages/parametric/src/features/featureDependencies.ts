// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { FeatureTimelineState } from "./bodyTracking";
import type { EdgeRef } from "./edgeRef";
import type { FeatureData, LoftSectionData, NeutralPlaneRef, PatternFeatureData } from "./feature";
import type { ProfileRef } from "./profileRef";
import { ID_COMPONENT_SEPARATOR } from "./trackedId";

/**
 * The suppression-cascade hint: which downstream features reference geometry a feature
 * CONTRIBUTES to the chain, so suppressing it strands their picks.
 *
 * The detection is pure id algebra over the tracked ids the chain already computes — no
 * kernel queries, and deliberately no scan of the serialized feature JSON: each feature
 * type's reference fields are read by name (`referencedSubshapeIds`), and a feature's
 * contribution is the set difference of the chain states bracketing it
 * (`contributedIds`). A downstream feature whose stored refs overlap that contribution
 * is reported.
 *
 * The hint is best-effort by design:
 * - Kinds the chain could not track (undefined id arrays) are skipped, so the answer
 *   under-warns rather than guessing.
 * - Only the body's OWN ids are considered — a ref onto another node (`source`,
 *   `endFace`, a direction edge of a different body) lives in that node's id space,
 *   where suppressing a feature here removes nothing. Two bodies seeded from the same
 *   sketch can otherwise share id strings and report phantom dependents.
 * - The committed timeline is indexed by feature position, so an edited list whose
 *   rebuild failed can misalign it; the odd false positive costs one confirm dialog,
 *   and confirming suppresses either way.
 */

/** The tracked sub-shape ids a feature's stored references name, by kind. */
export interface FeatureSubshapeRefs {
    readonly faces: readonly string[];
    readonly edges: readonly string[];
}

/** The timeline slice `dependentFeatures` reads — adapted from `BodyTimeline` by the node. */
export interface DependencyTimeline {
    /** Chain state entering a feature-list index; undefined when the run never reached it. */
    stateAt(index: number): FeatureTimelineState | undefined;
    /** The chain's final output — the after-state of the last evaluated feature. */
    outputState(): FeatureTimelineState | undefined;
}

/**
 * Ids of the downstream features (index order) whose stored refs name geometry the
 * feature at `featureIndex` contributes. Undefined when the contribution is unknowable:
 * the feature sits past the evaluated prefix (a rollback truncated the run), or no id
 * tracking survived it. Downstream features are checked whether suppressed or not —
 * a suppressed one's refs dangle just the same once it comes back.
 */
export function dependentFeatures(
    timeline: DependencyTimeline,
    features: readonly FeatureData[],
    featureIndex: number,
    hostId: string,
): string[] | undefined {
    if (features[featureIndex] === undefined) return undefined;
    // The state entering the feature: feature 0 is the chain start (empty input, no
    // state recorded); any other index must have been visited by the committed run.
    const before = featureIndex === 0 ? undefined : timeline.stateAt(featureIndex);
    if (featureIndex > 0 && before === undefined) return undefined;
    // The state after it: the state entering the next feature, or the chain output
    // when this feature was the run's last.
    const after = timeline.stateAt(featureIndex + 1) ?? timeline.outputState();
    if (after === undefined) return undefined;
    const contributed = contributedAt(timeline, featureIndex, after);
    if (contributed === undefined) return undefined;
    if (contributed.faces === undefined && contributed.edges === undefined) return undefined;
    const dependents: string[] = [];
    for (let index = featureIndex + 1; index < features.length; index++) {
        if (referencesAny(referencedSubshapeIds(features[index], hostId), contributed)) {
            dependents.push(features[index].id);
        }
    }
    return dependents;
}

/**
 * Ids of the UPSTREAM features whose contributed geometry the feature at `featureIndex`
 * references — the inverse of `dependentFeatures`, for the panel's "depends on" line.
 * Same best-effort contract: undefined when the run never reached `featureIndex`;
 * upstream features a kind of which is untracked simply contribute no matches, so the
 * line under-reports rather than guessing.
 */
export function dependencyFeatures(
    timeline: DependencyTimeline,
    features: readonly FeatureData[],
    featureIndex: number,
    hostId: string,
): string[] | undefined {
    const feature = features[featureIndex];
    if (feature === undefined) return undefined;
    if (featureIndex === 0) return [];
    // The state entering the feature: proof the committed run reached it.
    if (timeline.stateAt(featureIndex) === undefined) return undefined;
    const refs = referencedSubshapeIds(feature, hostId);
    const dependencies: string[] = [];
    for (let index = 0; index < featureIndex; index++) {
        const born = contributedAt(timeline, index, timeline.stateAt(index + 1));
        if (born === undefined) return undefined;
        if (referencesAny(refs, born)) {
            dependencies.push(features[index].id);
        }
    }
    return dependencies;
}

/** Tracked ids of a kind the feature brought into the chain — undefined when that kind is untracked. */
interface ContributedIds {
    readonly faces?: readonly string[];
    readonly edges?: readonly string[];
}

/**
 * The ids `after` carries that nothing in `before` answers to — the sub-shapes born
 * between the two states. Carried-through ids overlap a `before` entry and are excluded
 * (including the pieces of a split, which keep their shared id, and a merged face's
 * compound, which overlaps each ancestor). `before` undefined is the chain start
 * (feature 0), where everything is contributed; a kind untracked on either side comes
 * back undefined.
 */
function contributedIds(
    before: FeatureTimelineState | undefined,
    after: FeatureTimelineState,
): ContributedIds {
    return {
        faces: bornIds(before?.faceIds, after.faceIds, before === undefined),
        edges: bornIds(before?.edgeIds, after.edgeIds, before === undefined),
    };
}

function bornIds(
    beforeIds: readonly (string | undefined)[] | undefined,
    afterIds: readonly (string | undefined)[] | undefined,
    chainStart: boolean,
): string[] | undefined {
    if (afterIds === undefined || (!chainStart && beforeIds === undefined)) return undefined;
    // One SET of the earlier state's components, not a pairwise scan: `idsOverlap` is component
    // intersection, so "some earlier id overlaps this one" is exactly "one of this id's components
    // is in that union", and asking it per (old, new) pair meant splitting both sides O(n²) times:
    // measured, ~40000 `idsOverlap` calls per pair of 200-id states, which a 50-feature panel pass
    // paid once per feature — 177 ms of a redraw, against 5 ms for the union, which answers
    // identically.
    const earlier = componentPool(beforeIds);
    const born: string[] = [];
    for (const id of afterIds) {
        if (id === undefined) continue;
        if (id.split(ID_COMPONENT_SEPARATOR).some((component) => earlier.has(component))) continue;
        born.push(id);
    }
    return born;
}

/** Every component named by `ids`, as one set — the "does anything here overlap me" test. */
function componentPool(ids: readonly (string | undefined)[] | undefined): Set<string> {
    const pool = new Set<string>();
    for (const id of ids ?? []) {
        if (id === undefined) continue;
        for (const component of id.split(ID_COMPONENT_SEPARATOR)) pool.add(component);
    }
    return pool;
}

function referencesAny(refs: FeatureSubshapeRefs, contributed: ContributedIds): boolean {
    // The same union trick as `bornIds`, from the other side: the contributed ids are pooled once
    // and each ref is looked up in it, rather than every (ref, contributed) pair being intersected.
    const overlaps = (ids: readonly string[], contributedIds: readonly string[]) => {
        const pool = componentPool(contributedIds);
        return ids.some((id) => id.split(ID_COMPONENT_SEPARATOR).some((component) => pool.has(component)));
    };
    return (
        (contributed.faces !== undefined && overlaps(refs.faces, contributed.faces)) ||
        (contributed.edges !== undefined && overlaps(refs.edges, contributed.edges))
    );
}

/**
 * The tracked ids `feature`'s stored references name, extracted per feature type from
 * the typed fields alone. Only refs onto the HOST's own chain (`nodeId === hostId`, or
 * the inherently own-chain refs: fillet/chamfer edges, shell/draft faces) count — see
 * the module header. A ref without an id (a sketch-side profile fingerprint, a bare
 * vertex, a datum plane) names nothing the id algebra can track and is skipped.
 */
export function referencedSubshapeIds(feature: FeatureData, hostId: string): FeatureSubshapeRefs {
    switch (feature.type) {
        case "fillet":
        case "chamfer":
            return { faces: [], edges: edgeRefIds(feature.edges) };
        case "shell":
            return { faces: profileRefIds(feature.faces), edges: [] };
        case "offsetFace":
            return { faces: profileRefIds(feature.faces), edges: [] };
        case "removeFeature":
            return { faces: profileRefIds(feature.faces), edges: [] };
        case "split":
            return { faces: planeRefIds(feature.tool, hostId), edges: [] };
        case "draft":
            return {
                faces: [...profileRefIds(feature.faces), ...planeRefIds(feature.neutralPlane, hostId)],
                edges: [],
            };
        case "mirror":
            return { faces: planeRefIds(feature.plane, hostId), edges: [] };
        case "hole":
            // The hole's seat face is a bare PlaneFaceRef (no kind wrapper like a neutral
            // plane); sketchPoints name the sketch's entities, carried by nodeIds already.
            return {
                faces:
                    feature.face.nodeId === hostId && feature.face.faceId !== undefined
                        ? [feature.face.faceId]
                        : [],
                edges: [],
            };
        case "extrude":
            return {
                faces: [
                    ...profileRefIds(feature.profiles),
                    ...sourceProfileIds(feature.source, hostId),
                    ...(feature.endFace?.nodeId === hostId ? profileRefIds([feature.endFace.profile]) : []),
                ],
                edges: feature.direction?.nodeId === hostId ? edgeRefIds([feature.direction.edge]) : [],
            };
        case "revolve":
            return {
                faces: profileRefIds(feature.profiles),
                edges: feature.axisSource?.nodeId === hostId ? edgeRefIds([feature.axisSource.edge]) : [],
            };
        case "sweep":
            return {
                faces: [...profileRefIds(feature.profiles), ...sourceProfileIds(feature.source, hostId)],
                edges: feature.path.nodeId === hostId ? edgeRefIds(feature.path.edges) : [],
            };
        case "thicken":
            return { faces: sourceProfileIds(feature.source, hostId), edges: [] };
        case "loft":
            return loftSectionIds(feature.sections, hostId);
        case "pattern":
            return { faces: [], edges: patternLineIds(feature, hostId) };
        // The features whose only tracked-subshape reference is a `direction` line edge.
        case "primitive":
        case "helix":
            return {
                faces: [],
                edges: feature.direction?.nodeId === hostId ? edgeRefIds([feature.direction.edge]) : [],
            };
        // A boolean names whole NODES (its tools) and a rib the sketch's own entity
        // ids — neither is a tracked sub-shape id of this chain. An unknown future
        // type answers "no refs" rather than failing the hint.
        default:
            return { faces: [], edges: [] };
    }
}

function profileRefIds(refs: readonly ProfileRef[] | undefined): string[] {
    return refs?.flatMap((ref) => (ref.id === undefined ? [] : [ref.id])) ?? [];
}

function edgeRefIds(refs: readonly EdgeRef[]): string[] {
    return refs.flatMap((ref) => (ref.edgeId === undefined ? [] : [ref.edgeId]));
}

/** A `source` names the host's own faces only when its node IS the host. */
function sourceProfileIds(
    source: { readonly nodeId: string; readonly profiles: readonly ProfileRef[] } | undefined,
    hostId: string,
): string[] {
    return source?.nodeId === hostId ? profileRefIds(source.profiles) : [];
}

function planeRefIds(plane: NeutralPlaneRef, hostId: string): string[] {
    if (plane.kind !== "face" || plane.ref.nodeId !== hostId || plane.ref.faceId === undefined) return [];
    return [plane.ref.faceId];
}

function loftSectionIds(sections: readonly LoftSectionData[], hostId: string): FeatureSubshapeRefs {
    const faces: string[] = [];
    const edges: string[] = [];
    for (const section of sections) {
        if (section.nodeId !== hostId) continue;
        if (section.kind === "profile" && section.profile.id !== undefined) faces.push(section.profile.id);
        if (section.kind === "edge" && section.edge.edgeId !== undefined) edges.push(section.edge.edgeId);
    }
    return { faces, edges };
}

function patternLineIds(feature: PatternFeatureData, hostId: string): string[] {
    const sources = feature.mode === "linear" ? [feature.direction, feature.direction2] : [feature.axis];
    return sources.flatMap((source) =>
        source?.nodeId === hostId && source.edge.edgeId !== undefined ? [source.edge.edgeId] : [],
    );
}

/**
 * What `index` added to the chain, where `after` is the state the caller measures it against:
 * `stateAt(index + 1)` mid-chain, or `outputState()` for the last feature (the timeline array never
 * records that one). `before` is `stateAt(index)`.
 *
 * **Why a cache.** The panel asks this once per ROW as it renders, and the work is an id-by-id
 * overlap per pair (`contributedIds`), so asking it per row made one redraw cost rows² × ids².
 * Over a 50-feature chain whose states carry 200 ids, one pass over the rows (what a redraw does):
 * 8101 ms with the answer recomputed per row, and an order of magnitude of ten milliseconds once it
 * is kept per index AND `bornIds` stopped intersecting ids PAIRWISE (see it) — the second change is
 * the one that mattered, the cache alone left the per-index work at 177 ms.
 *
 * That figure moves with the chain's SHAPE — how many ids each state really adds is what sizes the
 * component pools — so read it as an order of magnitude, not a baseline to regress against.
 *
 * **Why the two states are remembered with the answer.** The timeline OBJECT outlives a rebuild: a
 * body owns one (`_timeline`) and `commit` swaps its arrays in place, so keying the cache by the
 * timeline alone froze every answer at whatever the first ask computed and never noticed an edit —
 * with rows shifting under an inserted feature, the entry for index k described a different feature
 * than the one being asked about. Comparing the states by identity is what makes a hit mean "the
 * same inputs": every run pushes FRESH state objects, so a rebuild misses and recomputes, while the
 * rows of one render all hit.
 */
function contributedAt(
    timeline: DependencyTimeline,
    index: number,
    after: FeatureTimelineState | undefined,
): ContributedIds | undefined {
    const before = index === 0 ? undefined : timeline.stateAt(index);
    let byIndex = contributedCache.get(timeline);
    if (byIndex === undefined) {
        byIndex = new Map();
        contributedCache.set(timeline, byIndex);
    }
    const known = byIndex.get(index);
    if (known !== undefined && known.before === before && known.after === after) return known.value;

    const value = after === undefined ? undefined : contributedIds(before, after);
    byIndex.set(index, { before, after, value });
    return value;
}

/** One remembered answer, with the states that produced it — see `contributedAt`. */
interface ContributedEntry {
    readonly before: FeatureTimelineState | undefined;
    readonly after: FeatureTimelineState | undefined;
    readonly value: ContributedIds | undefined;
}

/** Keyed by the timeline, then by index — see `contributedAt` for what makes a hit valid. */
const contributedCache = new WeakMap<DependencyTimeline, Map<number, ContributedEntry>>();
