// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    ANGLE_UNITS,
    CurveUtils,
    type FeatureParameter,
    type IEdge,
    type IShape,
    LENGTH_UNITS,
    Line,
    MathUtils,
    Matrix4,
    type ParameterValue,
    Result,
    resolveUnitSpec,
    type Scope,
    ShapeNode,
    ShapeTypes,
    UNITLESS,
    XYZ,
} from "@chili3d/core";
import { isBodyTimelineNode, isBodyTrackingNode } from "./bodyTracking";
import { matchEdgeIndexes, matchEdgesAnchored } from "./edgeMatcher";
import { captureEdgeRef, type EdgeRef } from "./edgeRef";
import {
    type FeatureContext,
    type FeatureHandler,
    type PatternFeatureData,
    type PatternLineSource,
    registerFeature,
} from "./feature";
import { mergeTrackedCopies } from "./mergeCopies";
import { prefixedId } from "./trackedId";

/**
 * Pattern (Onshape's Linear/Circular pattern): the body's chain input repeated along a direction
 * or about an axis, fused into one body (the default) or kept as an unmerged compound.
 *
 * Structured like `mirror.ts` — the merge IS a tracked fuse, with the copies in the tool seats —
 * and the copies are what the mirror's copy is: the input itself transformed, so each copy's
 * sub-shapes correspond to the input's ONE TO ONE (`transformedMul` preserves the findSubShapes
 * enumeration; `mirrorFollow.kernel.test.ts` pins that kernel fact down) and are named from the
 * input's own ids under the feature's scope: copy `k` carries `pattern:<featureId>:<k>` on every
 * leaf (`prefixedId`). `k` is the copy's index in the FULL enumeration — a skipped copy's slot
 * never shifts the survivors' names (see `PatternFeatureData.skip` in feature.ts).
 *
 * The direction/axis is a live edge reference (the revolve `axisSource` contract): re-matched
 * against its source node's current shape on every rebuild, so editing or moving the picked edge
 * re-aims the copies (`resolvePatternLine`). A lost ref builds from the frozen fingerprint — a
 * line ref carries its endpoints — and says so through `ShapeTracking.unresolved` rather than
 * failing the feature.
 *
 * What is deliberately NOT named: on the untracked path (no kernel history) the copies' sub-shapes
 * get no ids at all rather than a positional guess — the argument `trackedIds` in feature.ts
 * gives. And the merge=false compound names its copies by the same rule as the mirror's half:
 * `combine` appends in argument order and TopExp explores a compound in insertion order, so the
 * ids concatenate without a mapping.
 */

const patternHandler: FeatureHandler<PatternFeatureData> = {
    display: (feature) =>
        feature.mode === "linear" ? "command.feature.patternLinear" : "command.feature.patternCircular",
    icon: (feature) => (feature.mode === "linear" ? "icon-array" : "icon-rotate"),
    reselectable: true,

    nodeIds: (feature) => [...new Set(lineSourcesOf(feature).map((x) => x.source.nodeId))],

    references: (feature) =>
        lineSourcesOf(feature).map((x) => ({ key: x.key, display: x.display, nodeId: x.source.nodeId })),

    parameters: (feature) => {
        const params: FeatureParameter[] = [
            { key: "count", display: "common.count", value: feature.count, unit: UNITLESS },
        ];
        if (feature.mode === "linear") {
            params.push({
                key: "spacing",
                display: "feature.pattern.spacing",
                value: feature.spacing,
                unit: LENGTH_UNITS,
            });
            // The direction-2 rows exist only where a second direction does — a grid the data
            // cannot describe has nothing to edit. Both carry their evaluation defaults, so the
            // rows always show resolvable values.
            if (feature.direction2 !== undefined) {
                params.push({
                    key: "count2",
                    display: "feature.pattern.count2",
                    value: feature.count2 ?? 2,
                    unit: UNITLESS,
                });
                params.push({
                    key: "spacing2",
                    display: "feature.pattern.spacing2",
                    value: feature.spacing2 ?? feature.spacing,
                    unit: LENGTH_UNITS,
                });
            }
        } else {
            params.push({
                key: "angle",
                display: "common.angle",
                value: feature.angle ?? 360,
                unit: ANGLE_UNITS,
            });
            params.push({
                key: "equalSpacing",
                display: "feature.pattern.equalSpacing",
                value: feature.equalSpacing ?? true,
            });
        }
        params.push({ key: "merge", display: "option.command.merge", value: feature.merge ?? true });
        params.push({ key: "skip", display: "feature.pattern.skip", value: (feature.skip ?? []).join(", ") });
        return params;
    },

    setParameter: (feature, key, value) => {
        switch (key) {
            case "merge":
            case "equalSpacing":
                return { ...feature, [key]: value === true || value === "true" };
            case "skip":
                return parseSkipParameter(feature, value);
            case "count":
            case "spacing":
            case "angle":
                return typeof value === "boolean" ? feature : { ...feature, [key]: value };
            case "count2":
            case "spacing2":
                if (feature.mode !== "linear" || feature.direction2 === undefined) return feature;
                return typeof value === "boolean" ? feature : { ...feature, [key]: value };
            default:
                return feature;
        }
    },

    applyResolvedRefs: (feature, { resolvedEdges }) => {
        if (resolvedEdges === undefined) return feature;
        if (feature.mode === "circular") {
            const axis = resolvedEdges[0];
            return axis === undefined ? feature : { ...feature, axis: { ...feature.axis, edge: axis } };
        }
        let next = feature;
        const direction = resolvedEdges[0];
        if (direction !== undefined) next = { ...next, direction: { ...next.direction, edge: direction } };
        const direction2 = resolvedEdges[1];
        if (direction2 !== undefined && next.direction2 !== undefined) {
            next = { ...next, direction2: { ...next.direction2, edge: direction2 } };
        }
        return next;
    },

    evaluate(feature, context): Result<IShape> {
        const input = context.input;
        if (input === undefined) return Result.err("Pattern requires a preceding feature");
        const plan = resolveInstances(feature, context);
        if (!plan.isOk) return Result.err(plan.error);
        const { instances, anchors, lostKey } = plan.value;

        const tracking = context.tracking;
        if (tracking !== undefined) {
            if (anchors.some((x) => x !== undefined)) tracking.resolvedEdges = anchors;
            if (lostKey !== undefined) tracking.unresolved = { key: lostKey, refIndexes: [0] };
        }

        // Every copy skipped: the input passes through unchanged, ids with it.
        if (instances.length === 0) {
            if (tracking !== undefined) {
                tracking.outputFaceIds = [...tracking.inputFaceIds];
                tracking.outputEdgeIds = [...tracking.inputEdgeIds];
            }
            return Result.ok(input);
        }

        const copies = instances.map(({ matrix }) => input.transformedMul(matrix));
        const flats = instances.map((x) => x.flat);
        if (feature.merge === false) return combineCopies(feature, context, input, copies, flats);
        try {
            return mergeCopies(feature, context, input, copies, flats);
        } finally {
            // The fuse copies the geometry it keeps — the transformed copies are intermediate
            // inputs, disposed once the operation returns (the boolean feature's own contract).
            copies.forEach((x) => x.dispose());
        }
    },
};

/** The line references a feature carries, with the slot key and row label of each. */
function lineSourcesOf(feature: PatternFeatureData): {
    key: string;
    display: "feature.pattern.direction" | "feature.pattern.direction2" | "feature.pattern.axis";
    source: PatternLineSource;
}[] {
    if (feature.mode === "circular") {
        return [{ key: "axis", display: "feature.pattern.axis", source: feature.axis }];
    }
    const sources: ReturnType<typeof lineSourcesOf> = [
        { key: "direction", display: "feature.pattern.direction", source: feature.direction },
    ];
    if (feature.direction2 !== undefined) {
        sources.push({
            key: "direction2",
            display: "feature.pattern.direction2",
            source: feature.direction2,
        });
    }
    return sources;
}

/**
 * The skip list as typed: "0, 3, 5" — comma-separated non-negative whole numbers naming flattened
 * copy indexes (see `PatternFeatureData.skip`). An empty field clears the list. A token that is
 * not a non-negative integer rejects the WHOLE edit — the feature keeps its previous list rather
 * than silently dropping a part of what was typed. Out-of-range indexes are stored but skip
 * nothing.
 */
function parseSkipParameter(
    feature: PatternFeatureData,
    value: ParameterValue | boolean,
): PatternFeatureData {
    if (typeof value === "boolean") return feature;
    const text = String(value).trim();
    if (text === "") return { ...feature, skip: undefined };
    const tokens = text.split(",").map((x) => x.trim());
    if (tokens.some((x) => !/^\d+$/.test(x))) return feature;
    return { ...feature, skip: [...new Set(tokens.map(Number))] };
}

/** One copy to build: its index in the full enumeration and its transform in the host's frame. */
interface PatternInstance {
    readonly flat: number;
    readonly matrix: Matrix4;
}

/** What one evaluation resolved: the kept copies, the refs' fresh anchors, and the first lost slot. */
interface PatternPlan {
    readonly instances: PatternInstance[];
    readonly anchors: (EdgeRef | undefined)[];
    readonly lostKey?: string;
}

function resolveInstances(feature: PatternFeatureData, context: FeatureContext): Result<PatternPlan> {
    const count = resolveCount(feature.count, context.scope);
    if (!count.isOk) return Result.err(count.error);
    const planned =
        feature.mode === "linear"
            ? planLinear(feature, count.value, context)
            : planCircular(feature, count.value, context);
    if (!planned.isOk) return Result.err(planned.error);
    const skipped = new Set(feature.skip ?? []);
    const { instances, anchors, lostKey } = planned.value;
    // Skip drops copies AFTER enumeration, so a copy's flat index never depends on the list.
    return Result.ok({ instances: instances.filter((x) => !skipped.has(x.flat)), anchors, lostKey });
}

/** A whole number of at least 2 — the original plus at least one copy. */
function resolveCount(count: ParameterValue, scope: Scope): Result<number> {
    const resolved = resolveUnitSpec(count, scope, UNITLESS);
    if (!resolved.isOk) return Result.err(resolved.error);
    if (!Number.isInteger(resolved.value)) return Result.err("Pattern count must be a whole number");
    if (resolved.value < 2) return Result.err("Pattern count must be at least 2");
    return Result.ok(resolved.value);
}

/** A non-zero spacing — zero would stack every copy on the original. */
function resolveSpacing(spacing: ParameterValue, scope: Scope): Result<number> {
    const resolved = resolveUnitSpec(spacing, scope, LENGTH_UNITS);
    if (!resolved.isOk) return Result.err(resolved.error);
    if (resolved.value === 0) return Result.err("Pattern spacing must be non-zero");
    return Result.ok(resolved.value);
}

function planLinear(
    feature: Extract<PatternFeatureData, { mode: "linear" }>,
    count: number,
    context: FeatureContext,
): Result<PatternPlan> {
    const first = resolvePatternLine(feature.direction, context, "Pattern direction");
    if (!first.isOk) return Result.err(first.error);
    if (first.value.line === undefined) return Result.err("Pattern direction edge not found");
    const spacing = resolveSpacing(feature.spacing, context.scope);
    if (!spacing.isOk) return Result.err(spacing.error);

    const anchors: (EdgeRef | undefined)[] = [first.value.anchor];
    let lostKey = first.value.lost ? "direction" : undefined;
    let step2: XYZ | undefined;
    let count2 = 1;
    if (feature.direction2 !== undefined) {
        const second = resolvePatternLine(feature.direction2, context, "Pattern direction 2");
        if (!second.isOk) return Result.err(second.error);
        if (second.value.line === undefined) return Result.err("Pattern direction 2 edge not found");
        anchors.push(second.value.anchor);
        lostKey ??= second.value.lost ? "direction2" : undefined;
        const count2Resolved = resolveCount(feature.count2 ?? 2, context.scope);
        if (!count2Resolved.isOk) return Result.err(count2Resolved.error);
        count2 = count2Resolved.value;
        const spacing2 = resolveSpacing(feature.spacing2 ?? feature.spacing, context.scope);
        if (!spacing2.isOk) return Result.err(spacing2.error);
        step2 = second.value.line.direction.multiply(spacing2.value);
    }

    const step1 = first.value.line.direction.multiply(spacing.value);
    // The flat index IS the placement's position in the enumeration — the original (0, 0)
    // holds no slot, so the first copy carries 0 (see `PatternFeatureData.skip`).
    const instances = linearPlacements(step1, count, step2, count2).map((matrix, flat) => ({ flat, matrix }));
    return Result.ok({ instances, anchors, lostKey });
}

/**
 * The linear placement math as a pure function, shared with the pattern command's drag
 * preview so what the canvas shows is what the rebuild builds: `step1` (direction × spacing)
 * and the optional `step2` are the per-slot offsets, and the enumeration runs direction 1
 * first, then direction 2 — a grid's first row, then the next — with the original (0, 0)
 * holding no copy slot.
 */
export function linearPlacements(step1: XYZ, count: number, step2?: XYZ, count2 = 1): Matrix4[] {
    const matrices: Matrix4[] = [];
    for (let j = 0; j < count2; j++) {
        for (let i = 0; i < count; i++) {
            if (i === 0 && j === 0) continue;
            const offset = step1.multiply(i).add(step2?.multiply(j) ?? XYZ.zero);
            matrices.push(Matrix4.fromTranslation(offset.x, offset.y, offset.z));
        }
    }
    return matrices;
}

/**
 * The circular placement math as a pure function — the linear one's sibling, shared with the
 * drag preview the same way. Equal spacing spreads the instances across `angle` (a full turn
 * keeps the last copy off the original); otherwise `angle` is the first-to-last span.
 */
export function circularPlacements(
    axisPoint: XYZ,
    axisDirection: XYZ,
    angle: number,
    count: number,
    equalSpacing: boolean,
): Matrix4[] {
    const step = equalSpacing ? angle / count : angle / (count - 1);
    const matrices: Matrix4[] = [];
    for (let k = 1; k < count; k++) {
        matrices.push(Matrix4.fromAxisRad(axisPoint, axisDirection, MathUtils.degToRad(step * k)));
    }
    return matrices;
}

function planCircular(
    feature: Extract<PatternFeatureData, { mode: "circular" }>,
    count: number,
    context: FeatureContext,
): Result<PatternPlan> {
    const axis = resolvePatternLine(feature.axis, context, "Pattern axis");
    if (!axis.isOk) return Result.err(axis.error);
    if (axis.value.line === undefined) return Result.err("Pattern axis edge not found");
    const angle = resolveUnitSpec(feature.angle ?? 360, context.scope, ANGLE_UNITS);
    if (!angle.isOk) return Result.err(angle.error);
    if (angle.value === 0) return Result.err("Pattern angle must be non-zero");

    // The flat index is the placement's position in the enumeration (copy k carries k−1).
    const instances = circularPlacements(
        axis.value.line.point,
        axis.value.line.direction,
        angle.value,
        count,
        feature.equalSpacing ?? true,
    ).map((matrix, flat) => ({ flat, matrix }));
    return Result.ok({
        instances,
        anchors: [axis.value.anchor],
        lostKey: axis.value.lost ? "axis" : undefined,
    });
}

/** A copy's sub-shape ids: the input's own, scoped under the feature and the copy's flat index. */
function patternIds(
    featureId: string,
    flat: number,
    ids: readonly (string | undefined)[],
): (string | undefined)[] {
    return ids.map((id) => (id === undefined ? undefined : prefixedId(`pattern:${featureId}:${flat}`, id)));
}

/**
 * The unmerged variant: input and copies side by side in one compound. `combine` appends in
 * argument order and a compound explores in insertion order, so the output enumeration is the
 * input's sub-shapes followed by each copy's in order — the ids concatenate in the same order,
 * no mapping needed. The compound owns its halves, so the copies are not disposed here (the
 * mirror's combine contract).
 */
function combineCopies(
    feature: PatternFeatureData,
    context: FeatureContext,
    input: IShape,
    copies: IShape[],
    flats: readonly number[],
): Result<IShape> {
    const combined = shapeFactory.combine([input, ...copies]);
    if (!combined.isOk) return Result.err(combined.error);
    const tracking = context.tracking;
    if (tracking !== undefined) {
        tracking.outputFaceIds = [
            ...tracking.inputFaceIds,
            ...flats.flatMap((flat) => patternIds(feature.id, flat, tracking.inputFaceIds)),
        ];
        tracking.outputEdgeIds = [
            ...tracking.inputEdgeIds,
            ...flats.flatMap((flat) => patternIds(feature.id, flat, tracking.inputEdgeIds)),
        ];
    }
    return Result.ok(combined.value);
}

/**
 * The merged variant: a pattern's copies are the input transformed, so their sub-shapes run
 * parallel to the input's and are named per INSTANCE (`patternIds`) — the one thing a pattern says
 * that a mirror does not. Everything else the merge does is shared (`mergeTrackedCopies`).
 */
function mergeCopies(
    feature: PatternFeatureData,
    context: FeatureContext,
    input: IShape,
    copies: IShape[],
    flats: readonly number[],
): Result<IShape> {
    const tracking = context.tracking;
    if (tracking === undefined) return shapeFactory.booleanFuse([input], copies, true);
    return mergeTrackedCopies(
        input,
        copies,
        flats.flatMap((flat) => patternIds(feature.id, flat, tracking.inputFaceIds)),
        flats.flatMap((flat) => patternIds(feature.id, flat, tracking.inputEdgeIds)),
        tracking,
    );
}

/** The resolution of one line reference: the line in the host's frame, plus the fresh anchor. */
interface ResolvedPatternLine {
    readonly line?: Line;
    readonly anchor?: EdgeRef;
    /** True when the line is the frozen fingerprint — the live ref could not be re-matched. */
    readonly lost: boolean;
}

/**
 * The direction/axis as a live reference, resolved like the revolve's axis (`resolveAxis`):
 *
 * - **Self-source** (`nodeId` is the host): the edge belongs to an earlier feature of the chain,
 *   so it is matched on this feature's INPUT — the committed shape is the pre-run result
 *   mid-rebuild. The match is already in the host's frame.
 * - **Foreign source**: matched on that node's current shape (id channel first, fingerprint
 *   fallback), mapped source → world → host. A rolled-back source shows a transient
 *   session-preview shape, so the match is refused and the frozen fingerprint stands in (the
 *   revolve contract) until the rebuild after the source restores.
 * - **Fallback**: the stored fingerprint IS a line snapshot (a line ref carries its endpoints),
 *   so a lost ref still builds — mapped by the node's transform while the node lives, used as-is
 *   once the node is gone (a best-effort frame: the node's world transform went with it) — and
 *   the loss is reported through `ShapeTracking.unresolved` rather than failing the feature.
 *
 * The mapping is source → world → host, which needs the host transform's inverse. A singular host
 * transform has none, and is reported the way `neutralPlaneInHost` reports the same case, rather
 * than quietly reading a source-frame direction as though it were already the host's.
 */
function resolvePatternLine(
    source: PatternLineSource,
    context: FeatureContext,
    label: string,
): Result<ResolvedPatternLine> {
    return source.nodeId === context.host.id
        ? Result.ok(lineFromInput(source.edge, context))
        : lineFromSourceNode(source, context, label);
}

/** Self-source: the direction edge belongs to an earlier feature, so match it on this feature's input. */
function lineFromInput(ref: EdgeRef, context: FeatureContext): ResolvedPatternLine {
    const input = context.input;
    if (input === undefined) return { line: frozenLine(ref), lost: true };
    const edges = input.findSubShapes(ShapeTypes.edge) as IEdge[];
    const tracked = context.tracking?.inputEdgeIds;
    const ids = tracked !== undefined && tracked.length === edges.length ? tracked : undefined;
    const matched = matchLineEdge(input, edges, ids, ref);
    // The input IS the host's frame — no mapping either way.
    if (matched === undefined) return { line: frozenLine(ref), lost: true };
    return { line: matched.line, anchor: matched.anchor, lost: false };
}

/** A direction/axis on another node: matched on that node's current shape, mapped into the host. */
function lineFromSourceNode(
    source: PatternLineSource,
    context: FeatureContext,
    label: string,
): Result<ResolvedPatternLine> {
    // Resolved up front so the frozen-fallback branches below can never stand a source-frame line
    // in for a host one when the body's transform is singular (see the contract above).
    const hostInverse = context.host.worldTransform().invert();
    if (hostInverse === undefined) return Result.err(`${label} cannot be mapped into the body`);
    const node = context.document.modelManager.findNode((n) => n.id === source.nodeId);
    if (!(node instanceof ShapeNode) || !node.shape.isOk) {
        // The node is gone, and its transform with it — the frozen fingerprint, taken as host-frame
        // geometry, is the best that is left (see the contract above).
        return Result.ok({ line: frozenLine(source.edge), lost: true });
    }
    const world = node.worldTransform();
    if (isBodyTimelineNode(node) && node.rollbackIndex !== undefined) {
        return Result.ok({ line: frozenLineInHost(source.edge, world, hostInverse), lost: true });
    }
    const shape = node.shape.value;
    const edges = shape.findSubShapes(ShapeTypes.edge) as IEdge[];
    // A tracked source resolves through the edge's stable id first; anything else matches the
    // fingerprint geometrically. A hole in the id array is normal — tracking lapses per
    // sub-shape — and costs nothing: such an edge simply never resolves in the id channel.
    const ids = isBodyTrackingNode(node) ? edges.map((_, index) => node.edgeIdAt(index)) : undefined;
    const matched = matchLineEdge(shape, edges, ids, source.edge);
    if (matched === undefined) {
        return Result.ok({ line: frozenLineInHost(source.edge, world, hostInverse), lost: true });
    }
    return Result.ok({
        line: intoHostFrame(matched.line, world, hostInverse),
        anchor: matched.anchor,
        lost: false,
    });
}

/**
 * Re-matches `ref` on `shape` (id channel first, geometric fallback) and returns the matched
 * edge's line in the shape's own frame — undefined when nothing matches or the match is not a
 * line. The start→end direction is the line's (the fingerprint's own orientation, so the frozen
 * fallback points the same way the live match did).
 */
function matchLineEdge(
    shape: IShape,
    edges: IEdge[],
    ids: readonly (string | undefined)[] | undefined,
    ref: EdgeRef,
): { line: Line; anchor: EdgeRef } | undefined {
    let index: number;
    let anchor: EdgeRef;
    if (ids !== undefined) {
        const anchored = matchEdgesAnchored(shape, [ref], ids);
        if (!anchored.isOk) return undefined;
        // One ref in, one slot out: a hole in `anchors` means the ref did not match at all.
        const matchedAnchor = anchored.value.anchors[0];
        if (matchedAnchor === undefined) return undefined;
        index = anchored.value.indexes[0];
        anchor = matchedAnchor;
    } else {
        const matched = matchEdgeIndexes(shape, [ref]);
        if (!matched.isOk) return undefined;
        index = matched.value[0];
        // The geometric path reports no anchors — re-capture from the matched edge (an untracked
        // source has no id to carry), the same re-anchoring contract the revolve keeps.
        anchor = captureEdgeRef(edges[index]);
    }
    const line = lineOfEdge(edges[index]);
    return line === undefined ? undefined : { line, anchor };
}

/** The edge's start→end line, or undefined for a degenerate or non-line edge. */
function lineOfEdge(edge: IEdge): Line | undefined {
    if (!CurveUtils.isLine(edge.curve.basisCurve)) return undefined;
    const direction = edge.endPoint().sub(edge.startPoint()).normalize();
    if (direction === undefined) return undefined;
    return new Line({ point: edge.startPoint(), direction });
}

/** A line's point and direction carried from a source frame into the host's: source → world → host. */
function intoHostFrame(line: Line, sourceWorld: Matrix4, hostInverse: Matrix4): Line {
    return new Line({
        point: hostInverse.ofPoint(sourceWorld.ofPoint(line.point)),
        direction: hostInverse.ofVector(sourceWorld.ofVector(line.direction)),
    });
}

/** The line a stored ref freezes (`start`→`end`); undefined when the ref is not a line. */
function frozenLine(ref: EdgeRef): Line | undefined {
    if (ref.kind !== "line") return undefined;
    const direction = new XYZ(ref.end).sub(new XYZ(ref.start)).normalize();
    return direction === undefined ? undefined : new Line({ point: new XYZ(ref.start), direction });
}

/** That frozen line carried from a living source's frame into the host's — the stand-in for a match. */
function frozenLineInHost(ref: EdgeRef, sourceWorld: Matrix4, hostInverse: Matrix4): Line | undefined {
    const line = frozenLine(ref);
    return line === undefined ? undefined : intoHostFrame(line, sourceWorld, hostInverse);
}

registerFeature("pattern", patternHandler);
