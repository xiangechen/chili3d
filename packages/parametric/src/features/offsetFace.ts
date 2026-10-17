// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type IFace,
    type IShape,
    LENGTH_UNITS,
    type OffsetFaceProblem,
    primaryAncestors,
    Result,
    resolveUnitSpec,
    ShapeTypes,
} from "@chili3d/core";
import {
    type FeatureContext,
    type FeatureHandler,
    type OffsetFaceFeatureData,
    registerFeature,
    trackedFaceIds,
    trackedIds,
} from "./feature";
import { captureProfileRef } from "./profileRef";
import { matchSourceFaceIndexes } from "./sourceFaceMatcher";
import { ID_COMPONENT_SEPARATOR } from "./trackedId";

/**
 * Offset Face: move the chain input's picked faces along their own outward normals, with the
 * faces that run smoothly into them following — a flat face grows or sinks like a pad, a curved
 * wall changes its radius, which is how a cylinder or a hole is resized.
 *
 * Structured like `shell.ts` — the same relationship to its input (it consumes the shape the
 * chain has built and names sub-shapes OF it), the same tracking contract, the same "resolve the
 * faces off `context.input` itself, never through a world-space transform" rule (the kernel
 * matches a face by identity). What it does NOT share is the naming: a shell's opening raises a
 * rim that needs a name of its own, while an offset's faces simply move — every face keeps the
 * name of the face it was, which is what `trackedFaceIds` inherits from the kernel's history
 * without any special case.
 *
 * The kernel refuses more than it fails (see `offsetFacesTracked` in `shapeFactory.ts`), and the
 * failures it DOES report are classified rather than worded — the wording, with the "max ≈ this"
 * the kernel only knows by searching for it, is `problemMessage` below.
 */

const offsetFaceHandler: FeatureHandler<OffsetFaceFeatureData> = {
    display: "command.feature.offsetFace",
    icon: "icon-offset",
    reselectable: true,

    nodeIds: () => [],

    parameters: (feature) => [
        {
            key: "distance",
            display: "option.command.distance",
            value: feature.distance,
            unit: LENGTH_UNITS,
        },
        // ABSENT reads as off, matching `evaluate`: an offset saved before this option existed
        // has no field and must not start behaving differently than when it was saved.
        {
            key: "keepRounds",
            display: "option.command.keepRounds",
            value: feature.keepRounds === true,
        },
    ],

    setParameter: (feature, key, value) => ({ ...feature, [key]: value }),

    applyResolvedRefs: (feature, { resolvedProfiles }) =>
        resolvedProfiles === undefined ? feature : { ...feature, faces: resolvedProfiles },

    evaluate(feature, context): Result<IShape> {
        // The feature's OWN values first, then the context's — the order `shell.ts` keeps, so a
        // file that says something impossible says so about itself rather than about the chain.
        const distance = resolveUnitSpec(feature.distance, context.scope, LENGTH_UNITS);
        if (!distance.isOk) return Result.err(distance.error);
        // 0 is not a small move, it is no move at all. The kernel would report success with the
        // body unchanged, which reads as a feature that silently did nothing.
        if (Math.abs(distance.value) < 1e-9) {
            return Result.err("Offset Face: the distance is 0, so nothing moves");
        }
        const input = context.input;
        if (input === undefined) return Result.err("Offset Face requires a preceding feature");
        const moved = resolveMovedFaces(feature, context, input);
        if (!moved.isOk) return Result.err(moved.error);
        if (moved.value.length === 0) return Result.err("Offset Face requires at least one face");

        return buildOffsetFace(input, moved.value, distance.value, feature.keepRounds === true, context);
    },
};

/**
 * Re-matches the feature's stored faces on the rebuilt input, by tracked id first and geometric
 * fingerprint second (`matchSourceFaceIndexes`), and re-anchors them for the body's write-back —
 * the same drift-from-latest-match contract the shell and the edge features keep.
 *
 * No outward normal is captured: an offset moves curved faces as readily as flat ones, and the
 * planar normal gate would reject a legitimate re-match of a curved one.
 */
function resolveMovedFaces(
    feature: OffsetFaceFeatureData,
    context: FeatureContext,
    input: IShape,
): Result<IFace[]> {
    const faces = input.findSubShapes(ShapeTypes.face) as IFace[];
    const faceIds = context.tracking?.inputFaceIds;
    const matched = matchSourceFaceIndexes(faces, faceIds, feature.faces);
    if (!matched.isOk) return Result.err(matched.error);
    if (context.tracking !== undefined) {
        // One ref per adopted face: a face split since the pick becomes one ref per piece.
        context.tracking.resolvedProfiles = matched.value.indexes.map((faceIndex, k) =>
            captureProfileRef(
                faces[faceIndex],
                faceIds?.[faceIndex],
                feature.faces[matched.value.refIndexes[k]].splitPiece,
            ),
        );
        // A picked face the input no longer has costs the user that face, not the whole
        // offset — the same tolerance the sketch-profile path keeps.
        if (matched.value.missing.length > 0) {
            context.tracking.unresolved = { key: "faces", refIndexes: matched.value.missing };
        }
    }
    return Result.ok(matched.value.indexes.map((index) => faces[index]));
}

/**
 * One kernel call, and the ids it leaves behind. Every output face keeps the id of the face it
 * moved from — the kernel reports a moved face as generated by its original, which
 * `trackedFaceIds` reads as the same face. A face nothing derives has no id, the documented
 * degradation: the matching layer resolves it geometrically.
 *
 * The kernel's derivation is taken AS IT STANDS, without `completeTrackedHistory`'s usual
 * verification — deliberately, and this is the one feature that must. That pass drops any claim
 * whose output does not overlap its input (`verifiedFaceClaims`, which exists because a boolean
 * fuse reports pairs the geometry contradicts), and an offset's whole point is to move a face
 * AWAY from where it was: measured, filtering a 40×40 plate's top face up by 5 made exactly that
 * one face lose its id while the five others kept theirs (they are extended rather than moved, so
 * their boxes still overlap). Nothing here is `Modified` — every face is `Generated` from its own
 * original or deleted — so there is no contradiction for the verification to catch and nothing
 * for the completion to recover.
 */
function buildOffsetFace(
    input: IShape,
    faces: IFace[],
    distance: number,
    keepRounds: boolean,
    context: FeatureContext,
): Result<IShape> {
    const offset = shapeFactory.offsetFacesTracked;
    if (offset === undefined) return Result.err("The kernel cannot offset faces");
    const rounds = keepRounds ? roundFaces(input, context.tracking?.inputFaceIds) : [];
    const built = offset(input, faces, distance, rounds);
    if (!built.isOk) return Result.err(problemMessage(built.error, distance));

    const tracking = context.tracking;
    if (tracking !== undefined) {
        const outputFaces = built.value.shape.findSubShapes(ShapeTypes.face);
        const outputEdges = built.value.shape.findSubShapes(ShapeTypes.edge);
        tracking.outputFaceIds = trackedFaceIds(
            tracking.inputFaceIds,
            tracking.inputEdgeIds,
            primaryAncestors(built.value.faceAncestors, outputFaces.length),
        );
        tracking.outputEdgeIds = trackedIds(
            tracking.inputEdgeIds,
            primaryAncestors(built.value.edgeAncestors, outputEdges.length),
        );
    }
    return Result.ok(built.value.shape);
}

/**
 * The faces of `input` that a Fillet made, which are the ones whose radius `keepRounds` keeps.
 *
 * Read off the NAMES, not the geometry: `edgeCorner.ts` names a face it rounds under the feature
 * that made it, hanging `:f` off every leaf of the id it derives from the input edge. A face whose
 * id has every leaf ending that way came from a corner feature — a Fillet, or a Chamfer, whose
 * faces are flat. The kernel does the rest of the telling apart (only a cylinder or a torus among
 * the faces it is handed counts as a round), so a chamfer arriving here costs nothing.
 *
 * A body whose chain is untracked hands back no ids, and then there are no rounds to keep: the
 * offset falls back to OCCT's own behavior rather than guessing at faces by shape.
 */
export function roundFaces(input: IShape, faceIds: readonly (string | undefined)[] | undefined): IFace[] {
    if (faceIds === undefined) return [];
    return (input.findSubShapes(ShapeTypes.face) as IFace[]).filter((_, index) =>
        isRoundName(faceIds[index]),
    );
}

function isRoundName(id: string | undefined): boolean {
    if (id === undefined) return false;
    // `split` never yields an empty array, so `every` alone is the whole test.
    return id.split(ID_COMPONENT_SEPARATOR).every((leaf) => leaf.endsWith(":f"));
}

/** A length as the messages print it: millimetres, at most two decimals, no trailing zeros. */
function formatLength(value: number): string {
    return `${parseFloat(value.toFixed(2))} mm`;
}

/**
 * What to tell the user about a failed offset, from the kernel's classification (see
 * `OffsetFaceProblem`). Worded here rather than in the kernel because two of the six need a
 * number the kernel only reports, not a sentence.
 */
function problemMessage(problem: OffsetFaceProblem, distance: number): string {
    switch (problem.status) {
        case 1:
            return problem.maxDistance > 0
                ? `Offset Face: ${formatLength(Math.abs(distance))} is too far for this body (max ≈ ${formatLength(problem.maxDistance)}). Try a smaller distance.`
                : `Offset Face: ${formatLength(Math.abs(distance))} is too far, and so is anything smaller. Check the faces around it.`;
        case 2:
            return "Offset Face: these faces can't be offset at any distance. Faces that run into fillets or other curved faces often stop this — try moving a flat face, or offset before rounding the edges.";
        case 3:
            return "Offset Face needs a solid body.";
        case 4:
            return "Offset Face: this body has a sealed cavity inside, which it can't handle yet. Offset the faces before hollowing the body closed, or open the cavity with a shell.";
        case 6:
            return "Offset Face: this body has rounded edges meeting at a sharp corner, which OCCT can't offset without corrupting its memory. Offset the faces before rounding the edges, or round every edge at the corner so they blend.";
        default:
            return "Offset Face failed. Try a smaller distance, or other faces.";
    }
}

registerFeature("offsetFace", offsetFaceHandler);
