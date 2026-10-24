// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    command,
    EditableShapeNode,
    I18n,
    type I18nKeys,
    type IEdge,
    type IStep,
    MultistepCommand,
    PubSub,
    SelectShapeStep,
    ShapeTypes,
    Transaction,
    VisualStates,
} from "@chili3d/core";

/**
 * The network tolerance in model units. The kernel default (1e-7) demands curves that meet
 * exactly; imported or hand-drawn networks routinely miss by a few 1e-3, and a miss comes
 * back as "every profile must intersect every guide" with no way to widen it.
 */
const NETWORK_TOLERANCE = 1e-4;

/**
 * A Gordon surface over a network of two edge groups: the user picks the profiles first,
 * then the guides, and every profile must intersect every guide. The network becomes ONE
 * face node; the picked edges stay in the scene.
 */
@command({ key: "create.gordon", icon: "icon-loft" })
export class GordonCommand extends MultistepCommand {
    protected override getSteps(): IStep[] {
        return [
            new SelectShapeStep(ShapeTypes.edge, "prompt.select.section", { multiple: true }),
            new SelectShapeStep(ShapeTypes.edge, "prompt.select.curve", {
                multiple: true,
                beforeSelection: () => this.highlightProfiles(true),
                afterSelection: () => this.highlightProfiles(false),
            }),
        ];
    }

    protected override executeMainTask(): void {
        const profiles = this.stepDatas.at(0);
        const guides = this.stepDatas.at(1);
        if ((profiles?.shapes.length ?? 0) < 2 || (guides?.shapes.length ?? 0) < 2) {
            PubSub.default.pub(
                "showToast",
                "error.default:{0}",
                I18n.translate("error.create.gordon.input" as I18nKeys),
            );
            return;
        }

        const result = shapeFactory.gordon(
            this.transformdShapes(profiles!) as IEdge[],
            this.transformdShapes(guides!) as IEdge[],
            NETWORK_TOLERANCE,
        );
        if (!result.isOk) {
            PubSub.default.pub("showToast", "error.default:{0}", result.error);
            return;
        }

        Transaction.execute(this.document, "gordon", () => {
            this.document.modelManager.addNode(
                new EditableShapeNode({
                    document: this.document,
                    name: I18n.translate("command.create.gordon" as I18nKeys),
                    shape: result.value,
                }),
            );
        });
        this.document.visual.update();
    }

    /**
     * The first group's edges lose the selection when the second pick starts, so they are
     * kept visible through the highlighter — and cleared again when the pick ends.
     */
    private highlightProfiles(show: boolean): void {
        for (const picked of this.stepDatas.at(0)?.shapes ?? []) {
            if (show) {
                this.document.visual.highlighter.addState(
                    picked.owner,
                    VisualStates.edgeSelected,
                    picked.shape.shapeType,
                    ...picked.indexes,
                );
            } else {
                this.document.visual.highlighter.removeState(
                    picked.owner,
                    VisualStates.edgeSelected,
                    picked.shape.shapeType,
                    ...picked.indexes,
                );
            }
        }
    }
}
