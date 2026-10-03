// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IEdge, type IFace, type Matrix4, ShapeTypes, type XYZLike } from "@chili3d/core";
import {
    edgeLiesOnImage,
    profileEdgeEntityIds,
    profileEdgeSeedSuffixes,
    profileEntityIds,
} from "./profileEntities";
import { captureRegionFingerprint } from "./profileRef";
import { distance, MATCH_TOLERANCE, plainVec } from "./refGeometry";
import { boundaryId, derivedId, writeUncontestedIds } from "./trackedId";

/**
 * Content-derived seed keys for profile regions and their boundary edges.
 *
 * A seed becomes the stem of the stable ids a sweep gives the geometry it generates from
 * a profile (see `sweepFaceTracked` in sweepTracked.ts). It has to be derived from what the
 * region IS, not from where it sits in an enumeration: the kernel is free to re-enumerate
 * faces and edges after any rebuild, and a positional stem would then silently realign
 * onto a neighbour. Entity ids are the sketch's own stable identity, so they are the stem.
 *
 * ## The id grammar (`<seed>` = `sketch:<nodeId>:<profileSeed>`)
 *
 * Every generated sub-shape of a sweep or fillet is named by one of these, all ATOMIC
 * (`ID_COMPONENT_SEPARATOR` is `|` and `idsOverlap` compares component-wise, so a stem
 * carrying `|` would intersect its neighbours' ids — see `trackedId.ts`):
 *
 * | shape                     | id                          | where |
 * | ------------------------- | --------------------------- | ----- |
 * | region (the profile face) | `<seed>`                    | `profileSeeds` |
 * | swept end face            | `<seed>:top`                | `seedTopFace` |
 * | profile edge's bottom     | `<seed>:ent<N>`             | `profileEdgeSeeds` |
 * | its swept image (prism)   | `<seed>:ent<N>:top`         | `attributeSweepEdges` |
 * | its swept image (revolve) | `<seed>:ent<N>:cap`         | `attributeSweepEdges` |
 * | swept profile corner      | `<seed>:v<a>.<b>`           | `attributeSweepEdges` |
 * | a fillet's new edge       | `feature:<id>:<inputEdgeId>:f<face>` | `attributeCornerEdges` |
 * | a fillet's new face       | `feature:<id>:<inputEdgeId>:f`       | `attributeCornerFaces` |
 *
 * The corner's names carry the producing FEATURE (`prefixedId`), unlike everything above: a
 * corner derives its names from its input edge, and the two pieces of one split edge border the
 * same face pair — so two corners on those two pieces compute one identical name without a
 * scope of their own (`attributeCornerEdges` measures it).
 *
 * `<a>.<b>` are the entity ids meeting at the corner, sorted. The swept image of an edge
 * takes the sweep's own word for its far end (`imageSuffix` in `attributeSweepEdges`): `:top`
 * for a prism, `:cap` for a revolve, matching the end FACE's name. The suffix is hung off with
 * `derivedId`, so a `<seed>` that is itself a compound keeps every leaf carrying it.
 *
 * The `<seed>` above is a sketch profile's. A press-pull sweeps a BODY face, which has no entity
 * attribution, so its seeds are that face's own tracked ids, CONJOINED with the sweep's identity
 * and a marker of its own (`push` for a press-pull, `sweep` for a path sweep of a body
 * face — see `sweep.ts`):
 *
 * | shape                       | id                                              | where |
 * | --------------------------- | ----------------------------------------------- | ----- |
 * | the face's edge, as swept    | `boundaryId([<pressedFaceId>, push, <edgeId>])` | `sweepFaceTracked` |
 * | its swept image             | that, plus `:top`                                | `attributeSweepEdges` |
 * | a corner of the face, swept  | `boundaryId([<edgeId>, <edgeId>])`               | `faceCornerSeeds` |
 *
 * The conjoined pressed face is what keeps a press-pull's names its own: a body id already lives
 * in the same space as everything the body has built, and the convention gives a face's own
 * boundary edges the ids `<faceId>` and `<faceId>:top`, so a bare stem would re-derive names the
 * host already answers to. `push` is there because `boundaryId` DEDUPES: without a component of
 * its own the conjunction collapses whenever the pressed face and its source edge share an id —
 * the very convention above.
 *
 * Anything an operation cannot attribute this way gets NO id, and the matching layer resolves it
 * geometrically (see `trackedIds` in feature.ts).
 */

/**
 * Seed keys parallel to `all`: `e{id.id...}` of the sorted bounding entity ids, or the
 * profile's own index when the face carries no attribution at all (`profileEntityIds`
 * undefined — a face `profileBuilder` never registered, i.e. a test mock; every real profile
 * is registered, at worst with an empty set, which groups as `e`). Profiles bounded by the
 * same entity set (crossing-path lens regions) are told apart by an occurrence suffix
 * assigned in region-fingerprint order — content-derived, so the suffix follows the region
 * rather than the kernel's enumeration order. Computed over the FULL profile list: the
 * occurrence suffix of a duplicated entity set must not depend on which profiles the feature
 * selected.
 */
export function profileSeeds(all: IFace[]): string[] {
    const groups = new Map<string, number[]>();
    all.forEach((face, index) => {
        const entities = profileEntityIds(face);
        const key = entities === undefined ? `${index}` : `e${entities.join(".")}`;
        const group = groups.get(key);
        if (group === undefined) groups.set(key, [index]);
        else group.push(index);
    });
    const seeds = new Array<string>(all.length);
    for (const [key, group] of groups) {
        if (group.length === 1) {
            seeds[group[0]] = key;
            continue;
        }
        // Fingerprints are captured once per face — the comparator must stay pure,
        // and each capture is two kernel queries.
        const ranked = group
            .map((index) => ({ index, region: captureRegionFingerprint(all[index]) }))
            .sort((a, b) => compareRegionFingerprints(a.region, b.region));
        ranked.forEach(({ index }, occurrence) => {
            seeds[index] = occurrence === 0 ? key : `${key}~${occurrence}`;
        });
    }
    return seeds;
}

/** Region-fingerprint order (bbox center, then area) — the tiebreak recipe of `matchProfileIndexes`. */
function compareRegionFingerprints(
    a: { center: XYZLike; area: number },
    b: { center: XYZLike; area: number },
): number {
    return a.center.x - b.center.x || a.center.y - b.center.y || a.center.z - b.center.z || a.area - b.area;
}

/**
 * Sketch-scoped seeds of a profile face's boundary edges, for the swept sub-shape ids: the seed
 * of each edge is `ent<entityId>` of the sketch entity that generated it.
 *
 * - **Why entity ids, not ordinals.** They survive wire re-enumeration, where positional
 *   ordinals silently realign onto another edge when a mirrored or rewound profile permutes the
 *   edge order. Where entity attribution is unavailable (test mocks) the edge gets NO seed, and
 *   the geometry it sweeps stays unnamed rather than take an ordinal.
 * - **Caller contract:** `edges` must be the face's OWN `findSubShapes(ShapeTypes.edge)`
 *   enumeration in the same order — the registered entity attribution
 *   (`profileEdgeEntityIds`) runs parallel to it.
 */
export function profileEdgeSeeds(
    face: IFace,
    baseSeed: string,
    edges: readonly IEdge[],
): (string | undefined)[] {
    // A profile with its own suffixes wins: it is a shape no sketch entity describes, and its
    // suffixes already say what an entity id cannot (see `profileEdgeSeedSuffixes`).
    const suffixes = profileEdgeSeedSuffixes(face);
    if (suffixes !== undefined) {
        return edges.map((_, index) =>
            suffixes[index] === undefined ? undefined : `${baseSeed}:${suffixes[index]}`,
        );
    }
    const entities = profileEdgeEntityIds(face);
    return edges.map((_, index) => {
        const entity = entities?.[index];
        return entity === undefined ? undefined : `${baseSeed}:ent${entity}`;
    });
}

/** A profile corner: where two attributed edges meet, and the seed of the edge a sweep raises there. */
export interface ProfileCorner {
    readonly point: XYZLike;
    /** `<baseSeed>:v<a>.<b>`, or undefined when the corner is not attributable (see `profileCornerSeeds`). */
    readonly seed: string | undefined;
}

/**
 * The profile's corners, each with the seed a sweep gives the edge standing on it — the
 * vertex counterpart of `profileEdgeSeeds`, for the side edges a prism generates from the
 * profile's vertices (`Generated(vertex)`, which the kernel's edge history never reports).
 *
 * - **Content, not ordinal.** Two entities meeting at a point is what the corner IS, so
 *   `<a>.<b>` (sorted) survives the wire re-enumeration that would move a positional id
 *   onto another corner.
 * - **A corner with no entity attribution gets no seed** (fewer than two attributed edges
 *   meet there), and so does one whose key another corner of the same face shares — an
 *   unattributed edge stays unnamed rather than take an id that two different corners would
 *   claim.
 * - **Caller contract:** `face` is the face the sweep sweeps, and `baseSeed` is that
 *   face's seed — the returned points are in the face's own coordinate system.
 */
export function profileCornerSeeds(face: IFace, baseSeed: string): ProfileCorner[] {
    // The suffix channel labels the same way, off the suffixes: the pair of edges meeting at a
    // corner IS the corner's identity either way, so only the label's source changes.
    const suffixes = profileEdgeSeedSuffixes(face);
    if (suffixes !== undefined) {
        return cornerSeeds(
            face,
            (index) => suffixes[index],
            (labels) => (labels.size < 2 ? undefined : `${baseSeed}:v${[...labels].sort().join(".")}`),
        );
    }
    const entities = profileEdgeEntityIds(face);
    return cornerSeeds(
        face,
        (index) => {
            const entity = entities?.[index];
            return entity === undefined ? undefined : `${entity}`;
        },
        (labels) => {
            // `<baseSeed>:v<a>.<b>` — the entity ids meeting at the corner, sorted numerically.
            if (labels.size < 2) return undefined;
            return `${baseSeed}:v${[...labels]
                .map(Number)
                .sort((a, b) => a - b)
                .join(".")}`;
        },
    );
}

/**
 * The corner seeds of a face whose edges carry their own stable ids rather than sketch-entity
 * numbers — a press-pull's source face (`sweepFaceTracked`'s `faceEdgeIds`), which has no entity
 * attribution to key a corner by.
 *
 * The corner between two edges IS the pair of edges meeting there, so `boundaryId` of their ids
 * names it — atomic, so a merged neighbour's compound id cannot leak into the corner's name the
 * way a bare join would. Fewer than two labelled edges at a point means no corner (an
 * unattributed edge stays unnamed), and a key two corners of the face share names neither.
 *
 * Without this, a press-pull's corner edges (the ones parallel to the sweep, generated by the
 * profile's vertices) had no seed at all: they only got ids when they happened to merge with a
 * collinear neighbour, so a start offset — or an upstream feature that consumed those neighbours
 * — left them unnamed.
 */
export function faceCornerSeeds(face: IFace, edgeIds: readonly (string | undefined)[]): ProfileCorner[] {
    return cornerSeeds(
        face,
        (index) => edgeIds[index],
        (labels) => (labels.size < 2 ? undefined : boundaryId([...labels])),
    );
}

/**
 * The face's corners as `point` + the labels of the edges meeting there, each corner's seed
 * derived by `keyOf` and dropped when a sibling corner computes the same one (see the callers).
 */
function cornerSeeds(
    face: IFace,
    labelOf: (edgeIndex: number) => string | undefined,
    keyOf: (labels: ReadonlySet<string>) => string | undefined,
): ProfileCorner[] {
    let edges: IEdge[];
    try {
        edges = face.findSubShapes(ShapeTypes.edge) as IEdge[];
    } catch {
        return [];
    }
    // Edges sharing an endpoint contribute their labels to that one entry, so a rectangle corner
    // ends up with exactly its two; a T junction with three (still a valid seed — the set IS the
    // corner's identity). Grouped by distance, not by a grid bucket: a grid at MATCH_TOLERANCE
    // can split two points that are within it.
    const byPoint: { point: XYZLike; labels: Set<string> }[] = [];
    for (const [index, edge] of edges.entries()) {
        const label = labelOf(index);
        if (label === undefined) continue;
        for (const end of [edge.startPoint(), edge.endPoint()]) {
            const point = plainVec(end);
            const entry = byPoint.find((corner) => samePoint(corner.point, point));
            if (entry === undefined) byPoint.push({ point, labels: new Set([label]) });
            else entry.labels.add(label);
        }
    }
    const seeds = byPoint.map((corner) => keyOf(corner.labels));
    const duplicated = new Set(seeds.filter((seed, index) => seeds.indexOf(seed) !== index));
    return byPoint.map((corner) => {
        const seed = keyOf(corner.labels);
        return { point: corner.point, seed: duplicated.has(seed) ? undefined : seed };
    });
}

/** True when two points are the same corner within `MATCH_TOLERANCE`. */
export function samePoint(a: XYZLike, b: XYZLike): boolean {
    return distance(a, b) <= MATCH_TOLERANCE;
}

/**
 * Names, in place, the edges a SWEEP generated that the kernel's history could not attribute.
 *
 * The kernel reports a sweep's own profile edges (identity or Modified) and its
 * profile-edge-generated side FACES, but nothing derives the two families the sweep CREATES:
 * the image of each profile EDGE (a prism's top edge, a revolve's end-cap edge) and the image
 * of each profile CORNER (a prism's vertical side edge, a revolve's arc). Those get no id from
 * the history — and position is no fallback: naming a sub-shape "output index n" is a name a
 * rebuilt sweep is free to hand to a neighbour, since it re-enumerates (see `trackedIds` in
 * feature.ts, and `profileSeeds` on why the stems are content-derived). So both families are
 * named from the sweep's own motion instead.
 *
 * Both families follow from the sweep's MOTION alone, which is all that separates a prism from
 * a revolve:
 * - **an edge's image** — `piece` lies on `whole`'s image (`edgeLiesOnImage`), named
 *   `<edgeSeed><imageSuffix>`;
 * - **a corner's image** — `piece` spans the corner's point to the point the motion carries it
 *   to, named by `profileCornerSeeds`.
 *
 * An edge that matches several candidates, whose candidate has no seed (an unattributed corner),
 * or whose candidate would take a name one of the input's own copied edges already answers to,
 * stays unnamed rather than take an id two different sub-shapes could claim.
 *
 * `cornerSeeds` overrides how the sweep's corner images are named — a press-pull sweeps a body
 * face, whose corners have no sketch entities to key by, so its caller supplies
 * `faceCornerSeeds`; a sketch profile leaves it undefined and takes `profileCornerSeeds`.
 */
export function attributeSweepEdges(
    edgeIds: (string | undefined)[],
    outputEdges: readonly IEdge[],
    edgeMap: readonly number[],
    face: IFace,
    seed: string,
    edgeSeeds: readonly (string | undefined)[],
    motion: Matrix4,
    imageSuffix: string,
    cornerSeeds?: readonly ProfileCorner[],
): void {
    const inverse = motion.invert();
    // A motion with no inverse cannot carry a probe back into the profile's space, so nothing
    // here is attributable: the copied edges keep the ids the identity pass gave them, and the
    // rest stay unnamed.
    if (inverse === undefined) return;

    const profileEdges = face.findSubShapes(ShapeTypes.edge) as IEdge[];
    let corners = cornerSeeds;
    const candidates = new Map<number, string>();
    outputEdges.forEach((edge, index) => {
        if (edgeMap[index] >= 0) return;
        try {
            const swept = sweptEdgeSeed(edge, profileEdges, edgeSeeds, inverse, imageSuffix);
            if (swept !== undefined) {
                candidates.set(index, swept);
                return;
            }
            // A caller with its own corner scheme (a press-pull's edge ids) supplies them; a
            // sketch profile keys corners by its entities (see `profileCornerSeeds`).
            corners ??= profileCornerSeeds(face, seed);
            const corner = cornerOf(edge, corners, motion);
            if (corner !== undefined) candidates.set(index, corner);
        } catch {
            // A degenerate edge (its kernel queries throw — the release build turns an OCCT
            // failure into a JS-level throw): it stays unnamed.
        }
    });
    // An externally-seeded sweep is where the second half of `writeUncontestedIds` bites: a
    // candidate can lose to an id already in `edgeIds` — the names the sweep's IDENTITY pass gave
    // the edges it copies from the input (`trackedIds`). A sketch profile cannot collide there (its
    // stems are minted for this sweep), but pressing a box's side face takes that face's own ids as
    // identities, and the image of the face's BOTTOM edge then computes `<bottomEdgeId>:top` —
    // which is exactly what the body's convention already calls the face's TOP edge, so the image
    // would answer to a stranger's name 40mm away.
    writeUncontestedIds(edgeIds, candidates);
}

/**
 * `<edgeSeed><imageSuffix>` for the profile edge this swept edge is the image of — undefined
 * when none or several (a duplicated profile edge offers its seed twice).
 *
 * The suffix is hung off with `derivedId`, so a seed that is itself a compound (a
 * press-pulled face's edge ids are the host's own ids, which may be compounds) keeps every
 * leaf carrying it — a bare concatenation would leave the later leaves without the suffix,
 * and they would collide with the ids the un-suffixed image shares its name with.
 */
function sweptEdgeSeed(
    edge: IEdge,
    profileEdges: readonly IEdge[],
    edgeSeeds: readonly (string | undefined)[],
    inverse: Matrix4,
    imageSuffix: string,
): string | undefined {
    const hits = profileEdges.flatMap((profileEdge, index) => {
        const seed = edgeSeeds[index];
        // A profile edge with no seed cannot name its image.
        if (seed === undefined) return [];
        return edgeLiesOnImage(edge, profileEdge, (point) => inverse.ofPoint(point)) ? [seed] : [];
    });
    return hits.length === 1 ? derivedId(hits[0], imageSuffix) : undefined;
}

/** The corner seed of the profile vertex this swept edge stands on — undefined when none or several. */
function cornerOf(edge: IEdge, corners: readonly ProfileCorner[], motion: Matrix4): string | undefined {
    const start = edge.startPoint();
    const end = edge.endPoint();
    const hits = corners.flatMap((corner) => {
        if (corner.seed === undefined) return [];
        const swept = motion.ofPoint(corner.point);
        const spans =
            (samePoint(start, corner.point) && samePoint(end, swept)) ||
            (samePoint(end, corner.point) && samePoint(start, swept));
        return spans ? [corner.seed] : [];
    });
    return hits.length === 1 ? hits[0] : undefined;
}

/**
 * Seeds the top face's id in place. The top face is the profile's other sweep image, and the
 * kernel reports it directly (the sweep's LastShape) — authoritative, so the history-less
 * heuristic must not run when a cap is reported (it misidentifies when several faces lack
 * history). The heuristic remains for kernels predating that channel; it seeds only a unique
 * history-less face, so an ambiguous report leaves the top unnamed.
 */
export function seedTopFace(
    faceIds: (string | undefined)[],
    seed: string,
    faceMap: readonly number[],
    faceEdgeMap: readonly number[] | undefined,
    capFaces: readonly number[],
): void {
    // `derivedId`, not string concatenation: the seed may be a compound (a press-pull's seed is
    // the pressed face's own id, which a merge makes a `|` join), and a bare `:top` would land on
    // the last leaf only — leaving that leaf's siblings bare to collide with the host's id space.
    const topId = derivedId(seed, ":top");
    if (capFaces.length > 0) {
        for (const index of capFaces) {
            if (index >= 0 && index < faceIds.length) faceIds[index] = topId;
        }
        return;
    }
    const candidates = faceIds.flatMap((_, index) =>
        faceMap[index] < 0 && (faceEdgeMap?.[index] ?? -1) < 0 ? [index] : [],
    );
    if (candidates.length === 1) faceIds[candidates[0]] = topId;
}
