// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    ANGLE_UNITS,
    type IFace,
    type IShape,
    type Plane,
    Result,
    resolveUnitSpec,
    ShapeTypes,
    type XYZ,
} from "@chili3d/core";
import { type DraftInput, draftTracked } from "./draftTracked";
import {
    type DraftFeatureData,
    type FeatureContext,
    type FeatureHandler,
    type NeutralPlaneRef,
    planeRefNodeId,
    registerFeature,
} from "./feature";
import { resolveNeutralPlane } from "./neutralPlane";
import { captureProfileRef } from "./profileRef";
import { matchSourceFaceIndexes } from "./sourceFaceMatcher";

/**
 * Draft: the body's chain input has the faces the feature names tapered about a neutral plane,
 * so the part can leave its mould.
 *
 * Structured like `shell.ts` — it consumes the shape the chain has built and names sub-shapes OF
 * it, with the same tracking contract — and the kernel call is the difference: a taper rotating
 * each face about its intersection with a plane, rather than a hollow. What it does NOT share with
 * shell is where its OTHER reference lives: a shell's open faces must be sub-shapes of the input,
 * while a draft's neutral plane may be geometry of an entirely different body, or one of the three
 * datums. That one is therefore resolved in world coordinates and mapped back — the shared
 * `resolveNeutralPlane` in `neutralPlane.ts`, which the mirror feature resolves its own plane
 * through as well.
 */

const draftHandler: FeatureHandler<DraftFeatureData> = {
    display: "command.feature.draft",
    icon: "icon-draft",
    reselectable: true,

    nodeIds: (feature) => {
        const nodeId = planeRefNodeId(feature.neutralPlane);
        return nodeId === undefined ? [] : [nodeId];
    },

    parameters: (feature) => [
        { key: "angle", display: "common.angle", value: feature.angle, unit: ANGLE_UNITS },
        { key: "reverse", display: "option.command.oppositeDirection", value: feature.reverse ?? false },
    ],

    setParameter: (feature, key, value) =>
        key === "reverse"
            ? { ...feature, reverse: value === true || value === "true" }
            : { ...feature, [key]: value },

    applyResolvedRefs: (feature, { resolvedProfiles }) =>
        resolvedProfiles === undefined ? feature : { ...feature, faces: resolvedProfiles },

    evaluate(feature, context): Result<IShape> {
        const input = context.input;
        if (input === undefined) return Result.err("Draft requires a preceding feature");
        const angle = resolveUnitSpec(feature.angle, context.scope, ANGLE_UNITS);
        if (!angle.isOk) return Result.err(angle.error);
        // Measured: at zero the kernel does not fail, it silently hands the input straight back —
        // no face's surface is recomputed, so nothing is registered and `Build` "succeeds". That
        // would be a feature that quietly does nothing, which is worse than a row saying so.
        if (angle.value === 0) return Result.err("Draft requires a non-zero angle");

        const faces = resolveDraftFaces(feature, context, input);
        if (!faces.isOk) return Result.err(faces.error);
        if (faces.value.length === 0) return Result.err("Draft requires at least one face to taper");
        const neutral = resolveNeutralPlane(feature.neutralPlane, context, "Draft");
        if (!neutral.isOk) return Result.err(neutral.error);

        // The pull direction is the neutral plane's own normal — Fusion's and Onshape's default —
        // and `reverse` flips which side a positive angle takes material from, which is what the
        // UI's opposite-direction option means.
        //
        // Which side that is was MEASURED, not reasoned (OCCT's docs state it but read backwards
        // easily): `Add` "indicates the side of NeutralPlane from which matter is removed if Angle
        // is positive". On a 40×40×20 box whose four sides are tapered about Plane.XY at +5°, a
        // direction of +Z returns volume 29282 — the box narrows going up, the mould draft — and
        // −Z returns 34881, the flare. A datum plane's +normal points into a part built on it,
        // while a face's outward normal points away from the material, so the SAME angle tapers
        // in opposite senses depending on which of the two the user picked. That is not a hidden
        // asymmetry to paper over: it is why both tools in this space ship a flip.
        const direction = feature.reverse === true ? neutral.value.normal.multiply(-1) : neutral.value.normal;
        return buildDraft(input, faces.value, direction, angle.value, neutral.value, feature, context);
    },
};

/**
 * The faces to taper, re-matched on the rebuilt input by tracked id first and geometric
 * fingerprint second (`matchSourceFaceIndexes`), re-anchored for the body's write-back — the same
 * drift-from-latest-match contract shell, thicken and the edge features all follow.
 *
 * Like a shell's open faces and UNLIKE a thicken's source, these are read off `context.input`
 * itself and handed to the kernel untouched: it matches them by `IsSame`, and a transformed copy
 * from another frame is a new TShape that would taper nothing.
 */
function resolveDraftFaces(
    feature: DraftFeatureData,
    context: FeatureContext,
    input: IShape,
): Result<IFace[]> {
    const faces = input.findSubShapes(ShapeTypes.face) as IFace[];
    const faceIds = context.tracking?.inputFaceIds;
    const matched = matchSourceFaceIndexes(faces, faceIds, feature.faces);
    if (!matched.isOk) return Result.err(matched.error);
    if (context.tracking !== undefined) {
        // One ref per adopted face: a face split since the pick becomes one ref per piece. No
        // outward normal is captured — a draft accepts curved faces too, and the planar normal
        // gate would reject a legitimate re-match of one (the same call the shell and thicken make).
        context.tracking.resolvedProfiles = matched.value.indexes.map((faceIndex, k) =>
            captureProfileRef(
                faces[faceIndex],
                faceIds?.[faceIndex],
                feature.faces[matched.value.refIndexes[k]].splitPiece,
            ),
        );
        // A picked face the input no longer has costs the user that taper, not the whole
        // draft — the same tolerance the sketch-profile path keeps.
        if (matched.value.missing.length > 0) {
            context.tracking.unresolved = { key: "faces", refIndexes: matched.value.missing };
        }
    }
    return Result.ok(matched.value.indexes.map((index) => faces[index]));
}

/**
 * Runs the taper, preferring the kernel's tracked variant so the result's history can fill the
 * body's output ids. The plain variant is the fallback whenever the body or the kernel offers no
 * tracking — the same geometry with no ids at all, which the body then degrades to geometric
 * matching (`trackedIds` in feature.ts).
 */
function buildDraft(
    input: IShape,
    faces: readonly IFace[],
    direction: XYZ,
    angle: number,
    neutral: Plane,
    feature: DraftFeatureData,
    context: FeatureContext,
): Result<IShape> {
    const tracking = context.tracking;
    if (tracking !== undefined) {
        const built = draftTracked(
            {
                shape: input,
                faces,
                faceIds: tracking.inputFaceIds,
                edgeIds: tracking.inputEdgeIds,
            } satisfies DraftInput,
            direction,
            angle,
            neutral,
            feature.id,
        );
        if (built !== undefined) {
            if (!built.isOk) return Result.err(built.error);
            tracking.outputFaceIds = built.value.faceIds;
            tracking.outputEdgeIds = built.value.edgeIds;
            return Result.ok(built.value.shape);
        }
    }
    return shapeFactory.draft(input, [...faces], direction, angle, neutral);
}

registerFeature("draft", draftHandler);
