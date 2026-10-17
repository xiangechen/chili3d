// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IShape, Matrix4, Result } from "@chili3d/core";
import { type FeatureContext, type FeatureHandler, type MirrorFeatureData, registerFeature } from "./feature";
import { mergeTrackedCopies } from "./mergeCopies";
import { resolveNeutralPlane } from "./neutralPlane";
import { prefixedId } from "./trackedId";

/**
 * Mirror (Onshape's Mirror part): the body's chain input mirrored about a plane, fused into one
 * body (the default) or kept as an unmerged compound of the two halves.
 *
 * Structured like `boolean.ts` — the merge IS a tracked fuse, with the mirrored copy in the tool
 * seat — with one difference that shapes everything below: the tool is not another node, it is
 * the input itself transformed. So its sub-shapes correspond to the input's ONE TO ONE, and they
 * are named from the input's own ids under the feature's scope (`mirroredIds`) rather than read
 * off a tool node (`mapBooleanIds`'s `tool:<nodeId>` prefix). That the correspondence is
 * positional is a kernel fact, not an assumption to hedge: `transformedMul` is
 * `BRepBuilderAPI_Transform`, which rebuilds the topology tree without reordering it, so the
 * copy's findSubShapes enumeration runs parallel to the input's (the kernel test
 * `mirrorFollow.kernel.test.ts` pins this down). The id mappers consume the copy's ids through
 * the same main/tool boundary contract as an extrude's join (`mapOperationIds`): the kernel's
 * history enumerates the input first, then the copy.
 *
 * What is deliberately NOT named: on the untracked path (no kernel history) the copy's sub-shapes
 * get no ids at all rather than a positional guess — the argument `trackedIds` in feature.ts
 * gives. And the merge=false compound names its halves by the same rule, because `combine`
 * appends in argument order and TopExp explores a compound in insertion order: the input's
 * sub-shapes first, then the copy's, one to one.
 */

const mirrorHandler: FeatureHandler<MirrorFeatureData> = {
    display: "command.feature.mirror",
    icon: "icon-mirror",
    reselectable: true,

    nodeIds: (feature) => (feature.plane.kind === "face" ? [feature.plane.ref.nodeId] : []),

    references: (feature) =>
        feature.plane.kind === "face"
            ? [{ key: "plane", display: "feature.mirror.plane", nodeId: feature.plane.ref.nodeId }]
            : [],

    parameters: (feature) => [
        { key: "merge", display: "option.command.merge", value: feature.merge ?? true },
    ],

    setParameter: (feature, key, value) =>
        key === "merge" ? { ...feature, merge: value === true || value === "true" } : feature,

    evaluate(feature, context): Result<IShape> {
        const input = context.input;
        if (input === undefined) return Result.err("Mirror requires a preceding feature");
        const plane = resolveNeutralPlane(feature.plane, context, "Mirror");
        if (!plane.isOk) return Result.err(plane.error);

        const copy = input.transformedMul(Matrix4.createMirrorWithPlane(plane.value));
        if (feature.merge === false) return combineHalves(feature, context, input, copy);
        try {
            return mergeCopy(feature, context, input, copy);
        } finally {
            // The fuse copies the geometry it keeps — the mirrored tool is an intermediate
            // input, disposed once the operation returns (the boolean feature's own contract).
            copy.dispose();
        }
    },
};

/**
 * The copy's sub-shape ids: the input's own, scoped under the feature, one per input sub-shape
 * and in the same order (see the module header). Prefixing rather than reusing is what separates
 * the two halves: a face and its reflection would otherwise share one id, and a reference onto
 * either would resolve to both. An input sub-shape with no id names nothing on the copy either.
 */
function mirroredIds(featureId: string, ids: readonly (string | undefined)[]): (string | undefined)[] {
    return ids.map((id) => (id === undefined ? undefined : prefixedId(`mirror:${featureId}`, id)));
}

/**
 * The unmerged variant: input and copy side by side in one compound. `combine` appends in
 * argument order and a compound explores in insertion order, so the output enumeration is the
 * input's sub-shapes followed by the copy's — the ids concatenate in the same order, no mapping
 * needed.
 */
function combineHalves(
    feature: MirrorFeatureData,
    context: FeatureContext,
    input: IShape,
    copy: IShape,
): Result<IShape> {
    const combined = shapeFactory.combine([input, copy]);
    if (!combined.isOk) return Result.err(combined.error);
    const tracking = context.tracking;
    if (tracking !== undefined) {
        tracking.outputFaceIds = [
            ...tracking.inputFaceIds,
            ...mirroredIds(feature.id, tracking.inputFaceIds),
        ];
        tracking.outputEdgeIds = [
            ...tracking.inputEdgeIds,
            ...mirroredIds(feature.id, tracking.inputEdgeIds),
        ];
    }
    return Result.ok(combined.value);
}

/**
 * The merged variant: the copy IS the input reflected, so its sub-shapes run parallel to the
 * input's and are named from the input's own ids under the feature's scope (`mirroredIds`) rather
 * than read off a tool node. Everything else the merge does is shared (`mergeTrackedCopies`) —
 * which is the whole point: a mirror is a pattern of one copy.
 */
function mergeCopy(
    feature: MirrorFeatureData,
    context: FeatureContext,
    input: IShape,
    copy: IShape,
): Result<IShape> {
    const tracking = context.tracking;
    if (tracking === undefined) return shapeFactory.booleanFuse([input], [copy], true);
    return mergeTrackedCopies(
        input,
        [copy],
        mirroredIds(feature.id, tracking.inputFaceIds),
        mirroredIds(feature.id, tracking.inputEdgeIds),
        tracking,
    );
}

registerFeature("mirror", mirrorHandler);
