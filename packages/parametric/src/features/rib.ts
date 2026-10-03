// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    BoundingBox,
    type IEdge,
    type IFace,
    type IShape,
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
import { type FeatureContext, type FeatureHandler, type RibFeatureData, registerFeature } from "./feature";
import { mapToHost, mapToolToHost } from "./hostSpace";
import { applyTrackedOperation } from "./operation";
import { attributeEdges, registerProfileEdgeSuffixes } from "./profileEntities";
import { extendChain, type RibChain, resolveChain } from "./ribChain";
import { combineShapes } from "./sweepGeometry";
import { fuseSweptPrisms, sweepFaceTracked } from "./sweepTracked";

/**
 * Rib: the region an OPEN sketch polyline encloses together with the body's own cross-section,
 * given the thickness along the sketch plane's NORMAL — SolidWorks' and Onshape's rib, "a thin fin
 * standing on its sketch plane, filling the corner".
 *
 * The two axes are what the feature turns on, and they are easy to swap: the material GROWS IN the
 * plane, out of the chain and until it lands on the body, while the thickness stands it OFF the
 * plane. Thickening the chain in its own plane instead is the other mode (`NORMAL_TO_SKETCH` in
 * SolidWorks terms), which lays down the fin that should stand up.
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
        { key: "extend", display: "option.command.extend", value: feature.extend ?? false },
    ],

    setParameter: (feature, key, value) =>
        key === "extend"
            ? { ...feature, extend: value === true || value === "true" }
            : { ...feature, [key]: value },

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
    /** Onshape's "Extend profiles to part" (see `ribChain.ts`). */
    readonly extend: boolean;
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
    // `extendChain` reuses the resolved edges and adds its own, so replacing the chain never
    // orphans the sketch's (which belong to the sketch anyway).
    const chain = params.extend ? extendChain(resolved.value, sketch.plane, body) : resolved;
    if (!chain.isOk) return Result.err(chain.error);

    let region: Result<IFace[]> | undefined;
    try {
        region = ribRegion(chain.value, sketch.plane, body);
        if (!region.isOk) return Result.err(region.error);
        // The region lies in the sketch plane and the rib is that region given the thickness — the
        // thickness is the rib's THIN direction, normal to the plane, not its in-plane width.
        const normal = sketch.plane.normal;
        const offset = normal.multiply(-params.thickness / 2);
        return sweepBand(region.value, `rib:${sketch.id}`, normal.multiply(params.thickness), offset);
    } finally {
        if (region?.isOk) {
            region.value.forEach((face) => {
                face.dispose();
            });
        }
        // The stubs an extension built are intermediates too.
        chain.value.owned.forEach((edge) => {
            edge.dispose();
        });
    }
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
 */
function ribRegion(chain: RibChain, plane: Plane, body: IShape): Result<IFace[]> {
    const section = body.section(plane);
    try {
        const outline = section.findSubShapes(ShapeTypes.edge) as IEdge[];
        if (outline.length === 0) return Result.err("The rib plane does not cross the body");
        return selectRibRegions(chain, outline, plane);
    } finally {
        section.dispose();
    }
}

function selectRibRegions(chain: RibChain, outline: readonly IEdge[], plane: Plane): Result<IFace[]> {
    const inputs = [...chain.edges, ...outline];
    const regions = shapeFactory.facesFromEdges(inputs, plane);
    if (!regions.isOk) return Result.err(regions.error);

    const material = shapeFactory.facesFromEdges([...outline], plane);
    const filled = material.isOk ? material.value.faces : [];
    try {
        const rib = regions.value.faces.filter((face, index) => {
            // The chain has to bound it, or the region is the body's own section.
            if (!regions.value.sources[index].some((source) => source < chain.edges.length)) return false;
            return !filled.some((part) => part.containsPoint(interiorOf(face), false, Precision.Distance));
        });
        if (rib.length === 0) {
            // Nothing is handed back, so nothing outlives this call.
            for (const face of regions.value.faces) face.dispose();
            return Result.err("The rib does not reach the body");
        }
        for (const face of rib) {
            registerProfileEdgeSuffixes(face, qualify(attributeFaceLabels(face, inputs, chain)));
        }
        // The regions the caller did not take are the caller's to free; only the rib's are returned.
        for (const face of regions.value.faces) {
            if (!rib.includes(face)) face.dispose();
        }
        return Result.ok(rib);
    } finally {
        // The body's own section is read, never kept — the rib's faces are the ones that travel.
        for (const face of filled) face.dispose();
    }
}

/** Each region edge's label — the chain edge it came from, or undefined where the body made it. */
function attributeFaceLabels(face: IFace, inputs: readonly IEdge[], chain: RibChain): (string | undefined)[] {
    const labelOf = (edge: IEdge) => {
        const index = inputs.indexOf(edge);
        return index < chain.edges.length ? chain.labels[index] : undefined;
    };
    return attributeEdges(face.findSubShapes(ShapeTypes.edge) as IEdge[], inputs, labelOf);
}

/**
 * A point inside `face`, for asking which side of the body the region falls on.
 *
 * The region's own triangulation is what has one to give: a triangle's centre is inside that
 * triangle, and the face is the union of them. A bounding-box centre is NOT inside a region the
 * chain has folded — measured on an L-shaped region, the box centre lands in the notch, and the
 * probe then reads the neighbouring region's side and calls a rib out of the body's material.
 * The largest triangle is taken so a degenerate sliver cannot put the point on an edge.
 */
function interiorOf(face: IFace): XYZ {
    const position = face.mesh.faces?.position;
    let best: { point: XYZ; area: number } | undefined;
    for (let i = 0; position !== undefined && i + 8 < position.length; i += 9) {
        const corner = (offset: number) =>
            new XYZ({ x: position[i + offset], y: position[i + offset + 1], z: position[i + offset + 2] });
        const [a, b, c] = [corner(0), corner(3), corner(6)];
        const area =
            b
                .add(a.multiply(-1))
                .cross(c.add(a.multiply(-1)))
                .length() / 2;
        if (best === undefined || area > best.area) {
            best = {
                point: a
                    .add(b)
                    .add(c)
                    .multiply(1 / 3),
                area,
            };
        }
    }
    // A face with nothing to triangulate keeps the box centre: the probe is a classification, and
    // a shape that offers no mesh should not lose its rib outright.
    return best?.point ?? BoundingBox.center(face.boundingBox());
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
