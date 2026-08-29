// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IShape, Result } from "@chili3d/core";
import { evaluateExpression } from "./expression";
import { type FeatureHandler, registerFeature, type VariableFeatureData } from "./feature";

const NAME_PATTERN = /^[A-Za-z_]\w*$/;

const variableHandler: FeatureHandler<VariableFeatureData> = {
    kind: "parameters",
    display: "command.feature.variable",
    icon: "icon-tag",

    nodeIds: () => [],

    parameters: (feature) => [
        { key: "name", display: "common.name", value: feature.name },
        { key: "expression", display: "common.expression", value: feature.expression },
    ],

    setParameter: (feature, key, value) => ({ ...feature, [key]: String(value) }),

    evaluate(): Result<IShape> {
        // Parameter-kind features never produce shapes; `evaluateParameters` runs instead.
        return Result.err("variable produces no shape");
    },

    evaluateParameters(feature, scope): Result<void> {
        if (!NAME_PATTERN.test(feature.name)) return Result.err(`Invalid variable name: ${feature.name}`);
        const value = evaluateExpression(feature.expression, scope);
        if (!value.isOk) return Result.err(value.error);
        scope.set(feature.name, value.value);
        return Result.ok(undefined);
    },
};

registerFeature("variable", variableHandler);
