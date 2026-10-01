// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type Continuity,
    type FeatureParameter,
    type I18nKeys,
    type IDocument,
    type IEdge,
    type IFace,
    type IShape,
    type Matrix4,
    type ParameterValue,
    primaryAncestors,
    Result,
    type Scope,
    ShapeTypes,
    type TrackedShape,
    type XYZLike,
} from "@chili3d/core";
import type { EdgeRef } from "./edgeRef";
import {
    completeEdgeHistory,
    completeFaceHistory,
    verifiedEdgeAncestors,
    verifiedFaceAncestors,
} from "./historyCompletion";
import type { ProfileRef } from "./profileRef";
import type { VertexRef } from "./vertexRef";

export interface FeatureBase {
    readonly id: string;
    readonly type: string;
    /** Suppressed features are skipped during evaluation and shown dimmed in the panel. */
    readonly suppressed?: boolean;
    /** User-assigned display name, overriding the kind's default in the feature panel. */
    readonly name?: string;
}

/** Union of all feature payloads; grows as new feature kinds are added. */
export type FeatureData =
    | ExtrudeFeatureData
    | RevolveFeatureData
    | FilletFeatureData
    | ChamferFeatureData
    | BooleanFeatureData
    | LoftFeatureData;

export interface ExtrudeFeatureData extends FeatureBase {
    readonly type: "extrude";
    /** Sketch whose profiles are extruded; undefined when `source` faces are used instead. */
    readonly sketchId?: string;
    /**
     * Planar faces of an existing body to extrude from (press-pull), as profile
     * fingerprints captured in world coordinates (`profileRef.ts`). When `nodeId` is
     * the host body itself, the faces are re-matched on the feature's input shape.
     */
    readonly source?: { readonly nodeId: string; readonly profiles: ProfileRef[] };
    readonly depth: ParameterValue;
    /** When true, the profiles are extruded by `depth` in both directions of the sketch normal. */
    readonly symmetric?: boolean;
    /**
     * Distance the extrusion starts away from the profile plane, along the extrude
     * normal (positive moves the start in the normal direction). Zero keeps the start
     * on the profile plane.
     */
    readonly startOffset?: ParameterValue;
    /**
     * How the prism combines with the preceding feature's shape on the host body —
     * Fusion-style join (fuse) / cut / intersect (common). Undefined creates standalone
     * geometry; set when the extrude command appends the feature to a target body.
     */
    readonly operation?: BooleanOperation;
    /**
     * Fingerprints of the sketch profiles to extrude (`profileRef.ts`); undefined or
     * empty extrudes every closed profile of the sketch.
     */
    readonly profiles?: ProfileRef[];
}

export interface RevolveFeatureData extends FeatureBase {
    readonly type: "revolve";
    readonly sketchId: string;
    /**
     * Rotation axis in world space — a snapshot taken at creation time. When
     * `axisSource` is set it is re-derived from the referenced edge on every rebuild
     * and this only serves as a fallback (e.g. the source node was deleted).
     */
    readonly axis: { point: XYZLike; direction: XYZLike };
    /**
     * The axis as a reference: a line-edge fingerprint (`edgeRef.ts`) on another node,
     * re-matched against that node's current shape when it changes — moving the picked
     * axis line moves the revolve, like the axis reference in mainstream parametric CAD.
     */
    readonly axisSource?: { readonly nodeId: string; readonly edge: EdgeRef };
    /** In degrees. */
    readonly angle: ParameterValue;
    /**
     * Fingerprints of the sketch profiles to revolve (`profileRef.ts`); undefined or
     * empty revolves every closed profile of the sketch.
     */
    readonly profiles?: ProfileRef[];
}

export interface FilletFeatureData extends FeatureBase {
    readonly type: "fillet";
    readonly radius: ParameterValue;
    readonly edges: EdgeRef[];
}

export interface ChamferFeatureData extends FeatureBase {
    readonly type: "chamfer";
    readonly distance: ParameterValue;
    readonly edges: EdgeRef[];
}

export type BooleanOperation = "fuse" | "cut" | "common";

export interface BooleanFeatureData extends FeatureBase {
    readonly type: "boolean";
    readonly operation: BooleanOperation;
    /** Node ids of the tool bodies; the body watches them for changes. */
    readonly toolIds: string[];
    /**
     * When true (the default), tool nodes become children of the body — hidden from
     * the scene, still listed and editable under the body in the model tree.
     */
    readonly consumeTools?: boolean;
}

/**
 * One ordered loft section:
 * - `profile` — a sketch profile (raw sketch-space fingerprint, `profileRef.ts`) or a
 *   solid face's outer wire (world-space fingerprint + the face's tracked id, the
 *   press-pull `source` contract); the node type decides which.
 * - `edge` — a single closed edge of a body, fingerprinted in the body's LOCAL space
 *   (it re-matches through `matchEdgesAnchored` on the node's own shape).
 * - `vertex` — a point section, allowed only as the first or last section; vertices
 *   carry no tracked ids, so the ref is a bare position (`vertexRef.ts`).
 */
export type LoftSectionData =
    | { readonly kind: "profile"; readonly nodeId: string; readonly profile: ProfileRef }
    | { readonly kind: "edge"; readonly nodeId: string; readonly edge: EdgeRef }
    | { readonly kind: "vertex"; readonly nodeId: string; readonly vertex: VertexRef };

export interface LoftFeatureData extends FeatureBase {
    readonly type: "loft";
    /** The sections to loft through, in order — at least two, at least one of them a wire. */
    readonly sections: LoftSectionData[];
    readonly isSolid: boolean;
    readonly isRuled: boolean;
    /** Smoothness of the transitions between sections; ignored when `isRuled`. */
    readonly continuity: Continuity;
}

/**
 * What a feature may ask of the body replaying it: its identity (to recognise a
 * self-reference, e.g. an extrude sourced on the host's own face) and its world
 * transform (boolean tools are mapped into the body's local space). Deliberately
 * narrower than `ShapeNode` so a caller driving a chain — the re-pick preview
 * evaluator, which is not a shape node — need only provide these two.
 */
export interface IShapeHost {
    readonly id: string;
    worldTransform(): Matrix4;
}

export interface FeatureContext {
    readonly document: IDocument;
    readonly host: IShapeHost;
    /** Output of the previous feature; undefined for the first (profile) feature. */
    readonly input?: IShape;
    /** The document's parameter table, resolved for this rebuild. */
    readonly scope: Scope;
    /**
     * Set by the body so handlers can report stable sub-shape ids via the kernel's
     * shape history. `inputFaceIds`/`inputEdgeIds` are the ids of `input`'s faces and
     * edges (findSubShapes order, empty for profile features); a handler on the tracked
     * path fills the output arrays — left empty when tracking is unavailable.
     */
    readonly tracking?: ShapeTracking;
}

export interface ShapeTracking {
    readonly inputFaceIds: readonly (string | undefined)[];
    outputFaceIds: (string | undefined)[];
    readonly inputEdgeIds: readonly (string | undefined)[];
    outputEdgeIds: (string | undefined)[];
    /**
     * Set by a profile-matching handler to the fingerprints of the faces it actually
     * matched this run; the body writes them back into the feature (re-anchoring) so
     * the next edit measures drift from the latest match, not the original pick.
     */
    resolvedProfiles?: ProfileRef[];
    /**
     * Set by an edge-matching handler to the per-ref anchors it actually matched
     * this run (`matchEdgesAnchored`, or a re-capture from the matched edge on the
     * untracked path): fillet/chamfer edges and revolve's axis edge. The body writes
     * them back into the feature, same re-anchoring contract as `resolvedProfiles`.
     */
    resolvedEdges?: EdgeRef[];
}

/**
 * Maps kernel sub-shape history to stable ids: a sub-shape derived from an input sub-shape
 * keeps that id, and a sub-shape nothing can name gets NO id.
 *
 * **Why there is no fallback name.** The only name left for an unattributed sub-shape would
 * be its position in the output enumeration ("the n-th output of feature F") — and a rebuilt
 * body is free to re-enumerate, which hands that name to a NEIGHBOUR, silently. Every sweep
 * instead attributes what it can by content (`attributeSweepEdges` in profileSeeds.ts,
 * `attributeCornerEdges` in edgeCorner.ts); what is left is left id-less, and the matching
 * layer resolves it geometrically, failing loudly when the geometry is ambiguous rather than
 * trusting a name that may have drifted.
 *
 * **Documents that stored a positional id** (`f1@7`, from before this) simply stop matching:
 * the reference falls back to its geometric fingerprint, and the first successful rebuild
 * re-anchors it with a real id (`refreshAnchoredRefs`). No migration step, and none is needed
 * for the common case.
 */
export function trackedIds(
    inputIds: readonly (string | undefined)[],
    map: readonly number[],
): (string | undefined)[] {
    return map.map((inputIndex) =>
        inputIndex >= 0 && inputIndex < inputIds.length ? inputIds[inputIndex] : undefined,
    );
}

/**
 * Face ids for sweeps (prism/revol): face-history hits keep the input face id; a side
 * face generated from a profile edge takes that edge's seed — stable across rebuilds
 * even when the kernel re-enumerates faces (a mirrored profile flips the side-face
 * order); anything else gets no id, for the reason `trackedIds` gives.
 */
export function trackedFaceIds(
    inputFaceIds: readonly (string | undefined)[],
    inputEdgeIds: readonly (string | undefined)[],
    faceMap: readonly number[],
    faceEdgeMap?: readonly number[],
): (string | undefined)[] {
    return faceMap.map((inputIndex, outputIndex) => {
        if (inputIndex >= 0 && inputIndex < inputFaceIds.length) return inputFaceIds[inputIndex];
        const edgeIndex = faceEdgeMap?.[outputIndex] ?? -1;
        if (edgeIndex >= 0 && edgeIndex < inputEdgeIds.length) return inputEdgeIds[edgeIndex];
        return undefined;
    });
}

/** The completed maps of `completeTrackedHistory`, plus the enumerated output sub-shapes for reuse. */
export interface CompletedTrackedHistory {
    readonly edgeMap: number[];
    readonly faceMap: number[];
    /** `result.shape`'s sub-shapes in findSubShapes order — reused by callers for seed generation. */
    readonly outputEdges: IEdge[];
    readonly outputFaces: IFace[];
    /** The enumerated input edges, in the order the kernel's history indexes refer to. */
    readonly inputEdges: readonly IEdge[];
    readonly inputFaces: readonly IFace[];
}

/**
 * Geometry-identical completion of BOTH sub-shape kinds of a tracked kernel
 * history (`completeEdgeHistory`/`completeFaceHistory`): recovers the unchanged
 * sub-shapes a sparse kernel history missed, so they keep the input's stable id
 * instead of being left unnamed. Kernel geometry is read eagerly — call
 * before disposing any input shape.
 *
 * ORDERING CONTRACT (load-bearing): the kernel's history input enumerates the
 * MAIN shape's sub-shapes first, then each tool's in order, and the map indexes
 * point into that enumeration. Pass `inputs` in that same order — the consumers
 * of the completed maps (`mapOperationIds`' main/tool boundary, `mapFusedIds`,
 * `mapBooleanIds`) all interpret the indexes against it.
 *
 * `options.inputEdges`/`options.inputFaces` hand over sub-shape lists the caller already
 * enumerated (the sweep sites keep the profile's edges for seed generation), skipping the repeat
 * `findSubShapes`; the returned output lists are the enumerated result sub-shapes, for the same
 * reuse.
 *
 * The verified merge channel is NOT part of the result — a caller that wants it asks for it with
 * `trackedAncestors`, because the kernel reports pairs for every tracked op while only the merge
 * mappers read them, and verifying is the expensive half (see `trackedAncestors`).
 */
export function completeTrackedHistory(
    inputs: readonly IShape[],
    result: TrackedShape,
    enumerated?: {
        readonly inputEdges?: readonly IEdge[];
        readonly inputFaces?: readonly IFace[];
    },
): CompletedTrackedHistory {
    const inputEdges =
        enumerated?.inputEdges ?? inputs.flatMap((shape) => shape.findSubShapes(ShapeTypes.edge) as IEdge[]);
    const inputFaces =
        enumerated?.inputFaces ?? inputs.flatMap((shape) => shape.findSubShapes(ShapeTypes.face) as IFace[]);
    const outputEdges = result.shape.findSubShapes(ShapeTypes.edge) as IEdge[];
    const outputFaces = result.shape.findSubShapes(ShapeTypes.face) as IFace[];
    return {
        edgeMap: completeEdgeHistory(
            inputEdges,
            outputEdges,
            primaryAncestors(result.edgeAncestors, outputEdges.length),
        ),
        faceMap: completeFaceHistory(
            inputFaces,
            outputFaces,
            primaryAncestors(result.faceAncestors, outputFaces.length),
        ),
        outputEdges,
        outputFaces,
        inputEdges,
        inputFaces,
    };
}

/**
 * The kernel's merge channel, verified: the `(output, input)` pairs with every one the geometry
 * contradicts dropped (see `verifiedEdgeAncestors`), for the merge mappers that consume them.
 *
 * Deliberately a separate call rather than a field of `completeTrackedHistory`: the kernel now
 * reports pairs for EVERY tracked op — booleans, prisms, revolves, corners alike — while only
 * `mapBooleanIds`/`mapFusedIds`/`mapOperationIds` read the channel, and verifying costs an
 * `edgeLiesOn` in each direction per pair (several kernel queries each). A sweep or a corner
 * would pay all of it for nothing.
 *
 * Reads kernel geometry, so call it while the sub-shapes `completed` enumerated are still alive.
 */
export function trackedAncestors(
    completed: CompletedTrackedHistory,
    result: TrackedShape,
): { readonly edgeAncestors?: number[]; readonly faceAncestors?: number[] } {
    return {
        edgeAncestors: verifiedEdgeAncestors(
            result.edgeAncestors,
            completed.outputEdges,
            completed.inputEdges,
        ),
        faceAncestors: verifiedFaceAncestors(
            result.faceAncestors,
            completed.outputFaces,
            completed.inputFaces,
        ),
    };
}

/**
 * A node reference a feature declares — the body resolves `nodeId` against the
 * document to build the panel's link row (see `FeatureReference`).
 */
export interface FeatureNodeRef {
    readonly key: string;
    readonly display: I18nKeys;
    readonly nodeId: string;
}

/** Per-feature-kind behavior. Implementations live next to their feature file. */
export interface FeatureHandler<F extends FeatureData = any> {
    /** i18n key shown in the feature list; a function picks the key per feature (e.g. boolean operation). */
    readonly display: I18nKeys | ((feature: F) => I18nKeys);
    /** Iconfont key shown in the feature list; a function picks the icon per feature. */
    readonly icon?: string | ((feature: F) => string);
    /** Set when the user can re-pick the shapes the feature references (e.g. edges). */
    readonly reselectable?: boolean;
    evaluate(feature: F, context: FeatureContext): Result<IShape>;
    /** Ids of nodes this feature references — the body watches them for changes. */
    nodeIds(feature: F): string[];
    /**
     * Nodes the user is meant to reach from this feature (e.g. the sketch it
     * consumes), shown as link rows in its panel row. A subset of `nodeIds` in
     * practice: `nodeIds` is what the body must watch, this is what the user needs
     * a door to. Dangles are dropped, not rendered.
     */
    references?(feature: F): FeatureNodeRef[];
    parameters(feature: F): FeatureParameter[];
    setParameter(feature: F, key: string, value: ParameterValue | boolean): F;
    /**
     * Writes the refs the last evaluation actually matched back into the feature
     * (re-anchoring — see `ShapeTracking.resolvedProfiles`/`resolvedEdges`). Each
     * handler knows where its refs live; a feature whose entry is absent is
     * returned unchanged.
     */
    applyResolvedRefs?(feature: F, refs: { resolvedProfiles?: ProfileRef[]; resolvedEdges?: EdgeRef[] }): F;
}

const handlers = new Map<string, FeatureHandler>();

export function registerFeature(type: string, handler: FeatureHandler): void {
    handlers.set(type, handler);
}

export function featureHandler(type: string): FeatureHandler | undefined {
    return handlers.get(type);
}

export function evaluateFeature(feature: FeatureData, context: FeatureContext): Result<IShape> {
    const handler = handlers.get(feature.type);
    if (handler === undefined) return Result.err(`Unknown feature type: ${feature.type}`);
    return handler.evaluate(feature, context);
}
