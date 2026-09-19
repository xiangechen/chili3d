// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IEdge, type IFace, ShapeTypes, type XYZLike } from "@chili3d/core";
import { profileEdgeEntityIds, profileEntityIds } from "./profileEntities";
import { captureRegionFingerprint } from "./profileRef";
import { distance, MATCH_TOLERANCE, plainVec } from "./refGeometry";
import { positionalId } from "./trackedId";

/**
 * Content-derived seed keys for profile regions and their boundary edges.
 *
 * A seed becomes the stem of the stable ids a sweep gives the geometry it generates from
 * a profile (see `sweepProfileTracked` in extrude.ts). It has to be derived from what the
 * region IS, not from where it sits in an enumeration: the kernel is free to re-enumerate
 * faces and edges after any rebuild, and a positional stem would then silently realign
 * onto a neighbour. Entity ids are the sketch's own stable identity, so they are the stem
 * — with a positional ordinal only as the fallback where attribution is unavailable.
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
 * | its swept (top) image      | `<seed>:ent<N>:top`         | `attributeSweepEdges` |
 * | swept profile corner      | `<seed>:v<a>.<b>`           | `profileCornerSeeds` |
 * | a fillet's new edge        | `<inputEdgeId>:f<face>`     | `attributeCornerEdges` |
 *
 * `<a>.<b>` are the entity ids meeting at the corner, sorted. Anything an operation
 * cannot attribute this way keeps the marked positional id (`positionalId`), which the
 * matching layer treats as the weak hint it is.
 */

/**
 * Seed keys parallel to `all`: `e{id.id...}` of the sorted bounding entity ids,
 * falling back to the positional index when entity ids are unknown. Profiles bounded
 * by the same entity set (crossing-path lens regions) are told apart by an occurrence
 * suffix assigned in region-fingerprint order — content-derived, so the suffix
 * follows the region rather than the kernel's enumeration order. Computed over the
 * FULL profile list: the occurrence suffix of a duplicated entity set must not depend
 * on which profiles the feature selected.
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
 *   edge order. The ordinal remains the fallback only where entity attribution is unavailable
 *   (test mocks).
 * - **Caller contract:** `edges` must be the face's OWN `findSubShapes(ShapeTypes.edge)`
 *   enumeration in the same order — the registered entity attribution
 *   (`profileEdgeEntityIds`) runs parallel to it.
 */
export function profileEdgeSeeds(face: IFace, baseSeed: string, edges: IEdge[]): string[] {
    const entities = profileEdgeEntityIds(face);
    return edges.map((_, index) => {
        const entity = entities?.[index];
        return entity === undefined ? positionalId(`${baseSeed}:e`, index) : `${baseSeed}:ent${entity}`;
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
 *   unattributed edge keeps its positional fallback rather than take an id that two
 *   different corners would claim.
 * - **Caller contract:** `face` is the face the sweep sweeps, and `baseSeed` is that
 *   face's seed — the returned points are in the face's own coordinate system.
 */
export function profileCornerSeeds(face: IFace, baseSeed: string): ProfileCorner[] {
    let edges: IEdge[];
    try {
        edges = face.findSubShapes(ShapeTypes.edge) as IEdge[];
    } catch {
        return [];
    }
    const entities = profileEdgeEntityIds(face);
    // Edges sharing an endpoint contribute their entities to that one entry, so a
    // rectangle corner ends up with exactly its two; a T junction with three (still a
    // valid seed — the sorted set IS the corner's identity). Grouped by distance, not by a
    // grid bucket: a grid at MATCH_TOLERANCE can split two points that are within it.
    const byPoint: { point: XYZLike; entities: Set<number> }[] = [];
    for (const [index, edge] of edges.entries()) {
        const entity = entities?.[index];
        if (entity === undefined) continue;
        for (const end of [edge.startPoint(), edge.endPoint()]) {
            const point = plainVec(end);
            const entry = byPoint.find((corner) => samePoint(corner.point, point));
            if (entry === undefined) byPoint.push({ point, entities: new Set([entity]) });
            else entry.entities.add(entity);
        }
    }
    const keys = byPoint.map((corner) => keyOf(corner.entities, baseSeed));
    const duplicated = new Set(keys.filter((key, index) => keys.indexOf(key) !== index));
    return byPoint.map((corner) => ({
        point: corner.point,
        seed: duplicated.has(keyOf(corner.entities, baseSeed)) ? undefined : keyOf(corner.entities, baseSeed),
    }));
}

/** `<baseSeed>:v<a>.<b>` for the entities meeting at a corner — undefined when fewer than two do. */
function keyOf(entities: ReadonlySet<number>, baseSeed: string): string | undefined {
    if (entities.size < 2) return undefined;
    return `${baseSeed}:v${[...entities].sort((a, b) => a - b).join(".")}`;
}

/** True when two points are the same corner within `MATCH_TOLERANCE`. */
export function samePoint(a: XYZLike, b: XYZLike): boolean {
    return distance(a, b) <= MATCH_TOLERANCE;
}
