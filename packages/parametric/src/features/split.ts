// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { BoundingBox, type IShape, type Plane, Result, ShapeTypes } from "@chili3d/core";
import { type FeatureContext, type FeatureHandler, registerFeature, type SplitFeatureData } from "./feature";
import { resolveNeutralPlane } from "./neutralPlane";

/**
 * Split: cut the chain input with a plane, keeping both halves (one compound) or only the
 * piece(s) on one side.
 *
 * The tool is a neutral plane (`SplitFeatureData.tool` documents why planar only), resolved
 * exactly as a draft's is, then inflated into a rectangle face large enough to cover the
 * input's bounding box — the kernel entry (`IShape.split`, a BOPAlgo splitter) cuts by the
 * tool FACE, not by the infinite plane.
 *
 * There is no tracked variant of the operation: the pieces keep no kernel history, so their
 * sub-shape ids fall back to geometric matching (the `trackedIds` fallback in `feature.ts`).
 * A reference anchored across a split re-matches by fingerprint — stable for a planar cut,
 * which is the other half of why the tool is planar.
 */
const splitHandler: FeatureHandler<SplitFeatureData> = {
    display: "command.feature.split",
    icon: "icon-split",

    nodeIds: (feature) => (feature.tool.kind === "face" ? [feature.tool.ref.nodeId] : []),

    parameters: (feature) => [
        {
            key: "keepSide",
            display: "option.command.keepSide",
            value: feature.keepSide ?? "both",
            choices: (["both", "positive", "negative"] as const).map((side) => ({
                value: side,
                display: `option.command.keepSide.${side}`,
            })),
        },
    ],

    setParameter: (feature, key, value) => ({ ...feature, [key]: value }),

    evaluate(feature, context): Result<IShape> {
        const input = context.input;
        if (input === undefined) return Result.err("Split requires a preceding feature");
        const keepSide = feature.keepSide ?? "both";
        if (!["both", "positive", "negative"].includes(keepSide)) {
            return Result.err(`Invalid keep side: ${keepSide}`);
        }
        const plane = resolveNeutralPlane(feature.tool, context, "Split");
        if (!plane.isOk) return Result.err(plane.error);

        const tool = splitTool(plane.value, input);
        if (!tool.isOk) return Result.err(tool.error);
        try {
            const split = input.split([tool.value]);
            return pickSide(split, plane.value, keepSide);
        } finally {
            tool.value.dispose();
        }
    },
};

/**
 * A rectangle face on `plane` covering `input`'s bounding box with room to spare — the
 * splitter only cuts where the tool face actually is, so a tool smaller than the input would
 * leave a half-attached flap instead of two clean pieces.
 */
function splitTool(plane: Plane, input: IShape) {
    const box = input.boundingBox();
    const center = BoundingBox.center(box);
    const half = center.distanceTo(box.max) + 1;
    const projected = plane.project(center);
    const corner = projected.sub(plane.xvec.multiply(half)).sub(plane.yvec.multiply(half));
    return shapeFactory.rect(plane.translateTo(corner), 2 * half, 2 * half);
}

/**
 * The pieces of `split` the keep-side names: all of them (`both`), or the ones whose bounding-box
 * centre sits on the plane normal's side of it (`positive`) / the opposite side (`negative`).
 * A side with no pieces is an error — the plane missed the input, and a silent empty compound
 * would read as a successful split.
 */
function pickSide(split: IShape, plane: Plane, keepSide: "both" | "positive" | "negative"): Result<IShape> {
    if (keepSide === "both") return Result.ok(split);
    const pieces = split.directSubShapes();
    const kept = pieces.filter((piece) => {
        const center = BoundingBox.center(piece.boundingBox());
        const side = center.sub(plane.origin).dot(plane.normal);
        return keepSide === "positive" ? side > 0 : side < 0;
    });
    // A piece ON the plane (a zero-thickness sliver the cut shaved off) lands in neither side.
    if (kept.length === 0)
        return Result.err("Split: nothing remains on the kept side — the plane misses the input");
    if (kept.length === 1) return Result.ok(kept[0]);
    const combined = shapeFactory.combine(kept);
    return combined.isOk ? Result.ok(combined.value) : Result.err(combined.error);
}

registerFeature("split", splitHandler);
