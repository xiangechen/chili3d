// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IShape, LENGTH_UNITS, Result, resolveUnitSpec, ShapeTypes } from "@chili3d/core";
import { type FeatureContext, type FeatureHandler, registerFeature, type SewFeatureData } from "./feature";

/**
 * Sew (minimal): stitch the chain input — loose faces, shells, or a compound of those — into
 * one shell, the parametric counterpart of the app's Sew command (`modify.sew`), including
 * its repair pass (`shellSewing`/`fixShape`/`fixSmallFace` at the tolerance, null-guarded the
 * same way).
 *
 * The semantic boundary is deliberately narrow, matching `SewFeatureData`'s contract:
 * - a SOLID input is an error, not a pass-through — there is nothing to sew, and the kernel
 *   returning it unchanged would pretend a sew happened;
 * - no cross-node sewing: the feature consumes the chain input only;
 * - the kernel reports no history for the sew, so the result's ids degrade to geometric
 *   matching (the `trackedIds` fallback in `feature.ts`).
 */
const sewHandler: FeatureHandler<SewFeatureData> = {
    display: "command.feature.sew",
    icon: "icon-sew",

    nodeIds: () => [],

    parameters: (feature) => [
        {
            key: "tolerance",
            display: "common.tolerance",
            value: feature.tolerance ?? 1e-7,
            unit: LENGTH_UNITS,
        },
    ],

    setParameter: (feature, key, value) => ({ ...feature, [key]: value }),

    evaluate(feature, context): Result<IShape> {
        const input = context.input;
        if (input === undefined) return Result.err("Sew requires a preceding feature");
        if (input.shapeType === ShapeTypes.solid || input.shapeType === ShapeTypes.compoundSolid) {
            return Result.err("Sew expects faces or shells — there is nothing to sew on a solid");
        }
        let tolerance = 1e-7;
        if (feature.tolerance !== undefined) {
            const resolved = resolveUnitSpec(feature.tolerance, context.scope, LENGTH_UNITS);
            if (!resolved.isOk) return Result.err(resolved.error);
            tolerance = resolved.value;
        }
        if (!(tolerance > 0)) return Result.err("Sew requires a positive tolerance");

        const sewn = shapeFactory.sewing([input]);
        if (!sewn.isOk) return Result.err(sewn.error);
        const repaired = repair(sewn.value, tolerance);
        if (repaired !== sewn.value) sewn.value.dispose();
        return Result.ok(repaired);
    },
};

/**
 * The app's sew repair pass: sew the shell, fix it, fix its small faces — null-guarded.
 * The result may alias `shape` (when every step fails), so callers must compare identity
 * before disposing the input; replaced intermediates are disposed here.
 */
function repair(shape: IShape, tolerance: number): IShape {
    const replaceIfNotNull = (next: IShape, current: IShape) => {
        if (next.isNull()) return current;
        if (current !== shape) current.dispose();
        return next;
    };
    let repaired = replaceIfNotNull(shape.shellSewing(tolerance), shape);
    repaired = replaceIfNotNull(repaired.fixShape(tolerance), repaired);
    repaired = replaceIfNotNull(repaired.fixSmallFace(tolerance), repaired);
    return repaired;
}

registerFeature("sew", sewHandler);
