// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    BoundingBox,
    CurveUtils,
    type IEdge,
    type IFace,
    type IShape,
    type ISolid,
    type IVertex,
    LENGTH_UNITS,
    Matrix4,
    type Plane,
    Precision,
    Result,
    resolveUnitSpec,
    ShapeTypes,
    XYZ,
} from "@chili3d/core";
import type { SketchNode } from "../sketch/sketchNode";
import { trackedBoolean } from "./boolean";
import { findSketch } from "./extrude";
import {
    type BooleanOperation,
    completeTrackedHistory,
    type FeatureContext,
    type FeatureHandler,
    type RibExtrusion,
    type RibFeatureData,
    registerFeature,
    trackedAncestors,
} from "./feature";
import { mapToHost, mapToolToHost } from "./hostSpace";
import { applyTrackedOperation } from "./operation";
import { mapOperationIds } from "./operationIds";
import { attributeEdges, edgeLiesOn, registerProfileEdgeSuffixes } from "./profileEntities";
import { samePoint } from "./profileSeeds";
import { carryChain, chainRuns, extendChain, type RibChain, resolveChain } from "./ribChain";
import { combineShapes } from "./sweepGeometry";
import { fuseSweptPrisms, sweepFaceTracked } from "./sweepTracked";

/**
 * Rib: the region an OPEN sketch polyline encloses together with the body's own cross-section,
 * given the thickness along the sketch plane's NORMAL — SolidWorks' and Onshape's rib, "a thin fin
 * standing on its sketch plane, filling the corner".
 *
 * The two axes are what the feature turns on, and they are easy to swap: the material GROWS IN the
 * plane, out of the chain and until it lands on the body, while the thickness stands it OFF the
 * plane. Thickening the chain in its own plane instead is the other mode — SolidWorks' `Normal to
 * Sketch`, Onshape's "Normal to sketch plane" — which lays down the fin that should stand up; it
 * is `RibFeatureData.extrusion === "normal"` and lives in `normalTool`.
 *
 * Structured like `extrude.ts` — the same relationship to its input (a join/cut/intersect against
 * the chain input, tracked so downstream refs keep their ids) and the same kernel call at the end
 * (`prismTracked`) — with one difference of substance. The profile is BUILT rather than resolved:
 * `ribRegion` asks the kernel for the planar regions the chain and the body's section bound
 * together, which is the one reference in this module naming open geometry, and which
 * `ProfileRef`/`sketchProfiles` cannot express at all (the profile layer drops any entity group
 * that does not close).
 */

const ribHandler: FeatureHandler<RibFeatureData> = {
    display: "command.feature.rib",
    icon: "icon-rib",
    // The chain is a named reference that can go missing with the sketch entity behind it, and
    // re-picking it is a re-selection of edges in the one sketch it lives in — the same repair a
    // sweep's path gets.
    reselectable: true,

    nodeIds: (feature) => [feature.sketchId],

    references: (feature) => [{ key: "sketchId", display: "body.sketch", nodeId: feature.sketchId }],

    parameters: (feature) => [
        {
            key: "thickness",
            display: "option.command.thickness",
            value: feature.thickness,
            unit: LENGTH_UNITS,
        },
        {
            key: "extrusion",
            display: "option.command.extrusionDirection",
            value: feature.extrusion ?? "parallel",
            choices: [
                { value: "parallel", display: "option.command.extrusion.parallel" },
                { value: "normal", display: "option.command.extrusion.normal" },
            ],
        },
        {
            key: "reverse",
            display: "option.command.flip",
            value: feature.reverse ?? false,
            visibleWhen: [{ key: "extrusion", value: "normal" }],
        },
        {
            key: "extend",
            display: "option.command.extend",
            value: feature.extend ?? false,
            // "Extend profiles to part" pushes the chain IN the plane; a normal extrusion has no
            // in-plane growth to push (see `RibFeatureData.extrusion`).
            visibleWhen: [{ key: "extrusion", value: "parallel" }],
        },
    ],

    setParameter: (feature, key, value) => {
        if (key === "extend") return { ...feature, extend: value === true || value === "true" };
        if (key === "reverse") return { ...feature, reverse: value === true || value === "true" };
        return { ...feature, [key]: value };
    },

    evaluate(feature, context): Result<IShape> {
        const input = context.input;
        if (input === undefined) return Result.err("Rib requires a preceding feature");

        const params = resolveParams(feature, context);
        if (!params.isOk) return Result.err(params.error);
        const sketch = findSketch(context.document, feature.sketchId);
        if (sketch === undefined) return Result.err("Sketch not found");

        // The chain lives in world coordinates (a sketch builds its edges there), so the body has
        // to be read in world too — both to extend the chain to and to measure the sweep against.
        // The chain input is the host's own, local space (see `hostSpace.ts`).
        const owned: IShape[] = [];
        try {
            const tool = ribTool(sketch, feature.entityIds, params.value, inWorld(input, context, owned));
            if (!tool.isOk) return Result.err(tool.error);
            try {
                return combineTool(tool.value, feature, context);
            } finally {
                tool.value.shape.dispose();
            }
        } finally {
            owned.forEach((x) => x.dispose());
        }
    },
};

/** The rib's parameters, resolved before any geometry runs so a bad expression fails first. */
export interface RibParams {
    readonly thickness: number;
    /** Onshape's "Extend profiles to part" (see `ribChain.ts`). Parallel extrusion only. */
    readonly extend: boolean;
    /**
     * Which axis carries the material and which the thickness (see `RibExtrusion`). Absent means
     * `parallel`.
     */
    readonly extrusion?: RibExtrusion;
    /** Normal extrusion only: grow along the sketch normal's opposite side. */
    readonly reverse?: boolean;
    /**
     * What the rib does to its body. Only a JOIN grows the region onto a curved wall — the
     * extra material lands inside the body and is absorbed. A cut or an intersect would act on
     * that growth instead (`ribRegion`).
     */
    readonly operation?: BooleanOperation;
}

/** The swept rib, with the ids the sweep minted for it. */
export interface RibTool {
    readonly shape: IShape;
    readonly faceIds: (string | undefined)[];
    readonly edgeIds: (string | undefined)[];
}

/**
 * The swept rib for `entityIds` on `sketch` — the ONE place the geometry is built, so a rebuild
 * and the command's preview cannot disagree about what the feature will make.
 *
 * The caller owns the returned shape.
 */
export function ribTool(
    sketch: SketchNode,
    entityIds: readonly number[],
    params: RibParams,
    body: IShape,
): Result<RibTool> {
    const resolved = resolveChain(sketch, entityIds);
    if (!resolved.isOk) return Result.err(resolved.error);
    // Picking several separate lines is how a grid of stiffeners gets drawn in one sketch: each
    // connected run is a rib of its own, and the pieces become one tool (see `chainRuns`).
    const runs = chainRuns(resolved.value);
    const pieces: RibTool[] = [];
    let filed = false;
    try {
        for (const [index, run] of runs.entries()) {
            // One run keeps the sketch's seed, which is what every single-chain document already
            // carries. A second one would mint the first's names again (a sweep names a face
            // `<seed>` and its cap `<seed>:top`), so the others key on their own first entity —
            // content, not position, so dropping another line does not rename them.
            const seedBase = index === 0 ? `rib:${sketch.id}` : `rib:${sketch.id}:run${runKey(run)}`;
            const built = runTool(sketch, run, params, body, seedBase);
            if (!built.isOk) return Result.err(built.error);
            pieces.push(built.value);
        }
        filed = true;
        return combineRibTools(pieces);
    } finally {
        // `combineRibTools` releases the pieces it filed; a failure before it leaves them here.
        if (!filed) pieces.forEach((piece) => piece.shape.dispose());
    }
}

/** A run's own token for its ids: the first sketch entity it was drawn from (`ent<N>`). */
function runKey(run: RibChain): string {
    const first = run.labels[0] ?? "";
    return first.startsWith("ent") ? first.slice("ent".length) : String(run.labels.length);
}

/** One connected run of the chain, built into its own rib. */
function runTool(
    sketch: SketchNode,
    chain: RibChain,
    params: RibParams,
    body: IShape,
    seedBase: string,
): Result<RibTool> {
    if (params.extrusion === "normal") {
        // The chain is thickened in the plane and grown along the normal; "extend profiles to
        // part" pushes an end IN the plane, which this extrusion has no use for (the command
        // keeps the toggle visible, the feature list hides it).
        return normalTool(chain, sketch.plane, body, params, seedBase);
    }
    // `extendChain` reuses the resolved edges and adds its own, so replacing the chain never
    // orphans the sketch's (which belong to the sketch anyway).
    const extended = params.extend ? extendChain(chain, sketch.plane, body) : Result.ok(chain);
    if (!extended.isOk) return Result.err(extended.error);

    let region: Result<IFace[]> | undefined;
    try {
        region = ribRegion(extended.value, sketch.plane, body, params.thickness, params.operation);
        if (!region.isOk) return Result.err(region.error);
        // The region lies in the sketch plane and the rib is that region given the thickness — the
        // thickness is the rib's THIN direction, normal to the plane, not its in-plane width.
        const normal = sketch.plane.normal;
        const offset = normal.multiply(-params.thickness / 2);
        return sweepBand(region.value, seedBase, normal.multiply(params.thickness), offset);
    } finally {
        if (region?.isOk) {
            region.value.forEach((face) => {
                face.dispose();
            });
        }
        // The stubs an extension built are intermediates too.
        extended.value.owned.forEach((edge) => {
            edge.dispose();
        });
    }
}

/**
 * The runs' ribs as one tool: a compound whose sub-shapes are the pieces in order, so the flat
 * id lists stay aligned with `findSubShapes` — the same arrangement `sweepBand` uses for several
 * regions. Pieces that cross (a grid of stiffeners) are left to the feature's own boolean with
 * the body, which unions them anyway. The compound holds its own copies of the pieces' shapes,
 * so the pieces are released here whichever way the combine goes.
 */
function combineRibTools(pieces: RibTool[]): Result<RibTool> {
    if (pieces.length === 1) return Result.ok(pieces[0]);
    const combined = combineShapes(pieces.map((piece) => piece.shape));
    const tool = combined.isOk
        ? Result.ok({
              shape: combined.value,
              faceIds: pieces.flatMap((piece) => piece.faceIds),
              edgeIds: pieces.flatMap((piece) => piece.edgeIds),
          })
        : Result.err(combined.error);
    for (const piece of pieces) piece.shape.dispose();
    return tool;
}

/**
 * The NORMAL extrusion — SolidWorks' `Normal to Sketch`, Onshape's "Normal to sketch plane":
 * the chain is thickened IN the sketch plane and that ribbon is grown along the normal until it
 * reaches the body, the "wall hanging off a sketch".
 *
 * The growth is SolidWorks' "Up To Next" as the industry kernels describe it: an over-long
 * prism of the ribbon is built, the BODY is cut out of it, and the piece still touching the
 * sketch plane is the wall (see `trimOutside`). A "distance to the first face" cannot serve:
 * a chain whose ends already lie inside the material — a chord drawn wall to wall across a
 * bore — starts at distance zero at its ends and at the far face in its middle, and no one
 * distance answers for both. Cutting also trims a target that is not perpendicular to the
 * normal, and it refuses a footprint the body does not fully cover (the prism then still runs
 * to its far end), which is SolidWorks' "fails if any part of the rib meets nothing".
 *
 * Only a run of STRAIGHT edges is thickened: the ribbon is a mitered offset of the chain, and a
 * miter between curves is not something this builds — it is refused rather than approximated.
 */
function normalTool(
    chain: RibChain,
    plane: Plane,
    body: IShape,
    params: RibParams,
    seedBase: string,
): Result<RibTool> {
    const outward = params.reverse ? plane.normal.multiply(-1) : plane.normal;
    const ribbon = ribbonFace(chain, plane, params.thickness / 2);
    if (!ribbon.isOk) return Result.err(ribbon.error);
    try {
        const box = body.boundingBox();
        const diagonal = Math.hypot(box.max.x - box.min.x, box.max.y - box.min.y, box.max.z - box.min.z);
        const reach = BoundingBox.center(box).sub(plane.origin).length() + diagonal * 2;
        const swept = sweepRibbon(ribbon.value, seedBase, outward.multiply(reach));
        if (!swept.isOk) return Result.err(swept.error);
        try {
            return trimOutside(swept.value, body, plane.origin, outward, reach);
        } finally {
            swept.value.shape.dispose();
        }
    } finally {
        ribbon.value.dispose();
    }
}

/** The ribbon swept `vec`, with the ids the sweep minted (or none when the kernel cannot track). */
function sweepRibbon(ribbon: IFace, seedBase: string, vec: XYZ): Result<RibTool> {
    if (shapeFactory.prismTracked === undefined) {
        const prism = shapeFactory.prism(ribbon, vec);
        return prism.isOk
            ? Result.ok({ shape: prism.value, faceIds: [], edgeIds: [] })
            : Result.err(prism.error);
    }
    const swept = sweepFaceTracked(ribbon, seedBase, vec, new XYZ({ x: 0, y: 0, z: 0 }));
    return swept.isOk ? Result.ok(swept.value) : Result.err(swept.error);
}

/**
 * The part of the over-long prism that stands OUTSIDE the body and still touches the sketch
 * plane — the wall. A piece that still runs to `reach` means part of the footprint met nothing,
 * and no piece touching the plane means the ribbon started inside the material; both are refused.
 *
 * The prism's ids travel through the cut with kernel history, so the wall's flanks keep naming
 * their chain entity.
 */
function trimOutside(tool: RibTool, body: IShape, origin: XYZ, outward: XYZ, reach: number): Result<RibTool> {
    const cut = cutWithIds(tool, body);
    if (!cut.isOk) return Result.err(cut.error);
    try {
        const solids = cut.value.shape.findSubShapes(ShapeTypes.solid) as ISolid[];
        const near = solids.filter((solid) => projected(solid, origin, outward, "min") <= Precision.Distance);
        if (near.length === 0) return Result.err("The rib does not reach the body");
        const far = Math.max(...near.map((solid) => projected(solid, origin, outward, "max")));
        if (far >= reach - Math.max(reach * 1e-6, Precision.Distance)) {
            return Result.err("The rib does not reach the body");
        }
        if (near.length === 1) {
            return Result.ok(pickIds(near[0], cut.value));
        }
        // Several clumps still touching the sketch plane: one tool, and the caller owns it.
        const combined = shapeFactory.combine(near);
        return combined.isOk ? Result.ok(pickIds(combined.value, cut.value)) : Result.err(combined.error);
    } finally {
        cut.value.shape.dispose();
    }
}

/** The nearest or farthest projection of a shape's vertices onto `dir`, measured from `origin`. */
function projected(shape: IShape, origin: XYZ, dir: XYZ, want: "min" | "max"): number {
    const vertices = shape.findSubShapes(ShapeTypes.vertex) as IVertex[];
    const start = want === "min" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    return vertices.reduce((extreme, vertex) => {
        const value = vertex.point().sub(origin).dot(dir);
        return want === "min" ? Math.min(extreme, value) : Math.max(extreme, value);
    }, start);
}

/** The cut result's ids, restricted to the faces and edges of `kept` (a sub-shape of it). */
function pickIds(
    kept: IShape,
    cut: { shape: IShape; faceIds: (string | undefined)[]; edgeIds: (string | undefined)[] },
): RibTool {
    const pick = (type: typeof ShapeTypes.face | typeof ShapeTypes.edge, ids: (string | undefined)[]) => {
        const all = cut.shape.findSubShapes(type) as IShape[];
        return (kept.findSubShapes(type) as IShape[]).map((shape) => {
            const index = all.findIndex((candidate) => candidate.isSame(shape));
            return index < 0 ? undefined : ids[index];
        });
    };
    return {
        shape: kept,
        faceIds: pick(ShapeTypes.face, cut.faceIds),
        edgeIds: pick(ShapeTypes.edge, cut.edgeIds),
    };
}

/**
 * The prism with the body cut out of it, carrying the prism's ids through the kernel history
 * (all undefined when the kernel has no tracked cut — the geometry is the same either way).
 */
function cutWithIds(
    tool: RibTool,
    body: IShape,
): Result<{
    shape: IShape;
    faceIds: (string | undefined)[];
    edgeIds: (string | undefined)[];
}> {
    const tracked = shapeFactory.booleanCutTracked?.bind(shapeFactory);
    if (tracked === undefined) {
        const cut = shapeFactory.booleanCut([tool.shape], [body]);
        return cut.isOk ? Result.ok({ shape: cut.value, faceIds: [], edgeIds: [] }) : Result.err(cut.error);
    }
    const cut = tracked([tool.shape], [body]);
    if (!cut.isOk) return Result.err(cut.error);
    const completed = completeTrackedHistory([tool.shape, body], cut.value);
    const ancestors = trackedAncestors(completed, cut.value);
    return Result.ok({
        shape: cut.value.shape,
        faceIds: mapOperationIds(
            tool.shape,
            tool.faceIds,
            [],
            completed.faceMap,
            ShapeTypes.face,
            ancestors.faceAncestors,
        ),
        edgeIds: mapOperationIds(
            tool.shape,
            tool.edgeIds,
            [],
            completed.edgeMap,
            ShapeTypes.edge,
            ancestors.edgeAncestors,
        ),
    });
}

/**
 * The in-plane ribbon: the chain offset ±`half` to both sides, MITERED at its interior vertices
 * and closed by a cap at each end.
 *
 * Each offset piece is labelled with the chain entity it came from — `qualify` gives the two
 * sides' occurrences apart — so the wall's flanks name the sketch entity a later reference can
 * anchor to, exactly as the parallel extrusion's swept band does.
 */
function ribbonFace(chain: RibChain, plane: Plane, half: number): Result<IFace> {
    const walked = orderedChain(chain);
    if (!walked.isOk) return Result.err(walked.error);
    const points = [walked.value[0].from, ...walked.value.map((piece) => piece.to)];
    const offset = (sign: number) => offsetPoints(points, plane, half * sign);
    const plus = offset(1);
    const minus = offset(-1);
    if (!plus.isOk) return Result.err(plus.error);
    if (!minus.isOk) return Result.err(minus.error);

    const inputs: IEdge[] = [];
    const disposeInputs = () => {
        inputs.forEach((edge) => {
            edge.dispose();
        });
    };
    const lines = (pointsAt: readonly XYZ[]) => {
        for (let i = 1; i < pointsAt.length; i++) {
            const line = shapeFactory.line(pointsAt[i - 1], pointsAt[i]);
            if (!line.isOk) return line.error;
            inputs.push(line.value);
        }
        return undefined;
    };
    const failure = lines(plus.value) ?? lines(minus.value);
    if (failure !== undefined) {
        disposeInputs();
        return Result.err(failure);
    }
    // A cap at each end closes the ribbon; the two loops are traversed in opposite directions so
    // the polygon follows one side out and the other back.
    const [plusEnd, minusEnd] = [plus.value.at(-1), minus.value.at(-1)];
    if (plusEnd === undefined || minusEnd === undefined) {
        disposeInputs();
        return Result.err("The rib chain has a zero-length edge");
    }
    const caps = [shapeFactory.line(plusEnd, minusEnd), shapeFactory.line(minus.value[0], plus.value[0])];
    for (const cap of caps) {
        if (!cap.isOk) {
            disposeInputs();
            return Result.err(cap.error);
        }
        inputs.push(cap.value);
    }

    try {
        const regions = shapeFactory.facesFromEdges(inputs, plane);
        if (!regions.isOk) return Result.err(regions.error);
        if (regions.value.faces.length !== 1) {
            for (const face of regions.value.faces) face.dispose();
            return Result.err("The rib chain is too bent to thicken in its own plane");
        }
        const face = regions.value.faces[0];
        const count = walked.value.length;
        // The offset lines were built in WALK order, and the walk reorders the chain — so the
        // label is the walked piece's, not the chain's at that position.
        const labelOf = (edge: IEdge) => {
            const index = inputs.indexOf(edge);
            if (index < 0 || index >= 2 * count) return undefined;
            return walked.value[index % count].label;
        };
        const faceEdges = face.findSubShapes(ShapeTypes.edge) as IEdge[];
        registerProfileEdgeSuffixes(face, qualify(attributeEdges(faceEdges, inputs, labelOf)));
        return Result.ok(face);
    } finally {
        disposeInputs();
    }
}

/** One chain piece, walked from `from` to `to`, with the entity it was drawn as. */
interface ChainPiece {
    readonly edge: IEdge;
    readonly from: XYZ;
    readonly to: XYZ;
    readonly label: string;
}

/**
 * The chain walked end to end, refused unless it is one open run of STRAIGHT edges. `resolveChain`
 * keeps the sketch's own edge order, which says nothing about how the pieces connect, so the
 * order is recovered from shared endpoints here — the one thing the mitered ribbon needs. Each
 * piece carries the entity it was drawn as, because this order is NOT the sketch's and the labels
 * must travel with their edges.
 *
 * The edge the sketch lists first may sit anywhere in the run, so the walk goes both ways from
 * it: forward from its end, backward from its start. Every piece is oriented ALONG the walk, so
 * the polyline reads start to end whichever way the pieces were drawn.
 */
function orderedChain(chain: RibChain): Result<ChainPiece[]> {
    const { edges, labels } = chain;
    if (edges.length === 0) return Result.err("The rib chain has no entities left in the sketch");
    for (const edge of edges) {
        const curve = edge.curve;
        const basis = CurveUtils.isTrimmed(curve) ? curve.basisCurve : curve;
        if (!CurveUtils.isLine(basis)) {
            return Result.err("A normal rib needs a chain of straight edges");
        }
    }
    const remaining = edges.map((edge, index) => ({ edge, label: labels[index] }));
    const seed = remaining.shift();
    if (seed === undefined) return Result.err("The rib chain has no entities left in the sketch");
    const forward: ChainPiece[] = [
        { edge: seed.edge, from: seed.edge.startPoint(), to: seed.edge.endPoint(), label: seed.label },
    ];
    /** The first unclaimed piece touching `point`, removed from the pool. */
    const take = (point: XYZ) => {
        const index = remaining.findIndex(
            (piece) => samePoint(piece.edge.startPoint(), point) || samePoint(piece.edge.endPoint(), point),
        );
        return index < 0 ? undefined : remaining.splice(index, 1)[0];
    };
    /** `piece` oriented along the walk through `point`; `grows` picks which way the walk runs. */
    const along = (piece: { edge: IEdge; label: string }, point: XYZ, grows: boolean): ChainPiece => {
        const joinsAtStart = samePoint(piece.edge.startPoint(), point);
        const near = joinsAtStart ? piece.edge.startPoint() : piece.edge.endPoint();
        const far = joinsAtStart ? piece.edge.endPoint() : piece.edge.startPoint();
        return {
            edge: piece.edge,
            from: grows ? near : far,
            to: grows ? far : near,
            label: piece.label,
        };
    };
    for (;;) {
        const at = forward[forward.length - 1].to;
        const piece = take(at);
        if (piece === undefined) break;
        forward.push(along(piece, at, true));
    }
    const backward: ChainPiece[] = [];
    for (;;) {
        // The far end of the last piece prepended — or the seed's start while none is.
        const at = (backward[0] ?? forward[0]).from;
        const piece = take(at);
        if (piece === undefined) break;
        backward.unshift(along(piece, at, false));
    }
    if (remaining.length > 0) return Result.err("The rib chain is not one open run of edges");
    return Result.ok([...backward, ...forward]);
}

/** The polyline offset `half` to one side (positive = the left of the walk), mitred at corners. */
function offsetPoints(points: readonly XYZ[], plane: Plane, half: number): Result<XYZ[]> {
    const directions: XYZ[] = [];
    for (let i = 1; i < points.length; i++) {
        const direction = points[i].sub(points[i - 1]).normalize();
        if (direction === undefined) return Result.err("The rib chain has a zero-length edge");
        directions.push(direction);
    }
    const normals = directions.map((direction) => plane.normal.cross(direction).normalize());
    if (normals.some((normal) => normal === undefined)) {
        return Result.err("The rib chain leaves the sketch plane");
    }
    const shifted = points.map((point, index) => {
        const normal = normals[Math.min(index, normals.length - 1)];
        return normal === undefined ? point : point.add(normal.multiply(half));
    });
    const result = [...shifted];
    for (let i = 1; i < points.length - 1; i++) {
        const corner = miterPoint(shifted[i - 1], directions[i - 1], shifted[i], directions[i]);
        if (corner !== undefined) result[i] = corner;
    }
    return Result.ok(result);
}

/**
 * Where the offset lines of two consecutive segments meet. Parallel (or nearly) segments have no
 * corner to mitre, and the caller keeps the plain offset point then.
 */
function miterPoint(p1: XYZ, d1: XYZ, p2: XYZ, d2: XYZ): XYZ | undefined {
    const cross = d1.cross(d2);
    const denom = cross.dot(cross);
    if (!(denom > 1e-12)) return undefined;
    const t = p2.sub(p1).cross(d2).dot(cross) / denom;
    return p1.add(d1.multiply(t));
}

/**
 * The rib's own cross-section: what the chain encloses TOGETHER WITH the body's own cross-section
 * in the sketch plane.
 *
 * That is "the material grows until it lands on the part" made concrete, and it is what a rib is:
 * a line drawn across the inside corner between a wall and a floor, filled in. The alternative —
 * offsetting the chain by ±thickness/2 and driving that ribbon off the plane — thickens the chain
 * in its own plane instead, which the same documentation describes as "walls hanging under a
 * sketch", and which puts the thickness on the wrong axis.
 *
 * `facesFromEdges` already finds the minimal regions of a set of planar edges, so the corner falls
 * out of it directly: fed the chain plus the body's section, it answers the triangle the corner
 * bounds AND the body's own section. The section is what tells them apart — a rib fills a VOID, so
 * a region inside the material is the body, not the rib.
 *
 * Every region the chain bounds and the body does not fill becomes a rib, so a chain drawn across
 * a closed void grows to the walls on both sides rather than arbitrarily picking one.
 *
 * Read ACROSS THE BAND, not only at the sketch plane — for a JOIN. The rib is that region swept
 * through the thickness, and a swept section reproduces the body's own wall only where the wall is
 * invariant along the sweep — a plane perpendicular to the sweep. A cylinder's side is not: at the
 * two planes bounding the thickness it stands back from where the sketch plane meets it, so a
 * region measured at the sketch plane alone leaves the rib's seat flat and TANGENT, touching the
 * wall along the sketch plane's own line and standing off everywhere else (measured: a 4 mm rib on
 * a r=10 boss touches along one generatrix and clears the wall by 0.2 mm at the caps). Sectioning
 * the band's three planes and filing the regions together gives the profile the sweep must carry:
 * its seat side reaches the wall at every plane of the band, and where the body stands forward of
 * where the sketch plane saw it, the extra lands inside the body and the join absorbs it. (The
 * chain side is the chain itself, carried on to meet a receded wall — `carryChain`.)
 *
 * A CUT or an INTERSECT must NOT inherit that growth. Nothing absorbs it there: the cut would
 * remove the crescent out of the body and the intersect keep it, both a regression from the
 * region the chain actually bounds (measured on the same boss: a 20 mm rib cut away 2161 mm³
 * that the sketch plane's region never covered, and its intersect went from empty to 2161 mm³).
 * Those operations read the sketch plane alone, exactly as they always did.
 */
function ribRegion(
    chain: RibChain,
    plane: Plane,
    body: IShape,
    thickness: number,
    operation: BooleanOperation | undefined,
): Result<IFace[]> {
    const half = thickness / 2;
    const grows = operation === "fuse";
    const offsets = grows ? [0, -half, half] : [0];
    const outlines: IEdge[] = [];
    let samples: IFace[][] = [];
    try {
        // The sketch plane comes first: only its section decides whether there IS a rib, and its
        // outline is what tells the outer planes which chain ends sit on the wall.
        let sketchOutline: readonly IEdge[] | undefined;
        for (const [index, offset] of offsets.entries()) {
            const sampled = sampleRegions(chain, plane, body, offset, sketchOutline, outlines);
            if (!sampled.isOk) {
                if (index === 0) return Result.err(sampled.error);
                // A plane of the band whose section cannot close the region adds nothing: the
                // wall may not even reach it (a rib as thick as the wall it stands on).
                continue;
            }
            sketchOutline ??= sampled.value.outline;
            samples.push(sampled.value.regions);
        }
        const sketchPlane = samples[0];
        if (sketchPlane === undefined) return Result.err("The rib does not reach the body");
        // A wall parallel to the sweep cuts the same region at every plane, and the sketch
        // plane's own is then the answer: filing them would only re-cut edges that already line
        // up, renaming what it re-cuts. Keeping the sketch plane's faces untouched is what leaves
        // a prismatic rib's ids exactly as they were. EVERY plane has to agree — a band the body
        // does not span (see `samples.length === 1`) must not pass for a parallel wall.
        const prismatic =
            samples.length === offsets.length && samples.every((set) => sameRegions(set, sketchPlane));
        let regions: Result<IFace[]>;
        if (prismatic || samples.length === 1) {
            // The sketch plane is the answer; duplicates stay behind for the finalizer. One
            // sample means the band's outer planes could not close a region at all — the body
            // does not reach them, as with a rib thicker than the boss it stands on — and a seat
            // cannot be read there, so the rib keeps the one the plane itself bounds.
            regions = Result.ok(sketchPlane);
            samples.shift();
        } else {
            regions = fileRegions(samples.flat(), totalArea(sketchPlane));
            if (regions.isOk) {
                // The sampled faces are intermediates now that the union has its own.
                samples = [];
            } else {
                // A boolean that refuses coplanar faces is a kernel limit, not a user error: the
                // plane the chain was drawn on still makes a rib, just without the hug (the
                // same fallback `fuseSweptPrisms` takes when its tracked fuse fails).
                regions = Result.ok(sketchPlane);
                samples.shift();
            }
        }
        if (!regions.isOk) return Result.err(regions.error);
        labelRegions(regions.value, chain, outlines);
        return Result.ok(regions.value);
    } finally {
        // Whatever was not handed back — the duplicate planes of a prismatic wall, or the sampled
        // faces `fileRegions` did not consume — is freed here.
        for (const set of samples) {
            for (const face of set) face.dispose();
        }
        outlines.forEach((edge) => {
            edge.dispose();
        });
    }
}

/**
 * Whether two planes of the band cut the same rib, i.e. the wall is parallel to the sweep there.
 *
 * Area AND the area-weighted centre: area alone would call two different cuts the same whenever
 * one region grows while another shrinks by the same amount (a chain bounding two voids either
 * side of a slanted wall does exactly that), and a bounding-box centre alone would miss two
 * shapes that differ symmetrically about it. The centre matches for parallel walls, since the
 * outline is carried back by the same translation the section was cut with.
 */
function sameRegions(a: readonly IFace[], b: readonly IFace[]): boolean {
    if (a.length !== b.length) return false;
    const sorted = (faces: readonly IFace[]) =>
        faces
            .map((face) => ({ area: face.area(), center: regionCentroid(face) }))
            .sort((x, y) => x.area - y.area);
    const first = sorted(a);
    const second = sorted(b);
    return first.every((item, index) => {
        const other = second[index];
        // Relative, because the areas of a rib are small and the section's own tolerance values
        // are not bit-identical across a translation; 1e-9 is far below the gap this pass targets.
        const areaMatches = Math.abs(item.area - other.area) <= 1e-9 * Math.max(1, item.area);
        return areaMatches && item.center.sub(other.center).length() <= Precision.Distance;
    });
}

/** The sum of `faces`' areas — what the union must at least cover (see `fileRegions`). */
function totalArea(faces: readonly IFace[]): number {
    return faces.reduce((sum, face) => sum + face.area(), 0);
}

/**
 * A face's area-weighted centre, from its own triangulation. The mesh is INDEXED (`position` is
 * a vertex pool, `index` the corners — see `interiorOf`); a face that offers none keeps the box
 * centre, which is all a classification needs.
 */
function regionCentroid(face: IFace): XYZ {
    const mesh = face.mesh.faces;
    const position = mesh?.position;
    const index = mesh?.index;
    if (position === undefined || index === undefined) return BoundingBox.center(face.boundingBox());
    const corner = (vertex: number) =>
        new XYZ({ x: position[vertex * 3], y: position[vertex * 3 + 1], z: position[vertex * 3 + 2] });
    let total = 0;
    let sum = new XYZ({ x: 0, y: 0, z: 0 });
    for (let i = 0; i + 2 < index.length; i += 3) {
        const [a, b, c] = [corner(index[i]), corner(index[i + 1]), corner(index[i + 2])];
        const area =
            b
                .add(a.multiply(-1))
                .cross(c.add(a.multiply(-1)))
                .length() / 2;
        if (!(area > 0)) continue;
        total += area;
        sum = sum.add(
            a
                .add(b)
                .add(c)
                .multiply(area / 3),
        );
    }
    return total > 0 ? sum.multiply(1 / total) : BoundingBox.center(face.boundingBox());
}

/**
 * One plane of the band's cut: the rib regions the body's section bounds there, and that section.
 *
 * The section is cut on a plane parallel to the sketch plane, but `facesFromEdges` builds its
 * pcurves against the plane it is handed — so the outline is first brought back onto the sketch
 * plane (`bringTo`). An end of the chain that sits on `sketchOutline`'s wall is carried along its
 * tangent to this plane's wall (`carryChain`); without that a receding wall would leave the
 * region open right where the chain stops.
 */
function sampleRegions(
    chain: RibChain,
    plane: Plane,
    body: IShape,
    offset: number,
    sketchOutline: readonly IEdge[] | undefined,
    owned: IEdge[],
): Result<{ regions: IFace[]; outline: IEdge[] }> {
    const section = body.section(plane.offsetAlongNormal(offset));
    try {
        const outline = bringTo(section, plane.normal, offset, owned);
        if (outline.length === 0) return Result.err("The rib plane does not cross the body");
        const carried =
            sketchOutline === undefined ? Result.ok(chain) : carryChain(chain, sketchOutline, outline);
        if (!carried.isOk) return Result.err(carried.error);
        try {
            const regions = selectRibRegions(carried.value, outline, plane, body, offset);
            return regions.isOk ? Result.ok({ regions: regions.value, outline }) : Result.err(regions.error);
        } finally {
            // Only the stubs THIS call built: `carryChain` hands the chain back untouched when
            // it adds none, and that chain's own stubs belong to the caller (`ribTool`).
            if (carried.value !== chain) {
                carried.value.owned.forEach((edge) => {
                    edge.dispose();
                });
            }
        }
    } finally {
        section.dispose();
    }
}

/**
 * The section's edges on the sketch plane — the copies land in `owned` for the caller to free
 * once the regions are built, and the section's own edge wrappers are released here.
 */
function bringTo(section: IShape, normal: XYZ, offset: number, owned: IEdge[]): IEdge[] {
    const edges = section.findSubShapes(ShapeTypes.edge) as IEdge[];
    if (offset === 0) {
        owned.push(...edges);
        return edges;
    }
    const move = Matrix4.fromTranslation(-normal.x * offset, -normal.y * offset, -normal.z * offset);
    const copies = edges.map((edge) => edge.transformedMul(move) as IEdge);
    edges.forEach((edge) => {
        edge.dispose();
    });
    owned.push(...copies);
    return copies;
}

/**
 * The sampled regions filed into the faces the sweep carries: one face where they overlap, one
 * per clump where they do not, and `atLeast` (the sketch plane's own area) checks that the union
 * really covers what it was given.
 *
 * The fuse runs UNsimplified and the unification then merges FACES only, never edges: the planes
 * overlap almost everywhere, so leaving them apart would put a seam through the face the sweep
 * carries, but merging collinear chain pieces into one boundary edge would leave only one of them
 * with a name (`carriedLabel` names one edge) — measured: a two-entity collinear chain lost
 * `ent202` from every face and edge id, where a prismatic wall keeps both. `atLeast` catches the
 * other half of the same risk: a boolean that reports success over a partial face set.
 *
 * `regions` is taken over on SUCCESS — freed once the fuse has made its own. A failed fuse hands
 * them back untouched, because the caller still has the sketch plane's own set to fall back on
 * (see `ribRegion`).
 */
function fileRegions(regions: IFace[], atLeast: number): Result<IFace[]> {
    if (regions.length <= 1) return Result.ok(regions);
    // One call with every plane — the planes all lie on the sketch plane, and chaining the
    // fuse pairwise would only build the same union through intermediates to free.
    const fused = shapeFactory.booleanFuse([regions[0]], regions.slice(1), false);
    if (!fused.isOk) return Result.err(fused.error);
    // Unify the coplanar faces (`removeEdges` false). A refused unification leaves the partition
    // the fuse itself made — coplanar adjacent faces are a valid sweep input too.
    const unified = shapeFactory.simplifyShape(fused.value, false, true, [], 1e-5, 1e-6);
    const merged = unified.isOk ? unified.value : fused.value;
    if (unified.isOk) fused.value.dispose();
    const faces = merged.findSubShapes(ShapeTypes.face) as IFace[];
    const covered = totalArea(faces);
    merged.dispose();
    if (faces.length === 0 || covered < atLeast - 1e-6 * Math.max(1, atLeast)) {
        for (const face of faces) face.dispose();
        return Result.err("The rib's band could not be filed together");
    }
    for (const face of regions) face.dispose();
    return Result.ok(faces);
}

/** Names what the rib's own sub-shapes derive from the chain (see `qualify`). */
function labelRegions(faces: readonly IFace[], chain: RibChain, outlines: readonly IEdge[]): void {
    const inputs = [...chain.edges, ...outlines];
    for (const face of faces) {
        registerProfileEdgeSuffixes(face, qualify(attributeFaceLabels(face, inputs, chain)));
    }
}

function selectRibRegions(
    chain: RibChain,
    outline: readonly IEdge[],
    plane: Plane,
    body: IShape,
    offset: number,
): Result<IFace[]> {
    const inputs = [...chain.edges, ...outline];
    const regions = shapeFactory.facesFromEdges(inputs, plane);
    if (!regions.isOk) return Result.err(regions.error);

    // The body itself says which regions are its material. Reading that off the outline's cells
    // (`facesFromEdges([...outline])`) cannot: a section with a BORE makes the bore one of the
    // arrangement's bounded areas, and every void inside the bore would be called material — a
    // diaphragm drawn across a Ø960 bore reported "The rib does not reach the body".
    //
    // The probe is the region's point carried back to the plane the section was cut on
    // (`bringTo` shifted the outline onto the sketch plane), so it is tested inside the solid
    // exactly where the region lies. Boundary counts: a sketch drawn on a face has its material
    // cells right on it.
    const probe = plane.normal.multiply(offset);
    const rib = regions.value.faces.filter((face, index) => {
        // The chain has to bound it, or the region is the body's own section.
        if (!regions.value.sources[index].some((source) => source < chain.edges.length)) return false;
        const point = interiorOf(face).add(probe);
        return !body.containsPoint(point, true, Precision.Distance);
    });
    if (rib.length === 0) {
        // Nothing is handed back, so nothing outlives this call.
        for (const face of regions.value.faces) face.dispose();
        return Result.err("The rib does not reach the body");
    }
    // The regions the caller did not take are the caller's to free; only the rib's are returned.
    // Naming happens once the band's planes are filed together (`labelRegions`), so that the
    // face that travels is the one registered.
    for (const face of regions.value.faces) {
        if (!rib.includes(face)) face.dispose();
    }
    return Result.ok(rib);
}

/**
 * Each region edge's label — the chain edge it came from, or undefined where the body made it.
 *
 * The fallback covers the one edge the band's union can leave longer than any input: where the
 * chain meets the stub an outer plane carried past it (see `carryChain`), the two are COLLINEAR,
 * so the arrangement leaves one boundary edge spanning both and the on-curve probe against the
 * chain edge — which is trimmed to the chain — fails. The relation then reads the other way
 * round: the chain edge lies ON the boundary edge, and the whole side face is that entity's.
 */
function attributeFaceLabels(face: IFace, inputs: readonly IEdge[], chain: RibChain): (string | undefined)[] {
    const labelOf = (edge: IEdge) => {
        const index = inputs.indexOf(edge);
        return index < chain.edges.length ? chain.labels[index] : undefined;
    };
    const edges = face.findSubShapes(ShapeTypes.edge) as IEdge[];
    const labels = attributeEdges(edges, inputs, labelOf);
    return edges.map((edge, index) => labels[index] ?? carriedLabel(edge, chain));
}

/**
 * The chain entity whose edge `edge` fully covers — the collinear carry `attributeFaceLabels`
 * meets. A SKETCH ENTITY beats an extension stub, and the longest wins within each kind: the run
 * is the entity plus the stubs an extension or a band plane grew onto it, and the entity is what
 * a later reference is anchored to — a stub's name changes with the extension's length, and an
 * extension reaching further than the chain it grew from would otherwise rename the face.
 */
function carriedLabel(edge: IEdge, chain: RibChain): string | undefined {
    let best: { label: string; length: number; stub: boolean } | undefined;
    for (const [index, source] of chain.edges.entries()) {
        if (!edgeLiesOn(source, edge)) continue;
        const stub = chain.owned.includes(source);
        const length = source.length();
        if (best === undefined || (best.stub && !stub) || (best.stub === stub && length > best.length)) {
            best = { label: chain.labels[index], length, stub };
        }
    }
    return best?.label;
}

/**
 * A point inside `face`, for asking which side of the body the region falls on.
 *
 * The region's own triangulation is what has one to give: a triangle's centre is inside that
 * triangle, and the face is the union of them. The face mesh is INDEXED — `position` is a vertex
 * pool and `index` names the corners — so reading `position` in steps of nine, the way a flat
 * triangle soup is read, builds "triangles" out of unrelated corners: measured on the L-shaped
 * material region of a plate with a boss, the largest of those had its centre in the void beside
 * the boss, and a chain running through the body's own material was accepted as a rib.
 *
 * A bounding-box centre is NOT inside a region the chain has folded either — measured on that
 * same L shape, the box centre lands in the notch, and the probe then reads the neighbouring
 * region's side. The largest triangle is taken so a degenerate sliver cannot put the point on an
 * edge.
 */
function interiorOf(face: IFace): XYZ {
    const mesh = face.mesh.faces;
    const position = mesh?.position;
    const index = mesh?.index;
    let best: { point: XYZ; area: number } | undefined;
    if (position !== undefined && index !== undefined) {
        const corner = (vertex: number) =>
            new XYZ({ x: position[vertex * 3], y: position[vertex * 3 + 1], z: position[vertex * 3 + 2] });
        for (let i = 0; i + 2 < index.length; i += 3) {
            best = widestTriangle(best, corner(index[i]), corner(index[i + 1]), corner(index[i + 2]));
        }
    }
    // A face with nothing to triangulate keeps the box centre: the probe is a classification, and
    // a shape that offers no mesh should not lose its rib outright.
    return best?.point ?? BoundingBox.center(face.boundingBox());
}

/** The wider of `best` and the triangle `a`/`b`/`c`, with that triangle's centre. */
function widestTriangle(
    best: { point: XYZ; area: number } | undefined,
    a: XYZ,
    b: XYZ,
    c: XYZ,
): { point: XYZ; area: number } {
    const area =
        b
            .add(a.multiply(-1))
            .cross(c.add(a.multiply(-1)))
            .length() / 2;
    if (best !== undefined && area <= best.area) return best;
    return {
        point: a
            .add(b)
            .add(c)
            .multiply(1 / 3),
        area,
    };
}

/** The host body in world coordinates — the space the chain and its section both live in. */
function inWorld(shape: IShape, context: FeatureContext, owned: IShape[]): IShape {
    const transform = context.host.worldTransform();
    if (transform.equals(Matrix4.identity())) return shape;
    const mapped = shape.transformedMul(transform);
    owned.push(mapped);
    return mapped;
}

function resolveParams(feature: RibFeatureData, context: FeatureContext): Result<RibParams> {
    const thickness = resolveUnitSpec(feature.thickness, context.scope, LENGTH_UNITS);
    if (!thickness.isOk) return Result.err(thickness.error);
    if (!(thickness.value > 0)) return Result.err("Rib requires a positive thickness");
    return Result.ok({
        thickness: thickness.value,
        extend: feature.extend === true,
        extrusion: feature.extrusion,
        reverse: feature.reverse === true,
        operation: feature.operation,
    });
}

/**
 * Tells a label that appears twice apart, by occurrence — the same remedy the region seeds use for
 * a repeated key. The module's ids are one-per-sub-shape (`uncontested` drops a name two of them
 * claim, and every id derived from them with it), so a chain edge that bounds two regions, or two
 * of whose pieces bound one, must not hand both the same suffix.
 */
function qualify(labels: readonly (string | undefined)[]): (string | undefined)[] {
    const seen = new Map<string, number>();
    return labels.map((label) => {
        if (label === undefined) return undefined;
        const occurrence = seen.get(label) ?? 0;
        seen.set(label, occurrence + 1);
        return occurrence === 0 ? label : `${label}~${occurrence}`;
    });
}

/**
 * Sweeps the band into the body, tracked when the operation and the kernel both allow it — the
 * same trade `extrude.ts` makes, and for the same reason: a rib wall is exactly what a later
 * fillet wants to anchor on.
 */
function combineTool(tool: RibTool, feature: RibFeatureData, context: FeatureContext): Result<IShape> {
    const input = context.input!;
    const tracking = context.tracking;
    const tracked = feature.operation === undefined ? undefined : trackedBoolean(feature.operation);
    if (tracking === undefined || tracked === undefined || shapeFactory.prismTracked === undefined) {
        return combineWithInput(tool.shape, feature, context);
    }

    const owned: IShape[] = [];
    try {
        // The band is built in world coordinates; the boolean runs in the host's space.
        const mapped = mapToolToHost(tool, context, owned);
        return applyTrackedOperation(input, tracking, tracked, mapped);
    } finally {
        owned.forEach((x) => {
            x.dispose();
        });
    }
}

/** Sweeps each region into a prism with kernel history and merges touching prisms. */
function sweepBand(regions: readonly IFace[], seedBase: string, vec: XYZ, offsetVec: XYZ): Result<RibTool> {
    const shapes: IShape[] = [];
    const faceIds: (string | undefined)[][] = [];
    const edgeIds: (string | undefined)[][] = [];
    for (const [index, region] of regions.entries()) {
        // The suffix keeps a second region — the other half of a void the chain crossed — from
        // minting the names the first one's already took (see `sweepFaceTracked`).
        const swept = sweepFaceTracked(region, seedBase, vec, offsetVec, index === 0 ? "" : `:piece${index}`);
        if (!swept.isOk) return Result.err(swept.error);
        shapes.push(swept.value.shape);
        faceIds.push(swept.value.faceIds);
        edgeIds.push(swept.value.edgeIds);
    }
    const fused = fuseSweptPrisms(shapes, faceIds, edgeIds);
    if (fused !== undefined) return fused;
    const combined = combineShapes(shapes);
    if (!combined.isOk) return Result.err(combined.error);
    return Result.ok({ shape: combined.value, faceIds: faceIds.flat(), edgeIds: edgeIds.flat() });
}

/**
 * The untracked path: the same prism, then a plain boolean with the chain input. Only reached
 * when the kernel or the body offers no tracking, or when the feature carries no operation at all.
 */
function combineWithInput(tool: IShape, feature: RibFeatureData, context: FeatureContext): Result<IShape> {
    if (feature.operation === undefined) return Result.ok(tool);
    if (context.input === undefined) {
        return Result.err("Rib join/cut/intersect requires a preceding feature");
    }
    const owned: IShape[] = [];
    try {
        // The rib solid is built in world coordinates; the chain input is the host's own shape —
        // the boolean runs in the host's space (see `mapToHost`).
        const mapped = mapToHost(tool, undefined, context, owned);
        switch (feature.operation) {
            case "cut":
                return shapeFactory.booleanCut([context.input], [mapped]);
            case "common":
                return shapeFactory.booleanCommon([context.input], [mapped]);
            default:
                return shapeFactory.booleanFuse([context.input], [mapped], true);
        }
    } finally {
        owned.forEach((x) => {
            x.dispose();
        });
    }
}

registerFeature("rib", ribHandler);
