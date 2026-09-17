// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { XYZ } from "@chili3d/core";

/**
 * The geometry vocabulary and tolerances the package's layers share: the plain-data
 * vector a stored fingerprint is built from, the two "how close counts as the same"
 * scales, and the small distance/parallelism helpers they are measured with.
 *
 * Why it is its own module, and why it is not named after one layer:
 *
 * - `Vec3` is the currency of every ref kind — `EdgeRef`, `ProfileRef`, `FaceFingerprint`,
 *   `PlaneFaceRef` all serialize their fingerprints as `Vec3` — so a reader of any of those
 *   files needs it. `edgeRef.ts` and `profileRef.ts` previously carried byte-identical
 *   copies of `vec3` and `distance`; neither hosts the other's primitives now.
 * - Both tolerances are *cross-layer agreements*, and saying so is the point. `MATCH_TOLERANCE`
 *   is what makes a re-matched sub-shape "the same edge" to the ref layer. `INCIDENCE_TOLERANCE`
 *   is what makes a point "on the edge" to BOTH the solver's incidence repair and the profile
 *   builder's endpoint-on-interior probe — a disagreement there would let the sketching layer
 *   and the profile layer disagree about the same geometry. Keeping them in one file means a
 *   reader asking "how close is close enough?" has a single place to look.
 */

/** A plain 3-component vector, as stored in a serialized fingerprint. */
export type Vec3 = { x: number; y: number; z: number };

/** Coordinates below this distance (mm) count as the same edge. */
export const MATCH_TOLERANCE = 1e-4;

/**
 * Shared tolerance for incidence residuals (a point left off its line/circle after a
 * coarse solve). The solver's repair pass uses it; profileBuilder's endpoint-on-interior
 * probe matches it so the two layers agree on what "on the edge" means.
 */
export const INCIDENCE_TOLERANCE = 1e-4;

/** Dot-product tolerance for direction parallelism (|dot| ≥ 1 − 1e-6). */
const PARALLEL_TOLERANCE = 1e-6;

export function vec3(xyz: XYZ): Vec3 {
    return { x: xyz.x, y: xyz.y, z: xyz.z };
}

export function distance(a: Vec3, b: Vec3): number {
    return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

export function sameVec(a: Vec3, b: Vec3): boolean {
    return a.x === b.x && a.y === b.y && a.z === b.z;
}

/** Rebuilt axes may flip sign; compare both orientations. */
export function axisDistance(a: Vec3, b: Vec3): number {
    return Math.min(distance(a, b), distance(a, { x: -b.x, y: -b.y, z: -b.z }));
}

/**
 * Parallel check on the unit dot product (|dot| ≥ 1 − 1e-6). Deliberately not
 * `XYZ.isParallelTo`, whose tolerance is angular (1e-6 rad) and would change the
 * sensitivity of every probe built on this. An undefined direction (a degenerate
 * edge) counts as not parallel. Shared with the sketch external-ref resolver, whose
 * geometry probes rely on the same sensitivity.
 */
export function directionsParallel(a: XYZ | undefined, b: XYZ | undefined): boolean {
    if (a === undefined || b === undefined) return false;
    return Math.abs(a.dot(b)) >= 1 - PARALLEL_TOLERANCE;
}
