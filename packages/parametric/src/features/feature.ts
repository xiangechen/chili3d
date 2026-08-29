// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type FeatureParameter, type I18nKeys, type IDocument, type IShape, Result } from "@chili3d/core";
import type { EdgeRef, Vec3 } from "./edgeRef";
import type { ParameterValue } from "./expression";

export interface FeatureBase {
    readonly id: string;
    readonly type: string;
    /** Suppressed features are skipped during evaluation and shown dimmed in the panel. */
    readonly suppressed?: boolean;
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
}

/** A named value (`expression` may reference earlier variables) usable by later features. */
export interface VariableFeatureData extends FeatureBase {
    readonly type: "variable";
    readonly name: string;
    readonly expression: string;
}

export interface FeatureContext {
    readonly document: IDocument;
    /** Output of the previous feature; undefined for the first (profile) feature. */
    readonly input?: IShape;
    /** Variables defined by `variable` features earlier in the list. */
    readonly scope: ReadonlyMap<string, number>;
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
    setParameter(feature: F, key: string, value: ParameterValue): F;
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
