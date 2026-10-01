// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    Continuities,
    type IEdge,
    type IShape,
    type IVertex,
    type IWire,
    Matrix4,
    Result,
    ShapeNode,
    ShapeTypes,
} from "@chili3d/core";
import type { SketchNode } from "../sketch/sketchNode";
import { isBodyTrackingNode } from "./bodyTracking";
import { trackedBoolean } from "./boolean";
import { matchEdgesAnchored } from "./edgeMatcher";
import type { EdgeRef } from "./edgeRef";
import { findSketch } from "./extrude";
import {
    completeTrackedHistory,
    type FeatureContext,
    type FeatureHandler,
    type LoftFeatureData,
    type LoftSectionData,
    registerFeature,
    trackedFaceIds,
    trackedIds,
} from "./feature";
import { mapToHost } from "./hostSpace";
import { applyTrackedOperation } from "./operation";
import { resolveProfiles } from "./profileBuilder";
import { captureProfileRef, type ProfileRef } from "./profileRef";
import { profileEdgeSeeds } from "./profileSeeds";
import { matchSourceFaceIndexes, resolveSourceFaces } from "./sourceFaceMatcher";
import { derivedId } from "./trackedId";
import { matchVertex, type VertexRef } from "./vertexRef";

/**
 * Loft: a solid or shell through an ordered list of sections (`LoftFeatureData`).
 *
 * Sections are picked from other nodes — sketch profiles, solid faces (their outer
 * wires), closed edges, or vertices (ends only). Each section is stored as a ref
 * (`LoftSectionData`) and re-matched against the referenced node's current shape on
 * every rebuild, which is what makes an upstream edit propagate.
 *
 * Without an `operation` the loft is the FIRST feature of its own body and never
 * touches `context.input`; a solid loft with join/cut/intersect is appended to a
 * target body instead and combines with that chain's input (the extrude/sweep
 * contract). A section may then reference the host body's own face — the press-pull
 * self-source case, resolved against the feature's input by `resolveSourceFaces`.
 *
 * Sub-shape naming (tracked kernel only): a side face takes the seed of the section
 * edge that generated it (`faceEdgeMap`), an output edge that of the input edge it
 * coincides with (the kernel's history plus the geometric completion — loft sections
 * pass through the output unchanged), and a solid's two caps are seeded
 * `<sectionSeed>:start` / `:end` through the `capFaces` channel. The longitudinal
 * edges a loft generates from section VERTICES have no kernel history channel and
 * stay unnamed — resolved geometrically downstream, per the no-id policy
 * (`trackedIds` in feature.ts).
 */

/** A section resolved against its node's current shape, mapped into the host's space. */
interface ResolvedSection {
    readonly shape: IWire | IVertex;
    /** The section's own identity, seeding the cap face at that end; undefined when unnamed. */
    readonly seedBase?: string;
    /** Seeds parallel to the wire's own `findSubShapes(edge)` enumeration (none for vertices). */
    readonly edgeSeeds?: (string | undefined)[];
    /** The fingerprint actually matched this run, for re-anchoring (profile/edge kinds). */
    readonly ref?: ProfileRef | EdgeRef;
}

/** The sections and the re-anchoring refs of one evaluate run. `owned` lives until the kernel has read the shapes. */
interface ResolvedSections {
    readonly sections: ResolvedSection[];
    readonly profiles: ProfileRef[];
    readonly edges: EdgeRef[];
    readonly owned: IShape[];
}

/** The creation-time and rebuild-time section rules; the command toasts these, the feature row shows them. */
export function validateLoftSections(sections: readonly LoftSectionData[]): Result<void> {
    if (sections.length < 2) return Result.err("Loft requires at least 2 sections");
    if (!sections.some((x) => x.kind !== "vertex"))
        return Result.err("Loft requires at least 1 wire section");
    const vertexInside = sections.some(
        (x, index) => x.kind === "vertex" && index > 0 && index < sections.length - 1,
    );
    if (vertexInside) return Result.err("Loft vertex sections must be first or last");
    return Result.ok(undefined);
}

const loftHandler: FeatureHandler<LoftFeatureData> = {
    display: "command.feature.loft",
    icon: "icon-loft",

    nodeIds: (feature) => [...new Set(feature.sections.map((x) => x.nodeId))],

    references: (feature) =>
        feature.sections.map((section, index) => ({
            key: `section${index}`,
            display: "feature.loft.section",
            nodeId: section.nodeId,
        })),

    parameters: (feature) => [
        { key: "isSolid", display: "option.command.isSolid", value: feature.isSolid },
        { key: "isRuled", display: "option.command.isRuled", value: feature.isRuled },
        { key: "continuity", display: "option.command.continuity", value: feature.continuity },
    ],

    setParameter: (feature, key, value) => {
        if (key === "isSolid" || key === "isRuled") {
            return { ...feature, [key]: value === true || value === "true" };
        }
        return { ...feature, [key]: String(value) };
    },

    // The evaluate side fills `resolvedProfiles`/`resolvedEdges` per kind in section
    // order, so re-anchoring consumes them in the same order.
    applyResolvedRefs: (feature, { resolvedProfiles, resolvedEdges }) => {
        if (resolvedProfiles === undefined && resolvedEdges === undefined) return feature;
        const profiles = [...(resolvedProfiles ?? [])];
        const edges = [...(resolvedEdges ?? [])];
        const sections = feature.sections.map((section) => {
            if (section.kind === "profile" && profiles.length > 0) {
                return { ...section, profile: profiles.shift()! };
            }
            if (section.kind === "edge" && edges.length > 0) {
                return { ...section, edge: edges.shift()! };
            }
            return section;
        });
        return { ...feature, sections };
    },

    evaluate(feature, context): Result<IShape> {
        const valid = validateLoftSections(feature.sections);
        if (!valid.isOk) return Result.err(valid.error);
        if (!Continuities.includes(feature.continuity)) {
            return Result.err(`Invalid continuity: ${feature.continuity}`);
        }
        // A shell has no volume to combine with. Refuse rather than quietly ignore the
        // operation: an ignored join would leave the loft's shell as the chain's output,
        // silently discarding the body it was appended to.
        if (feature.operation !== undefined && !feature.isSolid) {
            return Result.err("A shell loft cannot join/cut/intersect");
        }
        const resolved = resolveSections(feature, context);
        if (!resolved.isOk) return Result.err(resolved.error);
        try {
            if (context.tracking !== undefined) {
                context.tracking.resolvedProfiles = resolved.value.profiles;
                context.tracking.resolvedEdges = resolved.value.edges;
            }
            const tracked = evaluateOperationTracked(feature, context, resolved.value.sections);
            if (tracked !== undefined) return tracked;
            const built = buildLoft(feature, resolved.value.sections, context);
            if (!built.isOk) return Result.err(built.error);
            return combineWithInput(built, feature, context);
        } finally {
            resolved.value.owned.forEach((x) => x.dispose());
        }
    },
};

/** The lofted geometry and the ids its kernel history named, in findSubShapes order. */
interface LoftTool {
    readonly shape: IShape;
    readonly faceIds: (string | undefined)[];
    readonly edgeIds: (string | undefined)[];
}

/**
 * Join/cut/intersect on the tracked path: the lofted solid combines with the chain input
 * through the tracked boolean, so the body's own sub-shape ids survive past this feature
 * (the extrude/sweep contract, see `applyTrackedOperation`). Returns undefined when no
 * operation applies, or when a tracking capability is missing — the caller then falls
 * back to the plain path.
 */
function evaluateOperationTracked(
    feature: LoftFeatureData,
    context: FeatureContext,
    sections: ResolvedSection[],
): Result<IShape> | undefined {
    const operation = feature.operation;
    if (operation === undefined) return undefined;
    const tracking = context.tracking;
    const tracked = trackedBoolean(operation);
    if (tracking === undefined || tracked === undefined || shapeFactory.loftTracked === undefined) {
        return undefined;
    }
    const input = context.input;
    if (input === undefined) {
        return Result.err("Loft join/cut/intersect requires a preceding feature");
    }
    const tool = loftTool(feature, sections);
    if (!tool.isOk) return Result.err(tool.error);
    try {
        return applyTrackedOperation(input, tracking, tracked, tool.value);
    } finally {
        // The lofted solid is an intermediate input — the kernel reads it eagerly.
        tool.value.shape.dispose();
    }
}

/** Combines the freshly lofted solid with the chain input, when an operation was asked for. */
function combineWithInput(
    built: Result<IShape>,
    feature: LoftFeatureData,
    context: FeatureContext,
): Result<IShape> {
    const operation = feature.operation;
    if (!built.isOk || operation === undefined) return built;
    if (context.input === undefined) {
        built.value.dispose();
        return Result.err("Loft join/cut/intersect requires a preceding feature");
    }
    try {
        switch (operation) {
            case "cut":
                return shapeFactory.booleanCut([context.input], [built.value]);
            case "common":
                return shapeFactory.booleanCommon([context.input], [built.value]);
            default:
                return shapeFactory.booleanFuse([context.input], [built.value], true);
        }
    } finally {
        // The lofted solid is an intermediate input — the kernel reads it eagerly.
        built.value.dispose();
    }
}

/**
 * Builds the loft. The tracked path names the sub-shapes from the kernel history; without
 * that capability — or with an operation whose tracked path already declined — the loft is
 * built without ids (downstream refs then re-match geometrically).
 */
function buildLoft(
    feature: LoftFeatureData,
    sections: ResolvedSection[],
    context: FeatureContext,
): Result<IShape> {
    const tracking = context.tracking;
    if (tracking === undefined || shapeFactory.loftTracked === undefined) {
        return shapeFactory.loft(
            sections.map((x) => x.shape),
            feature.isSolid,
            feature.isRuled,
            feature.continuity,
        );
    }
    const tool = loftTool(feature, sections);
    if (!tool.isOk) return Result.err(tool.error);
    tracking.outputFaceIds = tool.value.faceIds;
    tracking.outputEdgeIds = tool.value.edgeIds;
    return Result.ok(tool.value.shape);
}

function loftTool(feature: LoftFeatureData, sections: ResolvedSection[]): Result<LoftTool> {
    if (shapeFactory.loftTracked === undefined) return Result.err("Loft tracking is unavailable");
    const shapes = sections.map((x) => x.shape);
    const result = shapeFactory.loftTracked(shapes, feature.isSolid, feature.isRuled, feature.continuity);
    if (!result.isOk) return Result.err(result.error);

    // `completeTrackedHistory` enumerates the inputs' edges in section order — the same
    // order the kernel's history compound is built in (see loftTracked in factory.cpp).
    const edgeSeeds = sections.flatMap((x) => x.edgeSeeds ?? []);
    const completed = completeTrackedHistory(shapes, result.value);
    const faceIds = trackedFaceIds([], edgeSeeds, completed.faceMap, result.value.faceEdgeMap);
    seedLoftCaps(faceIds, sections, result.value.capFaces ?? []);
    return Result.ok({
        shape: result.value.shape,
        faceIds,
        edgeIds: trackedIds(edgeSeeds, completed.edgeMap),
    });
}

/**
 * Names the start/end cap faces after their sections — the kernel reports them in
 * [start, end] order for wire end sections (a vertex end has no cap). A count
 * mismatch means the kernel could not attribute an end: leave ALL caps unnamed
 * rather than seed the wrong one.
 */
function seedLoftCaps(
    faceIds: (string | undefined)[],
    sections: readonly ResolvedSection[],
    capFaces: readonly number[],
): void {
    const firstWire = sections[0].shape.shapeType === ShapeTypes.wire;
    const lastWire = sections[sections.length - 1].shape.shapeType === ShapeTypes.wire;
    if (capFaces.length !== (firstWire ? 1 : 0) + (lastWire ? 1 : 0)) return;
    let cursor = 0;
    if (firstWire) writeCapId(faceIds, capFaces[cursor++], sections[0].seedBase, ":start");
    if (lastWire) writeCapId(faceIds, capFaces[cursor], sections[sections.length - 1].seedBase, ":end");
}

function writeCapId(
    faceIds: (string | undefined)[],
    index: number,
    seed: string | undefined,
    suffix: string,
) {
    if (seed === undefined || index < 0 || index >= faceIds.length) return;
    faceIds[index] = derivedId(seed, suffix);
}

function resolveSections(feature: LoftFeatureData, context: FeatureContext): Result<ResolvedSections> {
    const sections: ResolvedSection[] = [];
    const profiles: ProfileRef[] = [];
    const edges: EdgeRef[] = [];
    const owned: IShape[] = [];
    try {
        for (const section of feature.sections) {
            const resolved = resolveSection(section, context, owned);
            if (!resolved.isOk) return Result.err(resolved.error);
            sections.push(resolved.value);
            if (section.kind === "profile") profiles.push(resolved.value.ref as ProfileRef);
            if (section.kind === "edge") edges.push(resolved.value.ref as EdgeRef);
        }
        return Result.ok({ sections, profiles, edges, owned });
    } catch (error) {
        owned.forEach((x) => x.dispose());
        throw error;
    }
}

function resolveSection(
    section: LoftSectionData,
    context: FeatureContext,
    owned: IShape[],
): Result<ResolvedSection> {
    switch (section.kind) {
        case "profile":
            return resolveProfileSection(section, context, owned);
        case "edge":
            return resolveEdgeSection(section, context, owned);
        case "vertex":
            return resolveVertexSection(section, context, owned);
    }
}

/** A sketch's profile (raw sketch space) or a solid face's outer wire (world space, the press-pull contract). */
function resolveProfileSection(
    section: { readonly nodeId: string; readonly profile: ProfileRef },
    context: FeatureContext,
    owned: IShape[],
): Result<ResolvedSection> {
    const sketch = findSketch(context.document, section.nodeId);
    if (sketch !== undefined) return resolveSketchSection(sketch, section.profile, context, owned);
    return resolveBodyFaceSection(section, context, owned);
}

function resolveSketchSection(
    sketch: SketchNode,
    ref: ProfileRef,
    context: FeatureContext,
    owned: IShape[],
): Result<ResolvedSection> {
    const profiles = resolveProfiles(sketch, [ref]);
    if (!profiles.isOk) return Result.err(profiles.error);
    const { face, seed } = profiles.value[0];
    const seedBase = `sketch:${sketch.id}:${seed}`;
    const faceEdges = face.findSubShapes(ShapeTypes.edge) as IEdge[];
    const wire = face.outerWire();
    return Result.ok({
        shape: mapToHost(wire, sketch, context, owned) as IWire,
        seedBase,
        edgeSeeds: wireEdgeSeeds(wire, faceEdges, profileEdgeSeeds(face, seedBase, faceEdges)),
        ref: captureProfileRef(face),
    });
}

function resolveBodyFaceSection(
    section: { readonly nodeId: string; readonly profile: ProfileRef },
    context: FeatureContext,
    owned: IShape[],
): Result<ResolvedSection> {
    const resolved = resolveSourceFaces({ nodeId: section.nodeId, profiles: [section.profile] }, context);
    if (!resolved.isOk) return Result.err(resolved.error);
    const { worldFaces, faceIds, edgeIdsOf } = resolved.value;
    owned.push(...resolved.value.owned);
    const matched = matchSourceFaceIndexes(worldFaces, faceIds, [section.profile]);
    if (!matched.isOk) return Result.err(matched.error);
    if (matched.value.indexes.length !== 1) return Result.err("A loft section must match a single face");

    const index = matched.value.indexes[0];
    const face = worldFaces[index];
    const faceId = faceIds?.[index];
    const faceEdges = face.findSubShapes(ShapeTypes.edge) as IEdge[];
    const wire = face.outerWire();
    // `edgeIdsOf` runs parallel to the face's own edge enumeration (the transform
    // preserves it), so it maps onto the wire's edges by the same isSame lookup.
    const edgeSeeds = wireEdgeSeeds(wire, faceEdges, edgeIdsOf(index) ?? []);
    return Result.ok({
        shape: mapToHost(wire, undefined, context, owned) as IWire,
        seedBase: faceId,
        edgeSeeds,
        ref: captureProfileRef(face, faceId, section.profile.splitPiece, true),
    });
}

function resolveEdgeSection(
    section: { readonly nodeId: string; readonly edge: EdgeRef },
    context: FeatureContext,
    owned: IShape[],
): Result<ResolvedSection> {
    const node = context.document.modelManager.findNode((n) => n.id === section.nodeId);
    if (!(node instanceof ShapeNode) || !node.shape.isOk) return Result.err("Loft section body not found");
    const shape = node.shape.value;
    const shapeEdges = shape.findSubShapes(ShapeTypes.edge) as IEdge[];
    const edgeIds = isBodyTrackingNode(node) ? shapeEdges.map((_, i) => node.edgeIdAt(i)) : [];
    const matched = matchEdgesAnchored(shape, [section.edge], edgeIds);
    if (!matched.isOk) return Result.err(matched.error);
    if (matched.value.indexes.length !== 1) {
        return Result.err("A loft section edge must stay a single edge after rebuild");
    }
    const edge = shapeEdges[matched.value.indexes[0]];
    if (!edge.isClosed()) return Result.err("A loft section edge must be closed");

    const wire = shapeFactory.wire([edge]);
    if (!wire.isOk) return Result.err(wire.error);
    const edgeId = edgeIds[matched.value.indexes[0]];
    return Result.ok({
        shape: mapToHost(wire.value, node, context, owned) as IWire,
        seedBase: edgeId,
        edgeSeeds: [edgeId],
        ref: matched.value.anchors[0],
    });
}

function resolveVertexSection(
    section: { readonly nodeId: string; readonly vertex: VertexRef },
    context: FeatureContext,
    owned: IShape[],
): Result<ResolvedSection> {
    const node = context.document.modelManager.findNode((n) => n.id === section.nodeId);
    if (!(node instanceof ShapeNode) || !node.shape.isOk) return Result.err("Loft section body not found");
    const vertex = matchVertex(node.shape.value, section.vertex);
    if (vertex === undefined) return Result.err("Loft section vertex not found after rebuild");
    return Result.ok({ shape: mapToHost(vertex, node, context, owned) as IVertex });
}

/**
 * The seeds of `face`'s edges (`faceSeeds`, parallel to `faceEdges`) re-ordered onto
 * the wire's own edge enumeration — the wire's edges ARE the face's (isSame), the two
 * lists just enumerate differently (the face's includes the hole wires').
 */
function wireEdgeSeeds(
    wire: IWire,
    faceEdges: readonly IEdge[],
    faceSeeds: readonly (string | undefined)[],
): (string | undefined)[] {
    const wireEdges = wire.findSubShapes(ShapeTypes.edge) as IEdge[];
    return wireEdges.map((edge) => {
        const index = faceEdges.findIndex((candidate) => candidate.isSame(edge));
        return index < 0 ? undefined : faceSeeds[index];
    });
}

registerFeature("loft", loftHandler);
