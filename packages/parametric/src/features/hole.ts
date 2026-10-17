// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    ANGLE_UNITS,
    type FeatureParameter,
    type I18nKeys,
    type IDocument,
    type IEdge,
    type IFace,
    type IShape,
    LENGTH_UNITS,
    Line,
    MathUtils,
    Matrix4,
    type ParameterValue,
    type Plane,
    Result,
    resolveUnitSpec,
    type Scope,
    ShapeNode,
    ShapeTypes,
    type TrackedShape,
    XYZ,
} from "@chili3d/core";
import { matchFace, type PlaneFaceRef, sketchPlaneOfFace, stablePlaneFrame } from "../sketch/planeRef";
import { toWorld } from "../sketch/sketchModel";
import { SketchNode } from "../sketch/sketchNode";
import { isBodyTimelineNode, isBodyTrackingNode } from "./bodyTracking";
import { trackedBoolean } from "./boolean";
import { findSketch } from "./extrude";
import { throughAllDepth } from "./extrudeEnd";
import {
    completeTrackedHistory,
    type FeatureContext,
    type FeatureHandler,
    type HoleFeatureData,
    type HoleStyle,
    registerFeature,
    type UnresolvedInputs,
} from "./feature";
import { parsePresetToken, presetTokens } from "./holeStandards";
import { trackOperation } from "./operation";
import { bornEdgeIdMap } from "./operationIds";
import { indexesOfOverlappingId, writeUncontestedIds } from "./trackedId";

/**
 * Hole: drilled holes at points picked on a planar face, cut out of the chain input.
 *
 * Geometry is built per hole as a section profile in the plane through the hole axis — the
 * drill's wall, its tip cone, and the counterbore step or countersink cone the style asks for —
 * revolved 360° about the axis into the hole solid, and all holes are cut in ONE tracked boolean
 * so the body's tracked ids survive (the `applyTrackedOperation` contract, multi-tool).
 *
 * The hole solids carry no kernel derivation worth keeping, so their sub-shapes are seeded by
 * CONTENT like a primitive's (`hole:<featureId>:<slot>:wall|point|cboreWall|cboreFloor|csk`):
 * each revolve face is named by the profile segment that swept it (the tracked revolve's
 * faceEdgeMap names the segment by index), each edge by the two faces it borders
 * (`bornEdgeIdMap`), which leaves the wall's seam and the tip's degenerate apex edge unnamed
 * on purpose. The slot is the center's position in the union of raw picks and bound sketch
 * points (see `HoleCenter`), stable across edits; the names read the construction, not the
 * measurements, so a diameter or depth edit keeps every id.
 *
 * The section starts HOLE_START_MARGIN ABOVE the plane: a cap face landing exactly on the surface
 * it opens at is the tangential-boolean case, so the tool pokes out of the part instead. The
 * recess depths are measured from the plane itself — the margin never shifts them.
 *
 * Depth conventions and the data contract are documented on `HoleFeatureData`. Threads are
 * deliberately not modelled: a tapped hole is a cosmetic-thread annotation, a later batch's
 * concern, not a solid this feature cuts.
 */

/** The general-purpose drill point, degrees of included angle. */
const DEFAULT_DRILL_ANGLE = 118;

/** The default countersink cone, degrees of included angle (the metric flat-head standard). */
const DEFAULT_COUNTERSINK_ANGLE = 90;

/** How far above the plane the hole solid starts — see the module doc. */
const HOLE_START_MARGIN = 1e-3;

const HOLE_STYLES: readonly HoleStyle[] = ["simple", "counterbore", "countersink"];

const STYLE_DISPLAY: Record<HoleStyle, I18nKeys> = {
    simple: "feature.hole.style.simple",
    counterbore: "feature.hole.style.counterbore",
    countersink: "feature.hole.style.countersink",
};

/** The recess rows' fallback values when the field was never typed (the primitive sizes' pattern). */
const COUNTERBORE_DEFAULTS = { diameter: 10, depth: 3 } as const;
const COUNTERSINK_DEFAULTS = { diameter: 10, angle: DEFAULT_COUNTERSINK_ANGLE } as const;

/** `visibleWhen` gates for the recess rows — one per style the row serves. */
const COUNTERBORE = [{ key: "style", value: "counterbore" }] as const;
const COUNTERSINK = [{ key: "style", value: "countersink" }] as const;

const holeHandler: FeatureHandler<HoleFeatureData> = {
    display: "command.feature.hole",
    icon: "icon-hole",
    reselectable: true,

    nodeIds: (feature) => [
        feature.face.nodeId,
        // The bound sketch is what makes "move the point, the hole follows" rebuild the body.
        ...(feature.sketchPoints === undefined ? [] : [feature.sketchPoints.sketchId]),
    ],

    references: (feature) => [
        { key: "face", display: "feature.hole.face", nodeId: feature.face.nodeId },
        ...(feature.sketchPoints === undefined
            ? []
            : [
                  {
                      key: "sketchPoints",
                      display: "body.sketch" as const,
                      nodeId: feature.sketchPoints.sketchId,
                  },
              ]),
    ],

    parameters: (feature) => [
        {
            key: "style",
            display: "common.type",
            value: feature.style,
            choices: HOLE_STYLES.map((value) => ({ value, display: STYLE_DISPLAY[value] })),
        },
        // The preset row never holds a value: picking one writes its numbers into the fields
        // below and the row resets to blank (see `holeStandards.ts`).
        {
            key: "preset",
            display: "feature.hole.preset",
            value: "",
            choices: presetTokens(feature.style).map((token) => ({ value: token })),
        },
        { key: "diameter", display: "dimension.diameter", value: feature.diameter, unit: LENGTH_UNITS },
        // An empty depth drills through all — the feature carries no `depth` then at all.
        { key: "depth", display: "feature.hole.depth", value: feature.depth ?? "", unit: LENGTH_UNITS },
        {
            key: "drillAngle",
            display: "feature.hole.drillAngle",
            value: feature.drillAngle ?? DEFAULT_DRILL_ANGLE,
            unit: ANGLE_UNITS,
        },
        {
            key: "counterbore.diameter",
            display: "feature.hole.counterboreDiameter",
            value: feature.counterbore?.diameter ?? COUNTERBORE_DEFAULTS.diameter,
            unit: LENGTH_UNITS,
            visibleWhen: COUNTERBORE,
        },
        {
            key: "counterbore.depth",
            display: "feature.hole.counterboreDepth",
            value: feature.counterbore?.depth ?? COUNTERBORE_DEFAULTS.depth,
            unit: LENGTH_UNITS,
            visibleWhen: COUNTERBORE,
        },
        {
            key: "countersink.diameter",
            display: "feature.hole.countersinkDiameter",
            value: feature.countersink?.diameter ?? COUNTERSINK_DEFAULTS.diameter,
            unit: LENGTH_UNITS,
            visibleWhen: COUNTERSINK,
        },
        {
            key: "countersink.angle",
            display: "feature.hole.countersinkAngle",
            value: feature.countersink?.angle ?? COUNTERSINK_DEFAULTS.angle,
            unit: ANGLE_UNITS,
            visibleWhen: COUNTERSINK,
        },
    ],

    setParameter: (feature, key, value) => {
        if (key === "style") {
            return HOLE_STYLES.includes(value as HoleStyle)
                ? { ...feature, style: value as HoleStyle }
                : feature;
        }
        if (key === "preset") return typeof value === "string" ? applyPreset(feature, value) : feature;
        if (typeof value === "boolean") return feature;
        if (key === "diameter") return { ...feature, diameter: value };
        if (key === "drillAngle") return { ...feature, drillAngle: value };
        if (key === "depth") {
            // A blank depth field is the through-all choice — the feature stores no depth then.
            const { depth: _, ...rest } = feature;
            return value === "" ? rest : { ...rest, depth: value };
        }
        if (key.startsWith("counterbore.")) return setRecess(feature, "counterbore", key.slice(12), value);
        if (key.startsWith("countersink.")) return setRecess(feature, "countersink", key.slice(12), value);
        return feature;
    },

    evaluate(feature, context): Result<IShape> {
        // The dropdown keeps the panel from writing a bad token; this keeps a hand-edited file
        // from reaching geometry that would read it wrong (the shell's join-type guard's twin).
        if (!HOLE_STYLES.includes(feature.style)) return Result.err(`Invalid hole style: ${feature.style}`);
        const input = context.input;
        if (input === undefined) return Result.err("Hole requires a preceding feature");
        const bound = feature.sketchPoints?.entityIds.length ?? 0;
        if (feature.points.length + bound === 0) return Result.err("Hole requires at least one point");

        const params = resolveHoleParams(feature, context.scope);
        if (!params.isOk) return Result.err(params.error);
        const plane = resolveHolePlane(feature.face, context);
        if (!plane.isOk) return Result.err(plane.error);
        if (plane.value.lost !== undefined && context.tracking !== undefined) {
            context.tracking.unresolved = plane.value.lost;
        }

        const { centers, lost } = resolveHoleCenters(feature, plane.value.plane, context);
        if (lost.length > 0 && context.tracking !== undefined && context.tracking.unresolved === undefined) {
            context.tracking.unresolved = { key: "sketchPoints", refIndexes: lost };
        }
        // Every center a lost bound one: the holes suspend (input passes through) rather than
        // fail — the row's missing-input slots keep the picks open for a re-pick.
        if (centers.length === 0) {
            if (context.tracking !== undefined) {
                context.tracking.outputFaceIds = [...context.tracking.inputFaceIds];
                context.tracking.outputEdgeIds = [...context.tracking.inputEdgeIds];
            }
            return Result.ok(input);
        }

        const tools = buildHoleTools(feature, params.value, plane.value.plane, input, centers);
        if (!tools.isOk) return Result.err(tools.error);
        return cutHoles(input, tools.value, context);
    },
};

/** Writes a picked preset's NUMBERS into the feature — the token itself is never stored. */
function applyPreset(feature: HoleFeatureData, token: string): HoleFeatureData {
    const parsed = parsePresetToken(token);
    if (parsed === undefined) return feature;
    const { row, clearance } = parsed;
    switch (feature.style) {
        case "simple":
            return { ...feature, diameter: row.clearance[clearance] };
        case "counterbore":
            return {
                ...feature,
                diameter: row.clearance.normal,
                counterbore: { diameter: row.counterbore.diameter, depth: row.counterbore.depth },
            };
        default:
            return row.countersink === undefined
                ? feature
                : {
                      ...feature,
                      diameter: row.clearance.normal,
                      countersink: { diameter: row.countersink.diameter, angle: row.countersink.angle },
                  };
    }
}

/** Writes one recess field, keeping its sibling — the primitive `origin.x` pattern. */
function setRecess(
    feature: HoleFeatureData,
    kind: "counterbore" | "countersink",
    field: string,
    value: ParameterValue | boolean,
): HoleFeatureData {
    if (typeof value === "boolean") return feature;
    if (kind === "counterbore") {
        if (field !== "diameter" && field !== "depth") return feature;
        return {
            ...feature,
            counterbore: {
                diameter: feature.counterbore?.diameter ?? COUNTERBORE_DEFAULTS.diameter,
                depth: feature.counterbore?.depth ?? COUNTERBORE_DEFAULTS.depth,
                [field]: value,
            },
        };
    }
    if (field !== "diameter" && field !== "angle") return feature;
    return {
        ...feature,
        countersink: {
            diameter: feature.countersink?.diameter ?? COUNTERSINK_DEFAULTS.diameter,
            angle: feature.countersink?.angle ?? COUNTERSINK_DEFAULTS.angle,
            [field]: value,
        },
    };
}

/** Everything an evaluation needs, resolved against the document scope (host-local millimetres). */
interface HoleParams {
    readonly radius: number;
    /** Blind depth to the drill point; undefined drills through all. */
    readonly depth?: number;
    /** Tip cone height `r / tan(φ/2)` — zero-ish for a near-flat point. */
    readonly tipHeight: number;
    readonly counterbore?: { readonly radius: number; readonly depth: number };
    readonly countersink?: { readonly radius: number; readonly height: number };
}

function resolveHoleParams(feature: HoleFeatureData, scope: Scope): Result<HoleParams> {
    const diameter = resolveUnitSpec(feature.diameter, scope, LENGTH_UNITS);
    if (!diameter.isOk) return Result.err(diameter.error);
    if (!(diameter.value > 0)) return Result.err("Hole diameter must be positive");
    const angle = resolveUnitSpec(feature.drillAngle ?? DEFAULT_DRILL_ANGLE, scope, ANGLE_UNITS);
    if (!angle.isOk) return Result.err(angle.error);
    if (!(angle.value > 0 && angle.value < 180)) {
        return Result.err("Hole drill angle must be between 0 and 180 degrees");
    }
    const radius = diameter.value / 2;
    const tipHeight = radius / Math.tan(MathUtils.degToRad(angle.value / 2));

    let depth: number | undefined;
    // A blank depth is through-all; it is stripped at write time, but a hand-edited file may carry one.
    if (feature.depth !== undefined && feature.depth !== "") {
        const resolved = resolveUnitSpec(feature.depth, scope, LENGTH_UNITS);
        if (!resolved.isOk) return Result.err(resolved.error);
        if (!(resolved.value > 0)) return Result.err("Hole depth must be positive");
        if (resolved.value <= tipHeight) return Result.err("Hole depth must exceed the drill tip height");
        depth = resolved.value;
    }

    const counterbore = resolveCounterbore(feature, scope, diameter.value);
    if (!counterbore.isOk) return Result.err(counterbore.error);
    const countersink = resolveCountersink(feature, scope, diameter.value, radius);
    if (!countersink.isOk) return Result.err(countersink.error);
    return Result.ok({
        radius,
        depth,
        tipHeight,
        counterbore: counterbore.value,
        countersink: countersink.value,
    });
}

/** The counterbore the style needs, or none — a leftover one from before a style switch is ignored. */
function resolveCounterbore(
    feature: HoleFeatureData,
    scope: Scope,
    diameter: number,
): Result<HoleParams["counterbore"]> {
    if (feature.style !== "counterbore") return Result.ok(undefined);
    if (feature.counterbore === undefined) {
        return Result.err("Counterbore hole requires its counterbore dimensions");
    }
    const cd = resolveUnitSpec(feature.counterbore.diameter, scope, LENGTH_UNITS);
    if (!cd.isOk) return Result.err(cd.error);
    if (!(cd.value > diameter)) return Result.err("Counterbore diameter must exceed the hole diameter");
    const depth = resolveUnitSpec(feature.counterbore.depth, scope, LENGTH_UNITS);
    if (!depth.isOk) return Result.err(depth.error);
    if (!(depth.value > 0)) return Result.err("Counterbore depth must be positive");
    return Result.ok({ radius: cd.value / 2, depth: depth.value });
}

/** The countersink the style needs; its cone height is derived, never stored. */
function resolveCountersink(
    feature: HoleFeatureData,
    scope: Scope,
    diameter: number,
    radius: number,
): Result<HoleParams["countersink"]> {
    if (feature.style !== "countersink") return Result.ok(undefined);
    if (feature.countersink === undefined) {
        return Result.err("Countersink hole requires its countersink dimensions");
    }
    const cd = resolveUnitSpec(feature.countersink.diameter, scope, LENGTH_UNITS);
    if (!cd.isOk) return Result.err(cd.error);
    if (!(cd.value > diameter)) return Result.err("Countersink diameter must exceed the hole diameter");
    const angle = resolveUnitSpec(feature.countersink.angle ?? DEFAULT_COUNTERSINK_ANGLE, scope, ANGLE_UNITS);
    if (!angle.isOk) return Result.err(angle.error);
    if (!(angle.value > 0 && angle.value < 180)) {
        return Result.err("Countersink angle must be between 0 and 180 degrees");
    }
    const height = (cd.value / 2 - radius) / Math.tan(MathUtils.degToRad(angle.value / 2));
    return Result.ok({ radius: cd.value / 2, height });
}

/** The plane the holes start from, in the host's frame, plus the lost-pick report when frozen. */
interface ResolvedHolePlane {
    readonly plane: Plane;
    /**
     * The face the plane was matched on, as a HOST-LOCAL copy — set on a live match only (the
     * frozen fallback has no face). A thunk, not the face itself: the evaluate hot path never
     * reads it, so the OCCT copy is paid only when the reselect session — the sole consumer —
     * asks. The caller owns each returned copy and disposes it.
     */
    readonly face?: () => IFace;
    readonly lost?: UnresolvedInputs;
}

/**
 * Resolves the face ref to its plane in the host body's local frame — the neutral-plane system's
 * self/foreign split (the host's own face is matched on the chain INPUT, never on the final
 * shape, which is the previous rebuild's) — but framed by `sketchPlaneOfFace` on the SOURCE-LOCAL
 * face: the UV frame the centers are stored in must not drift when the body is merely moved, and
 * a world-origin-projected frame would.
 *
 * A face that no longer matches builds from the frozen fingerprint (normal + offset are a world
 * capture) and reports through `unresolved` — the extrude end-condition's own convention.
 */
export function resolveHolePlane(ref: PlaneFaceRef, context: FeatureContext): Result<ResolvedHolePlane> {
    const hostInverse = context.host.worldTransform().invert();
    if (hostInverse === undefined) return Result.err("Hole cannot place the plane in the body");
    const source = holeFaceSource(ref.nodeId, context);
    if (!source.isOk) return Result.err(source.error);
    const { faces, transform } = source.value;
    const ids = source.value.faceIds;
    const face = matchFace(
        faces,
        transform,
        ref,
        ids === undefined
            ? undefined
            : (id) => {
                  const index = ids.indexOf(id);
                  return index < 0 ? undefined : index;
              },
        ids === undefined ? undefined : (id) => indexesOfOverlappingId(ids, id),
    );
    // Source-local → host-local: the host's own face is already matched in host space (the map
    // is identity there); a foreign node's face is carried over rigidly. The plane is mapped
    // outright; the face hands out a mapped copy per call (see `ResolvedHolePlane.face`).
    const map = hostInverse.multiply(transform);
    if (face !== undefined) {
        return Result.ok({
            plane: sketchPlaneOfFace(face).transformed(map),
            face: () => face.transformed(map) as IFace,
        });
    }

    const normal = new XYZ(ref.normal).normalize();
    const sourceInverse = transform.invert();
    if (normal === undefined || sourceInverse === undefined) {
        return Result.err("Hole plane not found after rebuild");
    }
    // The frozen frame follows the same source-local rule the live match does, so a re-pick and
    // a thaw land in the same frame.
    const frozen = stablePlaneFrame(
        sourceInverse.ofPoint(normal.multiply(ref.offset)),
        sourceInverse.ofVector(normal),
    );
    return Result.ok({ plane: frozen.transformed(map), lost: { key: "face", refIndexes: [0] } });
}

/** The face set a hole's plane ref is matched against — `neutralPlane.ts`'s own split. */
interface HoleFaceSource {
    readonly faces: IFace[];
    readonly faceIds: readonly (string | undefined)[] | undefined;
    /** Source-local → world. */
    readonly transform: Matrix4;
}

function holeFaceSource(nodeId: string, context: FeatureContext): Result<HoleFaceSource> {
    if (nodeId === context.host.id) {
        const input = context.input;
        if (input === undefined) return Result.err("Hole requires a preceding feature");
        const faces = input.findSubShapes(ShapeTypes.face) as IFace[];
        const ids = context.tracking?.inputFaceIds;
        return Result.ok({
            faces,
            faceIds: ids !== undefined && ids.length === faces.length ? ids : undefined,
            transform: context.host.worldTransform(),
        });
    }
    const node = context.document.modelManager.findNode((n) => n.id === nodeId);
    if (!(node instanceof ShapeNode) || !node.shape.isOk) return Result.err("Hole plane body not found");
    // A rolled-back node's shape is the session's preview, not its real state — refuse it.
    if (isBodyTimelineNode(node) && node.rollbackIndex !== undefined) {
        return Result.err("Hole plane body is rolled back");
    }
    const faces = node.shape.value.findSubShapes(ShapeTypes.face) as IFace[];
    const tracked = isBodyTrackingNode(node) ? node : undefined;
    return Result.ok({
        faces,
        faceIds: tracked === undefined ? undefined : faces.map((_, index) => tracked.faceIdAt(index)),
        transform: node.worldTransform(),
    });
}

/** The hole center a stored (u, v) names, in the plane's own frame. */
export function holeCenter(plane: Plane, [u, v]: readonly [number, number]): XYZ {
    return plane.origin.add(plane.xvec.multiply(u)).add(plane.yvec.multiply(v));
}

/** A point's (u, v) in the plane's frame — the inverse of `holeCenter`, projection included. */
export function holePointUV(plane: Plane, point: XYZ): [number, number] {
    const vec = plane.project(point).sub(plane.origin);
    return [vec.dot(plane.xvec), vec.dot(plane.yvec)];
}

/**
 * One center to drill, with the slot its sub-shape ids are seeded from. Raw picks keep their
 * `points` index; bound ones take `points.length +` their entity-list index — so a LOST bound
 * point leaves an empty slot and the survivors' `hole:<featureId>:<slot>:…` ids never shift.
 */
export interface HoleCenter {
    readonly uv: readonly [number, number];
    readonly slot: number;
}

/**
 * The full center set of a hole feature: the raw (u, v) picks, then the bound sketch points
 * resolved against the CURRENT sketch — the entity's world position carried into the host's
 * frame and projected onto the hole plane along its normal (`holePointUV` projects), so the
 * sketch need not lie on the hole face. `lost` collects the entity-list positions that no
 * longer resolve: the sketch gone (every one of its points), or the entity deleted or no
 * longer a point.
 */
export function resolveHoleCenters(
    feature: HoleFeatureData,
    plane: Plane,
    context: FeatureContext,
): { centers: HoleCenter[]; lost: number[] } {
    const centers: HoleCenter[] = feature.points.map((uv, slot) => ({ uv, slot }));
    const lost: number[] = [];
    const binding = feature.sketchPoints;
    if (binding === undefined) return { centers, lost };

    const sketch = findSketch(context.document, binding.sketchId);
    const hostInverse = context.host.worldTransform().invert();
    binding.entityIds.forEach((entityId, index) => {
        const entity = sketch?.data.entities.find((x) => x.id === entityId);
        if (sketch === undefined || hostInverse === undefined || entity?.type !== "point") {
            lost.push(index);
            return;
        }
        const world = sketch
            .worldTransform()
            .ofPoint(toWorld(sketch.plane, entity.params[0], entity.params[1]));
        centers.push({
            uv: holePointUV(plane, hostInverse.ofPoint(world)),
            slot: feature.points.length + index,
        });
    });
    return { centers, lost };
}

/** A sketch point entity a hole-center pick snapped to. */
export interface SketchPointSnap {
    readonly sketchId: string;
    readonly entityId: number;
    /** The entity's world position projected onto the pick plane — where the hole lands. */
    readonly center: XYZ;
}

/**
 * The nearest visible sketch's standalone point whose projection onto `frame` lies within
 * `tolerance` of `point` (world coordinates throughout). A sketch point is NOT a sub-shape —
 * it never enters the sketch's geometry — so the pick pipeline cannot hit it; comparing the
 * pick's landing spot against the points' projections is the snap (the SolidWorks/Onshape
 * hole-center behaviour). Construction points are skipped: they draw no cross outside the
 * editor, and a snap must land on something visible. `pinnedSketchId` restricts the scan to
 * the sketch already bound — a pick near ANOTHER sketch's point then degrades to a plain
 * (u, v) center, the one-sketch rule of `HoleSketchPoints`.
 */
export function findSketchPointAt(
    document: IDocument,
    frame: Plane,
    point: XYZ,
    tolerance: number,
    pinnedSketchId?: string,
): SketchPointSnap | undefined {
    let best: SketchPointSnap | undefined;
    let bestDistance = tolerance;
    const sketches = document.modelManager.findNodes((n) => n instanceof SketchNode) as SketchNode[];
    for (const sketch of sketches) {
        if (!sketch.visible || !sketch.parentVisible) continue;
        if (pinnedSketchId !== undefined && sketch.id !== pinnedSketchId) continue;
        const transform = sketch.worldTransform();
        for (const entity of sketch.data.entities) {
            if (entity.type !== "point" || entity.construction === true) continue;
            const world = transform.ofPoint(toWorld(sketch.plane, entity.params[0], entity.params[1]));
            const projected = frame.project(world);
            const distance = projected.distanceTo(point);
            if (distance <= bestDistance) {
                bestDistance = distance;
                best = { sketchId: sketch.id, entityId: entity.id, center: projected };
            }
        }
    }
    return best;
}

/** One hole solid with its content-seeded sub-shape ids. */
interface BuiltHoleTool {
    readonly shape: IShape;
    readonly faceIds: (string | undefined)[];
    readonly edgeIds: (string | undefined)[];
}

function buildHoleTools(
    feature: HoleFeatureData,
    params: HoleParams,
    plane: Plane,
    input: IShape,
    centers: readonly HoleCenter[],
): Result<BuiltHoleTool[]> {
    const tools: BuiltHoleTool[] = [];
    const dir = plane.normal.multiply(-1);
    for (const center of centers) {
        const tool = buildHoleTool(
            feature,
            params,
            holeCenter(plane, center.uv),
            dir,
            plane.xvec,
            input,
            center.slot,
        );
        if (!tool.isOk) {
            tools.forEach((x) => x.shape.dispose());
            return Result.err(tool.error);
        }
        tools.push(tool.value);
    }
    return Result.ok(tools);
}

function buildHoleTool(
    feature: HoleFeatureData,
    params: HoleParams,
    center: XYZ,
    dir: XYZ,
    radial: XYZ,
    input: IShape,
    slot: number,
): Result<BuiltHoleTool> {
    // Through-all reaches past the input's far side by the tip height as well, so the
    // full-diameter part exits cleanly — the tip pokes out like a real drill's.
    let depth = params.depth;
    if (depth === undefined) {
        const through = throughAllDepth(input, Matrix4.identity(), center, dir, 0, "Hole");
        if (!through.isOk) return Result.err(through.error);
        depth = through.value + params.tipHeight;
    }
    const wallRun = depth - params.tipHeight;
    if (params.counterbore !== undefined && params.counterbore.depth >= wallRun) {
        return Result.err("Counterbore depth must leave room for the hole");
    }
    if (params.countersink !== undefined && params.countersink.height >= wallRun) {
        return Result.err("Countersink must leave room for the hole");
    }
    const profile = revolveHoleProfile(params, wallRun, depth, center, dir, radial);
    if (!profile.isOk) return Result.err(profile.error);
    return Result.ok({
        shape: profile.value.shape,
        ...seedToolIds(feature.id, slot, profile.value, center, dir),
    });
}

/** One profile segment's 3D endpoints and the face tag its revolve earns (undefined: unnamed). */
interface HoleSegment {
    readonly from: XYZ;
    readonly to: XYZ;
    readonly tag?: string;
}

interface RevolvedHoleProfile {
    readonly shape: IShape;
    readonly tracked?: TrackedShape;
    /**
     * Each enumerated profile edge's segment tag (undefined: unnamed), matched by midpoint.
     * Read out BEFORE the profile intermediates are disposed — the revolve has consumed them.
     */
    readonly edgeTags: readonly (string | undefined)[];
    /**
     * The tagged HORIZONTAL segments as (ζ, tag) — ζ their distance into the material. The
     * kernel's revolve history reports no edge for the faces these sweep (a segment square to
     * the axis comes back -1 in `faceEdgeMap`), so those faces are matched by height instead
     * (see `seedToolIds`). The opening rim's segment is untagged and absent here by design.
     */
    readonly axialFaces: readonly { readonly zeta: number; readonly tag: string }[];
}

/**
 * The section profile of one hole, revolved a full turn about its axis. The (ρ, ζ) section —
 * ζ measuring INTO the material — reads top-down by style: opening rim, counterbore step or
 * countersink cone, the drill wall, the tip cone; the closing segment runs back along the axis
 * and sweeps nothing. Both ends start/finish ON the axis, so the profile never crosses it.
 */
function revolveHoleProfile(
    params: HoleParams,
    wallRun: number,
    depth: number,
    center: XYZ,
    dir: XYZ,
    radial: XYZ,
): Result<RevolvedHoleProfile> {
    const segments = holeSegments(params, wallRun, depth, center, dir, radial);
    const owned: { dispose(): void }[] = [];
    try {
        const edges: IEdge[] = [];
        for (const segment of segments) {
            const edge = shapeFactory.line(segment.from, segment.to);
            if (!edge.isOk) return Result.err(edge.error);
            edges.push(edge.value);
        }
        owned.push(...edges);
        const wire = shapeFactory.wire(edges);
        if (!wire.isOk) return Result.err(wire.error);
        owned.push(wire.value);
        const profile = shapeFactory.face([wire.value]);
        if (!profile.isOk) return Result.err(profile.error);
        owned.push(profile.value);
        const profileEdges = profile.value.findSubShapes(ShapeTypes.edge) as IEdge[];
        const edgeTags = tagProfileEdges(profileEdges, segments);
        const axialFaces = segments.flatMap((segment) => {
            if (segment.tag === undefined) return [];
            const zeta = segment.from.sub(center).dot(dir);
            return Math.abs(segment.to.sub(center).dot(dir) - zeta) < 1e-9
                ? [{ zeta, tag: segment.tag }]
                : [];
        });
        const axis = new Line({ point: center, direction: dir });
        const tracked = shapeFactory.revolveTracked?.(profile.value, axis, 360);
        if (tracked !== undefined) {
            if (!tracked.isOk) return Result.err(tracked.error);
            return Result.ok({ shape: tracked.value.shape, tracked: tracked.value, edgeTags, axialFaces });
        }
        const revolved = shapeFactory.revolve(profile.value, axis, 360);
        if (!revolved.isOk) return Result.err(revolved.error);
        return Result.ok({ shape: revolved.value, edgeTags, axialFaces });
    } finally {
        // The revolve has read the profile eagerly; the intermediates are this call's own.
        owned.forEach((x) => x.dispose());
    }
}

/**
 * The section's segments in order, closing along the axis. Recess depths measure from the plane
 * (ζ = 0); the opening rim sits HOLE_START_MARGIN above it (see the module doc), which the stub
 * above a countersink cone follows — it never touches the part, so it earns no tag.
 */
function holeSegments(
    params: HoleParams,
    wallRun: number,
    depth: number,
    center: XYZ,
    dir: XYZ,
    radial: XYZ,
): HoleSegment[] {
    const point = (rho: number, zeta: number) => center.add(radial.multiply(rho)).add(dir.multiply(zeta));
    const { radius: r } = params;
    const polyline: [number, number][] = [[0, -HOLE_START_MARGIN]];
    const tags: (string | undefined)[] = [];
    if (params.counterbore !== undefined) {
        polyline.push(
            [params.counterbore.radius, -HOLE_START_MARGIN],
            [params.counterbore.radius, params.counterbore.depth],
        );
        tags.push(undefined, "cboreWall");
        polyline.push([r, params.counterbore.depth]);
        tags.push("cboreFloor");
    } else if (params.countersink !== undefined) {
        polyline.push(
            [params.countersink.radius, -HOLE_START_MARGIN],
            [params.countersink.radius, 0],
            [r, params.countersink.height],
        );
        tags.push(undefined, undefined, "csk");
    } else {
        polyline.push([r, -HOLE_START_MARGIN]);
        tags.push(undefined);
    }
    polyline.push([r, wallRun], [0, depth]);
    tags.push("wall", "point");
    const points = polyline.map(([rho, zeta]) => point(rho, zeta));
    const segments = points
        .slice(0, -1)
        .map((from, index) => ({ from, to: points[index + 1], tag: tags[index] }));
    // Back to the start along the axis — the closing segment, which sweeps no face.
    segments.push({ from: points[points.length - 1], to: points[0], tag: undefined });
    return segments;
}

/**
 * Names the hole solid's sub-shapes by content (see the module doc). Faces take the tag of the
 * profile segment that swept them — the tracked revolve's faceEdgeMap names the segment by its
 * index in the profile's own edge enumeration, and `edgeTags` (matched segment-side before the
 * profile intermediates were disposed) carries each enumerated edge's tag. The faces a segment
 * SQUARE TO THE AXIS sweeps come back -1 there (measured: the kernel reports no generating edge
 * for them), so the counterbore floor is matched by its height instead — `axialFaces`, one ζ per
 * tagged horizontal segment, each a distinct height by construction. Edges take
 * `bornEdgeIdMap`: every edge of the solid is born here, so the two faces it borders name it
 * — which leaves the wall's seam and the tip's degenerate apex edge unnamed on purpose. Without
 * kernel history (no `revolveTracked`) nothing is named rather than guessed by position.
 */
function seedToolIds(
    featureId: string,
    slot: number,
    profile: RevolvedHoleProfile,
    center: XYZ,
    dir: XYZ,
): { faceIds: (string | undefined)[]; edgeIds: (string | undefined)[] } {
    const faces = profile.shape.findSubShapes(ShapeTypes.face) as IFace[];
    const edges = profile.shape.findSubShapes(ShapeTypes.edge) as IEdge[];
    const faceIds: (string | undefined)[] = new Array(faces.length).fill(undefined);
    const edgeIds: (string | undefined)[] = new Array(edges.length).fill(undefined);
    if (profile.tracked === undefined) return { faceIds, edgeIds };

    const candidates = new Map<number, string>();
    profile.tracked.faceEdgeMap?.forEach((edgeIndex, faceIndex) => {
        const tag = profile.edgeTags[edgeIndex];
        if (tag !== undefined && faceIndex >= 0 && faceIndex < faces.length) {
            candidates.set(faceIndex, `hole:${featureId}:${slot}:${tag}`);
        }
    });
    faces.forEach((face, faceIndex) => {
        if (candidates.has(faceIndex) || profile.axialFaces.length === 0) return;
        const [point, normal] = face.normal(0, 0);
        if (Math.abs(normal.dot(dir)) < 1 - 1e-6) return; // not square to the axis
        const zeta = point.sub(center).dot(dir);
        const match = profile.axialFaces.find((x) => Math.abs(x.zeta - zeta) < 1e-6);
        if (match !== undefined) candidates.set(faceIndex, `hole:${featureId}:${slot}:${match.tag}`);
    });
    writeUncontestedIds(faceIds, candidates);
    for (const [edgeIndex, id] of bornEdgeIdMap(profile.shape, edges, faces, faceIds, () => true)) {
        edgeIds[edgeIndex] = id;
    }
    return { faceIds, edgeIds };
}

/** Each enumerated profile edge's segment tag, matched by midpoint; misses stay undefined. */
function tagProfileEdges(edges: readonly IEdge[], segments: readonly HoleSegment[]): (string | undefined)[] {
    return edges.map((edge) => {
        const mid = edge.startPoint().add(edge.endPoint()).multiply(0.5);
        return segments.find((segment) => {
            const segMid = segment.from.add(segment.to).multiply(0.5);
            return mid.distanceTo(segMid) < 1e-6;
        })?.tag;
    });
}

/**
 * Cuts every hole solid out of the chain input in ONE boolean (a multi-tool cut is one history
 * to the kernel, and overlapping holes cut each other rather than the input twice). The tracked
 * path feeds the per-hole seeded ids through `trackOperation` — `completeTrackedHistory`'s
 * ordering contract (main first, then each tool) is exactly the concatenation the flat id arrays
 * carry. The plain path is the same geometry with no ids.
 */
function cutHoles(input: IShape, tools: BuiltHoleTool[], context: FeatureContext): Result<IShape> {
    const tracked = trackedBoolean("cut");
    const tracking = context.tracking;
    const shapes = tools.map((x) => x.shape);
    try {
        if (tracked === undefined || tracking === undefined) {
            return shapeFactory.booleanCut([input], shapes);
        }
        const result = tracked([input], shapes);
        if (!result.isOk) return Result.err(result.error);
        const completed = completeTrackedHistory([input, ...shapes], result.value);
        trackOperation(
            input,
            tracking,
            { faceIds: tools.flatMap((x) => x.faceIds), edgeIds: tools.flatMap((x) => x.edgeIds) },
            completed,
            result.value,
        );
        return Result.ok(result.value.shape);
    } finally {
        tools.forEach((x) => x.shape.dispose());
    }
}

registerFeature("hole", holeHandler);
