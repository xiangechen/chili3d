// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    ANGLE_UNITS,
    type IFace,
    type IShape,
    Plane,
    Result,
    resolveUnitSpec,
    type Scope,
    XYZ,
} from "@chili3d/core";
import { draftTracked } from "./draftTracked";
import type { ExtrudeFeatureData } from "./feature";
import { prismSideFaces } from "./sweepGeometry";

/**
 * Extrude-embedded draft: the sweep's side faces tapered about the start plane as the prism
 * is built, rather than a separate `draft` feature that has to pick them afterwards.
 *
 * The taper runs as a SECOND kernel step on each freshly swept prism — before the prisms fuse
 * with each other or boolean into the chain input — so the two histories compose locally:
 * `draftTracked` consumes the prism together with the ids the sweep minted, and what comes out
 * is again a shape with an id per sub-shape, which the fuse/boolean id mapping downstream
 * (`fuseSweptPrisms`, `trackOperation`) handles unchanged. A tapered face keeps its input's id
 * (`draftTracked`'s contract), so a side keeps the profile edge's seed and a later fillet on
 * one of its edges survives the draft being edited. A standalone draft feature could only
 * re-match the side faces geometrically on every rebuild.
 *
 * **Which side of the neutral plane a positive angle takes material from was MEASURED, not
 * reasoned** (copied from `draft.ts`; OCCT's docs state it but read backwards easily): on a
 * 40×40×20 box whose four sides are tapered about Plane.XY at +5°, a pull direction of +Z
 * returns volume 29282 — the box narrows going up, the mould draft — and −Z returns 34881,
 * the flare. Here the pull direction is each half's own sweep direction and the neutral plane
 * is the start plane (the profile plane shifted by `startOffset`), so a positive angle narrows
 * the prism toward its end, and a symmetric/`depth2` sweep tapers both halves off their shared
 * start, parting-line style.
 *
 * **When the body or kernel offers no tracking** the draft still runs: the side faces of a
 * freshly swept prism are identified GEOMETRICALLY (`prismSideFaces` — a cap is a translate of
 * the profile face, a side spans both end planes) and tapered with the plain kernel `draft`.
 * That is a deliberate step beyond the warn-and-skip fallback: the geometry the user asked for
 * is always built, and only the ids degrade — to the body's documented geometric re-matching
 * (`trackedIds` in feature.ts), the same degradation every plain-path feature accepts.
 */

/** A swept prism plus the ids of its sub-shapes — what `taperSweptPrism` consumes and returns. */
export interface SweptPrism {
    readonly shape: IShape;
    readonly faceIds: (string | undefined)[];
    readonly edgeIds: (string | undefined)[];
}

/**
 * Resolves the feature's draft angle in degrees, undefined meaning straight sides (the plain
 * prism path). Hand-edited data is rejected here rather than at the kernel: the magnitude must
 * stay strictly below 90°.
 */
export function resolveExtrudeDraft(feature: ExtrudeFeatureData, scope: Scope): Result<number | undefined> {
    if (feature.draftAngle === undefined) return Result.ok(undefined);
    const angle = resolveUnitSpec(feature.draftAngle, scope, ANGLE_UNITS);
    if (!angle.isOk) return Result.err(angle.error);
    if (angle.value === 0) return Result.ok(undefined);
    if (Math.abs(angle.value) >= 90) {
        return Result.err("Extrude draft angle must lie strictly between -90 and 90 degrees");
    }
    return Result.ok(angle.value);
}

/**
 * Tapers `prism`'s side faces about the base plane through `basePoint` by `angle` DEGREES,
 * carrying the sweep's ids through the taper. `pullDirection` is the sweep direction — a
 * positive angle narrows the prism toward its end, the mould-draft convention measured in
 * `draft.ts`. `seedScope` scopes the names of edges the taper births (see `draftTracked`).
 *
 * The side faces are the ones the sweep generated from the profile's boundary: named by the
 * prism's `faceEdgeMap` when the kernel reported it, picked geometrically (`prismSideFaces`)
 * when it did not. A kernel without the tracked draft degrades to the plain taper — the same
 * geometry with the ids dropped, the body's documented fallback to geometric matching.
 */
export function taperSweptPrism(
    prism: SweptPrism,
    basePoint: XYZ,
    baseNormal: XYZ,
    pullDirection: XYZ,
    angle: number,
    seedScope: string,
    sideFaces?: readonly IFace[],
): Result<SweptPrism> {
    const faces = sideFaces ?? prismSideFaces(prism.shape, basePoint, baseNormal, pullDirection);
    // No side faces at all (a degenerate sweep the kernel still answered) — tapering nothing
    // must not fail the feature.
    if (faces.length === 0) return Result.ok(prism);
    const pull = pullDirection.normalize();
    if (pull === undefined) return Result.err("Extrude draft requires a non-zero sweep direction");
    const plane = draftPlane(basePoint, pull);
    const tracked = draftTracked(
        { shape: prism.shape, faces, faceIds: prism.faceIds, edgeIds: prism.edgeIds },
        pull,
        angle,
        plane,
        seedScope,
    );
    if (tracked !== undefined) {
        if (!tracked.isOk) return Result.err(tracked.error);
        prism.shape.dispose();
        return Result.ok(tracked.value);
    }
    const tapered = shapeFactory.draft(prism.shape, [...faces], pull, angle, plane);
    if (!tapered.isOk) return Result.err(tapered.error);
    prism.shape.dispose();
    return Result.ok({
        shape: tapered.value,
        faceIds: prism.faceIds.map(() => undefined),
        edgeIds: prism.edgeIds.map(() => undefined),
    });
}

/**
 * The taper's neutral plane: through `origin` with the pull direction as its normal. The
 * x-vector carries no geometry of its own — the kernel reads the plane's pose only — so any
 * direction not parallel to the normal serves.
 */
function draftPlane(origin: XYZ, pull: XYZ): Plane {
    return new Plane({ origin, normal: pull, xvec: Math.abs(pull.z) > 0.9 ? XYZ.unitX : XYZ.unitZ });
}
