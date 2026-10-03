// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    ANGLE_UNITS,
    type IFace,
    type IShape,
    Matrix4,
    type Plane,
    Result,
    resolveUnitSpec,
    ShapeNode,
    ShapeTypes,
    type XYZ,
} from "@chili3d/core";
import { datumPlaneOf, type IdLookup, type IdMultiLookup, matchFace, planeOfFace } from "../sketch/planeRef";
import { isBodyTrackingNode } from "./bodyTracking";
import { type DraftInput, draftTracked } from "./draftTracked";
import {
    type DraftFeatureData,
    type FeatureContext,
    type FeatureHandler,
    type IShapeHost,
    type NeutralPlaneRef,
    registerFeature,
} from "./feature";
import { captureProfileRef } from "./profileRef";
import { matchSourceFaceIndexes } from "./sourceFaceMatcher";
import { indexesOfOverlappingId } from "./trackedId";

/**
 * Draft: the body's chain input has the faces the feature names tapered about a neutral plane,
 * so the part can leave its mould.
 *
 * Structured like `shell.ts` — it consumes the shape the chain has built and names sub-shapes OF
 * it, with the same tracking contract — and the kernel call is the difference: a taper rotating
 * each face about its intersection with a plane, rather than a hollow. What it does NOT share with
 * shell is where its OTHER reference lives: a shell's open faces must be sub-shapes of the input,
 * while a draft's neutral plane may be geometry of an entirely different body, or one of the three
 * datums. That one is therefore resolved in world coordinates and mapped back (see
 * `resolveNeutralPlane`).
 */

const draftHandler: FeatureHandler<DraftFeatureData> = {
    display: "command.feature.draft",
    icon: "icon-draft",
    reselectable: true,

    nodeIds: (feature) => (feature.neutralPlane.kind === "face" ? [feature.neutralPlane.ref.nodeId] : []),

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
        const neutral = resolveNeutralPlane(feature, context);
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
    }
    return Result.ok(matched.value.indexes.map((index) => faces[index]));
}

/**
 * The neutral plane in the HOST'S OWN FRAME, which is the frame the kernel runs in.
 *
 * The one reference a draft has that may live outside the body it tapers, so it is resolved in
 * two halves: `neutralWorldPlane` finds it in world coordinates (where it was captured), and this
 * maps it back with the host's transform. The mapping is rigid in practice — a body's transform is
 * a placement — and the only transform that could make `Plane.transformed` throw is a singular
 * one, which `invert()` already reports as undefined.
 */
function resolveNeutralPlane(feature: DraftFeatureData, context: FeatureContext): Result<Plane> {
    const world = neutralWorldPlane(feature.neutralPlane, context);
    if (!world.isOk) return Result.err(world.error);
    return neutralPlaneInHost(world.value, context.host);
}

/**
 * A world-space plane expressed in the host body's own frame — the frame its feature chain and
 * the kernel live in. Exported because the command's live preview needs the same mapping: it
 * builds its shape with the same kernel call the feature will make, so a plane mapped any other
 * way would preview a taper the feature does not build.
 */
export function neutralPlaneInHost(world: Plane, host: IShapeHost): Result<Plane> {
    const inverse = host.worldTransform().invert();
    if (inverse === undefined) return Result.err("Draft cannot place the neutral plane in the body");
    return Result.ok(world.transformed(inverse));
}

/** The neutral plane as captured: a datum by name, or a face ref re-matched on its node. */
function neutralWorldPlane(ref: NeutralPlaneRef, context: FeatureContext): Result<Plane> {
    if (ref.kind === "datum") return Result.ok(datumPlaneOf(ref.name));
    const source = planeFaceSource(ref.ref.nodeId, context);
    if (!source.isOk) return Result.err(source.error);
    const face = matchFace(
        source.value.faces,
        source.value.transform,
        ref.ref,
        idLookup(source.value.faceIds),
        idMultiLookup(source.value.faceIds),
    );
    if (face === undefined) return Result.err("Draft neutral plane not found after rebuild");
    // `planeOfFace` rather than the sketch path's `sketchPlaneOfFace`: a draft wants the face's
    // own outward plane (its normal is the default pull direction), not a sketch's re-origined
    // frame. Both lie on the same plane, so only the orientation of the frame differs.
    const worldFace = source.value.transform.equals(Matrix4.identity())
        ? face
        : (face.transformedMul(source.value.transform) as IFace);
    try {
        return Result.ok(planeOfFace(worldFace));
    } finally {
        if (worldFace !== face) worldFace.dispose();
    }
}

/** A face set a plane ref is matched against, with the frame it lives in and its tracked ids. */
interface PlaneFaceSource {
    readonly faces: IFace[];
    readonly faceIds: readonly (string | undefined)[] | undefined;
    readonly transform: Matrix4;
}

/**
 * The faces `nodeId`'s plane ref was captured on.
 *
 * The host's OWN id is the interesting case and is deliberately not routed through
 * `resolveFacePlane(document, ref)` (the sketch path): that reads the referenced node's final
 * shape, and this feature is being replayed INTO that node — its final shape is the previous
 * rebuild's, and on the very first one there is none at all. `context.input` is by definition the
 * chain state at this feature's position, so that is what the ref is matched on. A FOREIGN node
 * has no such circularity and is read off its live shape, the way `sourceNodeFaces` does it for a
 * press-pull.
 */
function planeFaceSource(nodeId: string, context: FeatureContext): Result<PlaneFaceSource> {
    if (nodeId === context.host.id) {
        const input = context.input;
        if (input === undefined) return Result.err("Draft requires a preceding feature");
        const faces = input.findSubShapes(ShapeTypes.face) as IFace[];
        const ids = context.tracking?.inputFaceIds;
        return Result.ok({
            faces,
            faceIds: ids !== undefined && ids.length === faces.length ? ids : undefined,
            transform: context.host.worldTransform(),
        });
    }
    const node = context.document.modelManager.findNode((n) => n.id === nodeId);
    if (!(node instanceof ShapeNode) || !node.shape.isOk) {
        return Result.err("Draft neutral plane body not found");
    }
    const faces = node.shape.value.findSubShapes(ShapeTypes.face) as IFace[];
    const tracked = isBodyTrackingNode(node) ? node : undefined;
    return Result.ok({
        faces,
        faceIds: tracked === undefined ? undefined : faces.map((_, index) => tracked.faceIdAt(index)),
        transform: node.worldTransform(),
    });
}

/** The tracked-id lookup a face set gives `matchFace`, or undefined where it carries no tracking. */
function idLookup(ids: readonly (string | undefined)[] | undefined): IdLookup {
    return ids === undefined
        ? undefined
        : (id) => {
              const index = ids.indexOf(id);
              return index < 0 ? undefined : index;
          };
}

/** The multi-hit counterpart of `idLookup`: a face split since the capture matches by every piece. */
function idMultiLookup(ids: readonly (string | undefined)[] | undefined): IdMultiLookup {
    return ids === undefined ? undefined : (id) => indexesOfOverlappingId(ids, id);
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
