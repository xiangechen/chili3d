// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IFace, type IShape, LENGTH_UNITS, Result, resolveUnitSpec, ShapeTypes } from "@chili3d/core";
import { type FeatureContext, type FeatureHandler, registerFeature, type ShellFeatureData } from "./feature";
import { captureProfileRef } from "./profileRef";
import { shellTracked } from "./shellTracked";
import { matchSourceFaceIndexes } from "./sourceFaceMatcher";

/**
 * Shell: the body's chain input is hollowed to a wall thickness, with the faces the feature names
 * left open.
 *
 * Structured like `edgeCorner.ts` — the same relationship to its input (it consumes the shape the
 * chain has built, and names sub-shapes OF it), the same tracking contract — with the kernel call
 * being a thicken-by-join rather than a corner. What it does NOT share with `thicken.ts` is where
 * its faces live: a thicken's may sit on another body and are resolved in world coordinates, while
 * a shell's must be sub-shapes of the input itself, so they are resolved against `context.input`
 * in its own frame (see `resolveOpenFaces`).
 */

const shellHandler: FeatureHandler<ShellFeatureData> = {
    display: "command.feature.shell",
    icon: "icon-shell",
    reselectable: true,

    nodeIds: () => [],

    parameters: (feature) => [
        {
            key: "thickness",
            display: "option.command.thickness",
            value: feature.thickness,
            unit: LENGTH_UNITS,
        },
        { key: "outward", display: "option.command.outward", value: feature.outward ?? false },
        { key: "joinType", display: "option.command.joinType", value: feature.joinType ?? "arc" },
    ],

    setParameter: (feature, key, value) =>
        key === "outward"
            ? { ...feature, outward: value === true || value === "true" }
            : { ...feature, [key]: value },

    applyResolvedRefs: (feature, { resolvedProfiles }) =>
        resolvedProfiles === undefined ? feature : { ...feature, faces: resolvedProfiles },

    evaluate(feature, context): Result<IShape> {
        const input = context.input;
        if (input === undefined) return Result.err("Shell requires a preceding feature");
        const thickness = resolveUnitSpec(feature.thickness, context.scope, LENGTH_UNITS);
        if (!thickness.isOk) return Result.err(thickness.error);
        if (!(thickness.value > 0)) return Result.err("Shell requires a positive thickness");
        const open = resolveOpenFaces(feature, context, input);
        if (!open.isOk) return Result.err(open.error);
        if (open.value.indexes.length === 0) return Result.err("Shell requires at least one open face");

        // Negative carves the wall out of the input, positive adds it outside (measured both
        // ways), so `outward` flips the sign and never the magnitude.
        const signed = feature.outward === true ? thickness.value : -thickness.value;
        return buildShell(input, open.value, signed, feature, context);
    },
};

/** The faces to open on the input, plus their indexes in the input's own face enumeration. */
interface OpenFaces {
    readonly faces: IFace[];
    readonly indexes: number[];
}

/**
 * Re-matches the feature's stored faces on the rebuilt input, by tracked id first and geometric
 * fingerprint second (`matchSourceFaceIndexes`), and re-anchors them for the body's write-back —
 * the same drift-from-latest-match contract the edge features use.
 *
 * Deliberately NOT routed through `resolveSourceFaces` the way a thicken is: that helper maps the
 * source into world coordinates, and a transformed copy is a new TShape, which the kernel's
 * closing-face lookup (an `IsSame` match) would miss — the opening would silently not happen.
 * The faces here are read off `context.input` itself and handed over untouched.
 */
function resolveOpenFaces(
    feature: ShellFeatureData,
    context: FeatureContext,
    input: IShape,
): Result<OpenFaces> {
    const faces = input.findSubShapes(ShapeTypes.face) as IFace[];
    const faceIds = context.tracking?.inputFaceIds;
    const matched = matchSourceFaceIndexes(faces, faceIds, feature.faces);
    if (!matched.isOk) return Result.err(matched.error);
    if (context.tracking !== undefined) {
        // One ref per adopted face: a face split since the pick becomes one ref per piece. No
        // outward normal is captured — a shell opens curved faces too, and the planar normal gate
        // would reject a legitimate re-match of one (the same call the thicken makes).
        context.tracking.resolvedProfiles = matched.value.indexes.map((faceIndex, k) =>
            captureProfileRef(
                faces[faceIndex],
                faceIds?.[faceIndex],
                feature.faces[matched.value.refIndexes[k]].splitPiece,
            ),
        );
    }
    return Result.ok({
        faces: matched.value.indexes.map((index) => faces[index]),
        indexes: matched.value.indexes,
    });
}

/**
 * Runs the hollow, preferring the kernel's tracked variant so the result's history can fill the
 * body's output ids. The plain variant is the fallback whenever the body or the kernel offers no
 * tracking — the same geometry with no ids at all, which the body then degrades to geometric
 * matching (`trackedIds` in feature.ts).
 */
function buildShell(
    input: IShape,
    open: OpenFaces,
    signed: number,
    feature: ShellFeatureData,
    context: FeatureContext,
): Result<IShape> {
    const tracking = context.tracking;
    if (tracking !== undefined) {
        const built = shellTracked(
            {
                shape: input,
                openFaces: open.faces,
                openFaceIndexes: open.indexes,
                faceIds: tracking.inputFaceIds,
                edgeIds: tracking.inputEdgeIds,
            },
            signed,
            feature.joinType ?? "arc",
            feature.id,
        );
        if (built !== undefined) {
            if (!built.isOk) return Result.err(built.error);
            tracking.outputFaceIds = built.value.faceIds;
            tracking.outputEdgeIds = built.value.edgeIds;
            return Result.ok(built.value.shape);
        }
    }
    return shapeFactory.makeThickSolidByJoin(input, open.faces, signed, feature.joinType ?? "arc");
}

registerFeature("shell", shellHandler);
