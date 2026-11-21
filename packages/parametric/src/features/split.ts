// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    BoundingBox,
    type IFace,
    type IShape,
    type IVertex,
    type Plane,
    Result,
    ShapeTypes,
    type XYZ,
} from "@chili3d/core";
import {
    type FeatureContext,
    type FeatureHandler,
    planeRefNodeId,
    registerFeature,
    type SplitFeatureData,
} from "./feature";
import { resolveNeutralPlane } from "./neutralPlane";
import { captureProfileRef } from "./profileRef";
import { matchSourceFaceIndexes, resolveSourceFaces } from "./sourceFaceMatcher";

/**
 * Split the chain input with a plane or a surface. Plane tools are inflated into a rectangle
 * large enough to cover the input; surface tools cut with every referenced face piece.
 * The operation has no tracked variant, so result sub-shape ids use geometric matching.
 */
const splitHandler: FeatureHandler<SplitFeatureData> = {
    display: "command.feature.split",
    icon: "icon-split",

    nodeIds: (feature) => {
        const nodeId = feature.tool.kind === "surface" ? feature.tool.nodeId : planeRefNodeId(feature.tool);
        return nodeId === undefined ? [] : [nodeId];
    },

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

    applyResolvedRefs: (feature, { resolvedProfiles }) => {
        if (feature.tool.kind !== "surface" || resolvedProfiles === undefined) return feature;
        return { ...feature, tool: { ...feature.tool, profiles: resolvedProfiles } };
    },

    evaluate(feature, context): Result<IShape> {
        const input = context.input;
        if (input === undefined) return Result.err("Split requires a preceding feature");
        if (feature.tool.kind === "surface") {
            return evaluateSurface(feature.tool, context, input, feature.keepSide);
        }
        const plane = resolveNeutralPlane(feature.tool, context, "Split");
        if (!plane.isOk) return Result.err(plane.error);
        return splitByPlane(input, plane.value, feature.keepSide);
    },
};

/** The feature's plane build, shared with the command's live preview. */
export function splitByPlane(
    input: IShape,
    plane: Plane,
    keepSide: SplitFeatureData["keepSide"] = "both",
): Result<IShape> {
    const side = keepSide ?? "both";
    if (!["both", "positive", "negative"].includes(side)) {
        return Result.err(`Invalid keep side: ${side}`);
    }
    const tool = splitTool(plane, input);
    if (!tool.isOk) return Result.err(tool.error);
    try {
        const split = input.split([tool.value]);
        return pickSide(split, plane, side);
    } finally {
        tool.value.dispose();
    }
}

/** The feature's surface build, shared with the command's live preview. `tools` stay caller-owned. */
export function splitBySurface(
    input: IShape,
    tools: readonly IFace[],
    keepSide: SplitFeatureData["keepSide"] = "both",
): Result<IShape> {
    const side = keepSide ?? "both";
    if (!["both", "positive", "negative"].includes(side)) {
        return Result.err(`Invalid keep side: ${side}`);
    }
    if (tools.length === 0) return Result.err("Split requires at least one surface tool");
    const split = input.split([...tools]);
    return pickSurfaceSide(split, tools, side);
}

function evaluateSurface(
    tool: Extract<SplitFeatureData["tool"], { kind: "surface" }>,
    context: FeatureContext,
    input: IShape,
    keepSide: SplitFeatureData["keepSide"],
): Result<IShape> {
    const resolved = resolveSourceFaces({ nodeId: tool.nodeId, profiles: tool.profiles }, context, "Split");
    if (!resolved.isOk) return Result.err(resolved.error);
    const { worldFaces, faceIds, owned } = resolved.value;
    try {
        const matched = matchSourceFaceIndexes(worldFaces, faceIds, tool.profiles);
        if (!matched.isOk) return Result.err(matched.error);
        if (matched.value.indexes.length === 0) return Result.err("Split surface not found after rebuild");
        if (context.tracking !== undefined) {
            context.tracking.resolvedProfiles = matched.value.indexes.map((faceIndex, k) =>
                captureProfileRef(
                    worldFaces[faceIndex],
                    faceIds?.[faceIndex],
                    tool.profiles[matched.value.refIndexes[k]].splitPiece,
                    true,
                ),
            );
            if (matched.value.missing.length > 0) {
                context.tracking.unresolved = { key: "profiles", refIndexes: matched.value.missing };
            }
        }
        const inverse = context.host.worldTransform().invert();
        if (inverse === undefined) return Result.err("Split cannot place the surface in the body");
        const localTools = matched.value.indexes.map(
            (index) => worldFaces[index].transformedMul(inverse) as IFace,
        );
        try {
            return splitBySurface(input, localTools, keepSide);
        } finally {
            localTools.forEach((localTool) => {
                localTool.dispose();
            });
        }
    } finally {
        owned.forEach((shape) => {
            shape.dispose();
        });
    }
}

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

function pickSide(split: IShape, plane: Plane, keepSide: "both" | "positive" | "negative"): Result<IShape> {
    return pickPieces(split, keepSide, (piece) => {
        const center = BoundingBox.center(piece.boundingBox());
        return center.sub(plane.origin).dot(plane.normal);
    });
}

function pickSurfaceSide(
    split: IShape,
    tools: readonly IFace[],
    keepSide: "both" | "positive" | "negative",
): Result<IShape> {
    return pickPieces(split, keepSide, (piece) => surfaceSide(piece, tools));
}

function pickPieces(
    split: IShape,
    keepSide: "both" | "positive" | "negative",
    sideOf: (piece: IShape) => number,
): Result<IShape> {
    if (keepSide === "both") return Result.ok(split);
    const kept = split.directSubShapes().filter((piece) => {
        const side = sideOf(piece);
        return keepSide === "positive" ? side > 0 : side < 0;
    });
    if (kept.length === 0) {
        return Result.err("Split: nothing remains on the kept side — the tool misses the input");
    }
    if (kept.length === 1) return Result.ok(kept[0]);
    const combined = shapeFactory.combine(kept);
    return combined.isOk ? Result.ok(combined.value) : Result.err(combined.error);
}

/**
 * The signed side of a piece, sampled at its centre and vertices. The farthest sample wins:
 * a symmetric shell around a cylindrical tool has its bbox centre on the axis like the inner
 * solid, but its outer vertices are unambiguously outside.
 */
function surfaceSide(piece: IShape, tools: readonly IFace[]): number {
    const samples = [
        BoundingBox.center(piece.boundingBox()),
        ...(piece.findSubShapes(ShapeTypes.vertex) as IVertex[]).map((vertex) => vertex.point()),
    ];
    let best = 0;
    for (const point of samples) {
        const signed = signedSurfaceDistance(point, tools);
        if (Math.abs(signed) > Math.abs(best)) best = signed;
    }
    return best;
}

function signedSurfaceDistance(point: XYZ, tools: readonly IFace[]): number {
    let best: { distance: number; signed: number } | undefined;
    for (const tool of tools) {
        const surface = tool.surface();
        const nearest = surface.nearestPoint(point);
        if (nearest === undefined) continue;
        const uv = surface.parameter(nearest[0], 1e-3);
        if (uv === undefined) continue;
        const normal = tool.normal(uv.u, uv.v)[1].normalize();
        if (normal === undefined) continue;
        const candidate = {
            distance: point.distanceTo(nearest[0]),
            signed: point.sub(nearest[0]).dot(normal),
        };
        if (best === undefined || candidate.distance < best.distance) best = candidate;
    }
    return best?.signed ?? 0;
}

registerFeature("split", splitHandler);
