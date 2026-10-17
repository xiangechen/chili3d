// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type IEdge,
    type IFace,
    type IShape,
    Matrix4,
    Result,
    ShapeTypes,
    type TrackedShape,
    type XYZ,
} from "@chili3d/core";
import { taperSweptPrism } from "./extrudeDraft";
import {
    type CompletedTrackedHistory,
    completeTrackedHistory,
    trackedAncestors,
    trackedFaceIds,
    trackedIds,
} from "./feature";
import { mergedEdgeAncestors, unionAncestors } from "./historyCompletion";
import { mapFusedIds } from "./operationIds";
import {
    profileEdgeEntityIds,
    profileEdgeSeedSuffixes,
    registerProfileEdgeEntities,
    registerProfileEdgeSuffixes,
} from "./profileEntities";
import { attributeSweepEdges, faceCornerSeeds, profileEdgeSeeds, seedTopFace } from "./profileSeeds";
import { anyPairTouches, combineShapes, translateFace } from "./sweepGeometry";
import { boundaryId, derivedId, idsOverlap } from "./trackedId";

/**
 * The component that marks a sub-shape name as a press-pull's own (see `sweepFaceTracked`). No
 * other producer emits a bare `push`, and `boundaryId` keeps it one '&'-separated component.
 */
const PUSH_MARKER = "push";

/**
 * The tracked counterpart of `sweepGeometry.ts`: the same sweeps, but reporting the stable id
 * of every sub-shape they build.
 *
 * The two live apart because the tracked half needs the feature-list machinery — the kernel
 * history completion, the seed grammar and the fusion id mapper — while the plain half must
 * stay free of it (a body whose kernel or chain cannot track still sweeps). Both extrude and
 * press-pull sweep through here, so neither owns it.
 */

/**
 * Sweeps one face along `vec` with kernel history and names what it builds (see
 * `sweepProfiles` in extrude.ts, its profile-list caller).
 *
 * `seedBase` is the `<seed>` of the id grammar (`profileSeeds.ts`), i.e.
 * `sketch:<nodeId>:<profileSeed>` for a sketch profile, or the picked face's own tracked id
 * for a press-pull — anything that names the face stably. `undefined` means the source face
 * has no tracked id: the prism is still swept, with every id left undefined.
 *
 * `faceEdgeIds` seeds the edges the prism is built from, in the face's own
 * `findSubShapes(edge)` order. A sketch profile leaves it undefined and takes the
 * entity-derived seeds (`profileEdgeSeeds`); a press-pull's source is a BODY face, which has
 * no entity attribution at all, so its caller passes that face's own tracked edge ids
 * instead — without them every seed came back undefined, and the pad's edges (including the
 * bottom edges identical to the source's, whose ids exist upstream) were left with no id for
 * a later fillet to anchor on.
 *
 * The history and the two seeding rules:
 *
 * - **Bottom edges** — the face's edges seed content ids; the prism's bottom edges are
 *   identical to them.
 * - **Bottom face** — the face's seed, which prism history propagates to the bottom face
 *   (also identical).
 * - **Top face** — has no sweep history at all (it is neither the identical bottom nor an
 *   edge-generated side), so the kernel reports it directly through `capFaces` (LastShape)
 *   and it takes the synthetic `:top` seed. A kernel predating that channel falls back to
 *   the unique-history-less-face heuristic.
 * - **Side faces** — generated from the face's edges, so they take that edge's seed; a
 *   rebuild that re-enumerates faces cannot realign them.
 * - **Anything the history does not cover** is left unnamed (`attributeSweepEdges` names the
 *   two families it can derive from the motion).
 * - **`seedSuffix`** keeps the mirrored half of a symmetric sweep from duplicating the first
 *   half's ids.
 *
 * A non-zero `draftAngle` (degrees) tapers the prism's side faces about its start plane as a
 * second kernel step, composing the taper's history with the sweep's (`taperSweptPrism` in
 * extrudeDraft.ts) so the ids below survive it.
 */
/** What naming one swept prism needs: the profile it came from, and what the kernel said of it. */
interface SweepNaming {
    /** The profile face, already at the start offset. */
    readonly face: IFace;
    /** That face's own edges, in findSubShapes order. */
    readonly faceEdges: readonly IEdge[];
    /** The tracked id of the source face, or undefined for a prism nothing can name. */
    readonly seedBase: string | undefined;
    /** `:neg` for a symmetric sweep's second half (see `sweepFacesTracked`). */
    readonly seedSuffix: string;
    /** The caller's source-face ids, one per profile edge — undefined for a sketch. */
    readonly faceEdgeIds: readonly (string | undefined)[] | undefined;
    /** The sweep vector: a prism carries every profile point by it. */
    readonly vec: XYZ;
    /** What `prismTracked` reported of the prism it built. */
    readonly tracked: TrackedShape;
    /** What `completeTrackedHistory` made of that report. */
    readonly history: CompletedTrackedHistory;
}

/**
 * The ids one swept prism's faces and edges take, and the scope naming what a draft births on it.
 *
 * Answers id-less holes rather than nothing when the source face carries no tracked id: one unnamed
 * face of a multi-face sweep must not blank the names the OTHER prisms did get, and the caller's
 * arrays stay index-parallel with findSubShapes order.
 */
function nameSweptPrism(naming: SweepNaming): {
    faceIds: (string | undefined)[];
    edgeIds: (string | undefined)[];
    scope: string;
} {
    const { face, faceEdges, seedBase, seedSuffix, faceEdgeIds, vec, tracked, history } = naming;
    const { edgeMap, faceMap, outputEdges } = history;
    // The scope naming the edges a draft births (see `taperSweptPrism`); unused when the prism is
    // unnamed, since a born edge's name is a conjunction of face ids.
    if (seedBase === undefined) {
        return {
            faceIds: faceMap.map(() => undefined),
            edgeIds: edgeMap.map(() => undefined),
            scope: "sweep",
        };
    }
    // `derivedId`, not concatenation: an external `seedBase` is a tracked id that a merge can
    // make compound, and a suffix on the whole string would leave the earlier leaves bare.
    const seed = derivedId(seedBase, seedSuffix);
    // Entity-derived seeds survive wire re-enumeration (see profileEdgeSeeds), and they carry
    // the sweep's own seed in the stem (`<seed>:ent<N>`) — which is what keeps a sweep's names
    // its own.
    //
    // An EXTERNAL seed is a body id, living in the same name space as everything the body has
    // already built, so the sweep names the sub-shape it carries as a conjunction WITH its own
    // identity: `boundaryId([seed, id, PUSH_MARKER])` — "the pressed face, that sub-shape, a
    // press-pull". Without the pressed face the sweep re-derives names the body already answers
    // to, since the convention gives a face's own boundary edges the ids `<faceId>` and
    // `<faceId>:top` (measured: pressing a box's side face minted edges whose names the box's
    // top edge already had 40mm away). `PUSH_MARKER` is what keeps the conjunction from
    // collapsing: `boundaryId` DEDUPES its arguments, and the pressed face and its top edge
    // already share one id — the very convention above — so without a component of its own the
    // seed would dedupe back to a bare body id. The seed also separates a symmetric sweep's two
    // halves, from the `:neg` its `seed` carries.
    const edgeSeeds =
        faceEdgeIds === undefined
            ? profileEdgeSeeds(face, seed, faceEdges)
            : faceEdgeIds.map((id) => (id === undefined ? undefined : boundaryId([seed, PUSH_MARKER, id])));
    // The bottom face takes the seed — but an EXTERNAL seed names a body face that is still
    // in the body, so the pad's own bottom cannot reuse it verbatim: it is a DISTINCT face
    // (translated by `offsetVec`, so always distinct when there is a start offset), and the
    // body already answers to the bare id. Qualify it with the press-pull marker exactly as
    // the edge seeds below do. A sketch seed needs no qualification — nothing else in the
    // body carries it.
    const faceSeed = faceEdgeIds === undefined ? seed : boundaryId([seed, PUSH_MARKER]);
    const faceIds = trackedFaceIds([faceSeed], edgeSeeds, faceMap, tracked.faceEdgeMap);
    seedTopFace(faceIds, faceSeed, faceMap, tracked.faceEdgeMap, tracked.capFaces ?? []);
    const edgeIds = trackedIds(edgeSeeds, edgeMap);
    // A prism carries every profile point by `vec`; the swept image of an edge is its top.
    attributeSweepEdges(
        edgeIds,
        outputEdges,
        edgeMap,
        face,
        seed,
        edgeSeeds,
        Matrix4.fromTranslation(vec.x, vec.y, vec.z),
        ":top",
        // The corner images of a press-pull have no entities to key by — their seeds come
        // from the (already qualified) ids of the edges meeting at each corner.
        faceEdgeIds === undefined ? undefined : faceCornerSeeds(face, edgeSeeds),
    );
    return { faceIds, edgeIds, scope: seed };
}

export function sweepFaceTracked(
    profileFace: IFace,
    seedBase: string | undefined,
    vec: XYZ,
    offsetVec: XYZ,
    seedSuffix = "",
    faceEdgeIds?: readonly (string | undefined)[],
    draftAngle?: number,
): Result<{ shape: IShape; faceIds: (string | undefined)[]; edgeIds: (string | undefined)[] }> {
    const owned: IFace[] = [];
    try {
        const face = translateProfileFace(profileFace, offsetVec, owned);
        const result = shapeFactory.prismTracked!(face, vec);
        if (!result.isOk) return Result.err(result.error);
        const faceEdges = face.findSubShapes(ShapeTypes.edge) as IEdge[];
        // The completed face map keeps the top-face seeding below unambiguous: a
        // kernel-missed bottom face would otherwise look like a second history-less
        // candidate.
        const history = completeTrackedHistory([face], result.value, {
            inputEdges: faceEdges,
            inputFaces: [face],
        });
        const { faceIds, edgeIds, scope } = nameSweptPrism({
            face,
            faceEdges,
            seedBase,
            seedSuffix,
            faceEdgeIds,
            vec,
            tracked: result.value,
            history,
        });
        if (draftAngle === undefined || draftAngle === 0) {
            return Result.ok({ shape: result.value.shape, faceIds, edgeIds });
        }
        const [basePoint, baseNormal] = face.normal(0, 0);
        // The kernel's face-edge map names the side faces exactly; a kernel that left it
        // empty falls back to the geometric pick inside `taperSweptPrism`.
        const sideFaces =
            result.value.faceEdgeMap === undefined
                ? undefined
                : history.outputFaces.filter((_, index) => result.value.faceEdgeMap![index] >= 0);
        return taperSweptPrism(
            { shape: result.value.shape, faceIds, edgeIds },
            basePoint,
            baseNormal,
            vec,
            draftAngle,
            scope,
            sideFaces,
        );
    } finally {
        owned.forEach((x) => x.dispose());
    }
}

/**
 * The tracked twin of `sweepFaces`: sweeps each of `faces` along its OWN vectors (`vecsOf`)
 * and merges touching prisms, reporting the ids. Each face is named by its own `faceIds`
 * entry; an entry with no id leaves that prism's sub-shapes unnamed without affecting the
 * others, and `undefined` comes back only when NOTHING is nameable — the caller then takes
 * the plain path, which builds the same geometry without the tracking bookkeeping.
 *
 * The vector ORDER matters to the ids: `:neg` suffixes the mirrored half so it cannot
 * duplicate the first half's names.
 *
 * `faceEdgeIds` runs parallel to `faces`, each entry seeding that face's own edges (see
 * `sweepFaceTracked`) — the caller's source-face ids for a press-pull, undefined for sketches.
 *
 * A non-zero `draftAngle` (degrees) tapers each prism's side faces about its own start plane —
 * see `sweepFaceTracked`.
 */
export function sweepFacesTracked(
    faces: readonly IFace[],
    faceIds: readonly (string | undefined)[],
    vecsOf: (face: IFace) => XYZ[],
    offsetOf: (face: IFace) => XYZ,
    faceEdgeIds?: readonly (readonly (string | undefined)[] | undefined)[],
    draftAngle?: number,
): Result<TrackedPiece> | undefined {
    // `prismTracked` is optional on `IShapeFactory` (every sibling tracked path guards it): a
    // factory without it must fall back to the plain path, not throw out of `evaluate`.
    if (shapeFactory.prismTracked === undefined) return undefined;
    const targets: {
        face: IFace;
        id: string | undefined;
        edgeIds: readonly (string | undefined)[] | undefined;
    }[] = faces.map((face, index) => ({ face, id: faceIds[index], edgeIds: faceEdgeIds?.[index] }));
    // Nothing is nameable at all: the plain path is exactly as good, and returning ids makes the
    // body read as "tracked" with nothing to show (see `idDiagnostics`).
    if (targets.every((target) => target.id === undefined)) return undefined;
    const shapes: IShape[] = [];
    const sweptFaceIds: (string | undefined)[][] = [];
    const sweptEdgeIds: (string | undefined)[][] = [];
    for (const { face, id, edgeIds } of targets) {
        for (const [direction, vec] of vecsOf(face).entries()) {
            const swept = sweepFaceTracked(
                face,
                id,
                vec,
                offsetOf(face),
                direction === 0 ? "" : ":neg",
                edgeIds,
                draftAngle,
            );
            if (!swept.isOk) return Result.err(swept.error);
            shapes.push(swept.value.shape);
            sweptFaceIds.push(swept.value.faceIds);
            sweptEdgeIds.push(swept.value.edgeIds);
        }
    }
    // Two prisms of one sweep can build a sub-shape from the SAME source edge: pressing two faces
    // that meet at it (a box's top and its side, which share their boundary edge) makes both
    // sweeps raise a side face from that edge. Naming both after it would hand one id to two
    // faces — measured: they end up 25mm apart in the fused result, where `idsOverlap` reads them
    // as one sub-shape — so a name more than one prism claims is dropped (`uncontested`).
    const prismFaceIds = uncontestedPerShape(sweptFaceIds);
    const prismEdgeIds = uncontestedPerShape(sweptEdgeIds);
    // Every prism at once: they are all pieces of the one body this sweep builds.
    return fuseOrCombinePieces(
        shapes.map((shape, index) => ({
            shape,
            faceIds: prismFaceIds[index],
            edgeIds: prismEdgeIds[index],
        })),
    );
}

/**
 * Each shape's ids with every one that ANOTHER shape of the same build also claims dropped.
 *
 * A shape's own repeats are not a conflict: two pieces of one split sub-shape legitimately carry
 * one name, and the matcher reads them as what they are — pieces of one sub-shape. Only a name a
 * DIFFERENT shape claims means two distinct sub-shapes of the fused result, so only that is
 * dropped — compared component-wise (`idsOverlap`), the way the matcher compares: `A|B` from one
 * shape and `A` from another are still one sub-shape to it.
 *
 * Shared by the sweeps (one entry per swept prism, hence the ids not colliding across a
 * symmetric sweep's two halves) and by `thickenTracked.ts` (one entry per thickened
 * component/direction, the same problem).
 */
export function uncontestedPerShape(idsPerShape: (string | undefined)[][]): (string | undefined)[][] {
    const namesPerShape = idsPerShape.map((ids) => ids.filter((id): id is string => id !== undefined));
    return idsPerShape.map((ids, shape) =>
        ids.map((id) =>
            id === undefined ||
            namesPerShape.some((names, other) => other !== shape && names.some((n) => idsOverlap(id, n)))
                ? undefined
                : id,
        ),
    );
}

/**
 * One swept or revolved piece of a build, with the ids its own sub-shapes were given
 * (findSubShapes order). `hostSpace.ts`'s `HostMappedTool` is the same three fields; they are not
 * aliased because that would have this file's sweep own a type the host-space mapping is the
 * natural home of.
 */
export interface TrackedPiece {
    readonly shape: IShape;
    readonly faceIds: (string | undefined)[];
    readonly edgeIds: (string | undefined)[];
}

/**
 * The pieces of one build as a single shape, fuse first and combine second.
 *
 * A tracked fuse runs when the kernel offers one and any two pieces TOUCH: the seam two of them
 * meet along is then ONE face rather than two coincident ones, which is what a downstream
 * reference has to be able to name. Everything else — nothing to fuse, nothing touching, no
 * tracked kernel — falls through to the plain combine, and the ids come through either way. Both
 * branches are `fuseSweptPrisms`'s and `combineShapes`'s own, not a second reading of them.
 */
export function fuseOrCombinePieces(pieces: readonly TrackedPiece[]): Result<TrackedPiece> {
    const fused = fuseSweptPrisms(
        pieces.map((x) => x.shape),
        pieces.map((x) => x.faceIds),
        pieces.map((x) => x.edgeIds),
    );
    if (fused !== undefined) return fused;
    const combined = combineShapes(pieces.map((x) => x.shape));
    if (!combined.isOk) return Result.err(combined.error);
    return Result.ok({
        shape: combined.value,
        faceIds: pieces.flatMap((x) => x.faceIds),
        edgeIds: pieces.flatMap((x) => x.edgeIds),
    });
}

/**
 * Fuses touching swept prisms into one solid with kernel history, mapping the
 * merged ids back per prism. Returns undefined when the fuse does not apply or
 * fails — the caller then combines the prisms into a compound.
 */
export function fuseSweptPrisms(
    shapes: IShape[],
    faceIds: (string | undefined)[][],
    edgeIds: (string | undefined)[][],
): Result<{ shape: IShape; faceIds: (string | undefined)[]; edgeIds: (string | undefined)[] }> | undefined {
    if (shapes.length <= 1 || !anyPairTouches(shapes) || shapeFactory.booleanFuseTracked === undefined) {
        return undefined;
    }
    const fused = shapeFactory.booleanFuseTracked([shapes[0]], shapes.slice(1));
    if (!fused.isOk) return undefined;
    const completed = completeTrackedHistory(shapes, fused.value);
    // Both mappers consume the merge channel, so this is one of the few places that pays for
    // verifying it (see `trackedAncestors`).
    const ancestors = trackedAncestors(completed, fused.value);
    // The merge channel twice over: the kernel's verified pairs, plus a geometric sweep for
    // the merges those pairs got wrong (see `mergedEdgeAncestors`).
    const merged = {
        shape: fused.value.shape,
        faceIds: mapFusedIds(faceIds, completed.faceMap, ancestors.faceAncestors),
        edgeIds: mapFusedIds(
            edgeIds,
            completed.edgeMap,
            unionAncestors(
                ancestors.edgeAncestors,
                mergedEdgeAncestors(completed.outputEdges, completed.inputEdges),
            ),
        ),
    };
    shapes.forEach((x) => {
        x.dispose();
    });
    return Result.ok(merged);
}

/**
 * The face translated to the feature's start offset, registered so the edge enumeration stays
 * entity-derived.
 *
 * A translated copy is a fresh object: it is neither the WeakMap key of the original face nor
 * in its sub-shape parent chain, so without re-registering, a start offset would drop every
 * edge seed.
 */
function translateProfileFace(face: IFace, offsetVec: XYZ, owned: IFace[]): IFace {
    const translated = translateFace(face, offsetVec, owned);
    if (translated !== face) {
        const entities = profileEdgeEntityIds(face);
        if (entities !== undefined) registerProfileEdgeEntities(translated, entities);
        const suffixes = profileEdgeSeedSuffixes(face);
        if (suffixes !== undefined) registerProfileEdgeSuffixes(translated, suffixes);
    }
    return translated;
}
