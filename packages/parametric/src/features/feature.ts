// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type FeatureParameter,
    type I18nKeys,
    type IDocument,
    type IShape,
    Result,
    type ShapeNode,
} from "@chili3d/core";
import type { EdgeRef, Vec3 } from "./edgeRef";
import type { ParameterValue } from "./expression";

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
    | VariableFeatureData;

export interface ExtrudeFeatureData extends FeatureBase {
    readonly type: "extrude";
    readonly sketchId: string;
    readonly length: ParameterValue;
}

export interface RevolveFeatureData extends FeatureBase {
    readonly type: "revolve";
    readonly sketchId: string;
    /** Rotation axis in world space. */
    readonly axis: { point: Vec3; direction: Vec3 };
    /** In degrees. */
    readonly angle: ParameterValue;
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

/** A named value (`expression` may reference earlier variables) usable by later features. */
export interface VariableFeatureData extends FeatureBase {
    readonly type: "variable";
    readonly name: string;
    readonly expression: string;
}

export interface FeatureContext {
    readonly document: IDocument;
    /** The body node replaying this chain — boolean tools are mapped into its local space. */
    readonly host: ShapeNode;
    /** Output of the previous feature; undefined for the first (profile) feature. */
    readonly input?: IShape;
    /** Variables defined by `variable` features earlier in the list. */
    readonly scope: ReadonlyMap<string, number>;
    /**
     * Set by the body so handlers can report stable sub-shape ids via the kernel's
     * shape history. `inputFaceIds`/`inputEdgeIds` are the ids of `input`'s faces and
     * edges (findSubShapes order, empty for profile features); a handler on the tracked
     * path fills the output arrays — left empty when tracking is unavailable.
     */
    readonly tracking?: ShapeTracking;
}

export interface ShapeTracking {
    readonly inputFaceIds: readonly string[];
    outputFaceIds: string[];
    readonly inputEdgeIds: readonly string[];
    outputEdgeIds: string[];
}

/**
 * Maps kernel sub-shape history to stable ids: a sub-shape derived from an input
 * sub-shape keeps that id, a brand-new one gets an id scoped to the creating feature.
 */
export function trackedIds(featureId: string, inputIds: readonly string[], map: number[]): string[] {
    return map.map((inputIndex, outputIndex) =>
        inputIndex >= 0 && inputIndex < inputIds.length
            ? inputIds[inputIndex]
            : `${featureId}:${outputIndex}`,
    );
}

/** Per-feature-kind behavior. Implementations live next to their feature file. */
export interface FeatureHandler<F extends FeatureData = any> {
    /** i18n key shown in the feature list; a function picks the key per feature (e.g. boolean operation). */
    readonly display: I18nKeys | ((feature: F) => I18nKeys);
    /** Iconfont key shown in the feature list; a function picks the icon per feature. */
    readonly icon?: string | ((feature: F) => string);
    /**
     * "shape" (default) features produce the body shape; "parameters" features only
     * contribute variables to the scope via `evaluateParameters`.
     */
    readonly kind?: "shape" | "parameters";
    /** Set when the user can re-pick the shapes the feature references (e.g. edges). */
    readonly reselectable?: boolean;
    evaluate(feature: F, context: FeatureContext): Result<IShape>;
    /** Parameter-kind features resolve their expression into the scope. */
    evaluateParameters?(feature: F, scope: Map<string, number>): Result<void>;
    /** Ids of nodes this feature references — the body watches them for changes. */
    nodeIds(feature: F): string[];
    parameters(feature: F): FeatureParameter[];
    setParameter(feature: F, key: string, value: ParameterValue | boolean): F;
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
