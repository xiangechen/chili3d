// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    GetOrSelectNodeStep,
    Id,
    type INode,
    type IStep,
    MultistepCommand,
    Transaction,
} from "@chili3d/core";
import { ParametricBodyNode } from "../parametricBodyNode";
import { promptText } from "./promptDialog";

const NAME_PATTERN = /^[A-Za-z_]\w*$/;

/** Appends a variable feature: pick a parametric body, then enter the name and expression. */
@command({ key: "feature.variable", icon: "icon-tag" })
export class VariableFeatureCommand extends MultistepCommand {
    private get body(): ParametricBodyNode {
        return this.stepDatas[0].nodes?.[0] as unknown as ParametricBodyNode;
    }

    protected override getSteps(): IStep[] {
        return [
            new GetOrSelectNodeStep("prompt.select.models", {
                filter: { allow: (node: INode) => node instanceof ParametricBodyNode },
            }),
        ];
    }

    protected override executeMainTask(): void {
        promptText(
            "common.name",
            "width",
            (name) => (NAME_PATTERN.test(name) ? undefined : `Invalid variable name: ${name}`),
            (name) => this.promptExpression(name),
        );
    }

    private promptExpression(name: string): void {
        promptText(
            "common.expression",
            "50",
            (expression) => (expression.length === 0 ? "Expression must not be empty" : undefined),
            (expression) => this.addVariable(name, expression),
        );
    }

    private addVariable(name: string, expression: string): void {
        Transaction.execute(this.document, "excute feature.variable", () => {
            this.body.setFeaturesEmitShapeChanged([
                ...this.body.features,
                { id: Id.generate(), type: "variable", name, expression },
            ]);
            this.document.visual.update();
        });
    }
}
