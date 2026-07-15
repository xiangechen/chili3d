// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { command, GetOrSelectNodeStep, I18n, MultistepCommand, PubSub, ShapeNode } from "@chili3d/core";
import { div, span } from "@chili3d/element";
import style from "./checkShape.module.css";

type FaceCheckItem = { index: number; isValid: boolean; status: string[] };

@command({
    key: "modify.checkShape",
    icon: "icon-checkShape",
})
export class CheckShapeCommand extends MultistepCommand {
    protected override executeMainTask() {
        if (!this.stepDatas[0].nodes || this.stepDatas[0].nodes.length === 0) {
            PubSub.default.pub("showToast", "toast.select.noSelected");
            return;
        }

        const node = this.stepDatas[0].nodes[0] as ShapeNode;
        const shape = node.shape.value;

        PubSub.default.pub("showDialog", "dialog.title.checkShape", this.buildContent(shape.checkFaces()));
    }

    private buildContent(faceResults: FaceCheckItem[]) {
        const overallValid = faceResults.every((x) => x.isValid);
        const content = div({ className: style.container });

        content.append(this.renderOverall(overallValid));

        if (faceResults.length === 0) {
            content.append(div({ className: style.noFaces }, I18n.translate("dialog.checkShape.noFaces")));
            return content;
        }

        content.append(this.renderTableHeader(), ...faceResults.map((r) => this.renderFaceRow(r)));

        return content;
    }

    private renderOverall(valid: boolean) {
        const cls = valid ? style.overallValid : style.overallInvalid;
        const key = valid ? "dialog.checkShape.overallValid" : "dialog.checkShape.overallInvalid";
        return div({ className: cls }, I18n.translate(key));
    }

    private renderTableHeader() {
        return div(
            { className: style.header },
            span({ textContent: I18n.translate("dialog.checkShape.faceIndex") }),
            span({ textContent: I18n.translate("dialog.checkShape.validity") }),
            span({ textContent: I18n.translate("command.modify.checkShape") }),
        );
    }

    private renderFaceRow(r: FaceCheckItem) {
        const statusCls = r.isValid ? style.colStatusValid : style.colStatusInvalid;
        const detailCls = r.isValid ? style.colDetailOk : style.colDetailError;
        const label = r.isValid
            ? I18n.translate("dialog.checkShape.valid")
            : I18n.translate("dialog.checkShape.invalid");

        return div(
            { className: style.row },
            span({ className: style.colIndex, textContent: String(r.index + 1) }),
            span({ className: statusCls, textContent: label }),
            span({ className: detailCls, textContent: r.status.join(", ") || "-" }),
        );
    }

    protected override getSteps() {
        return [
            new GetOrSelectNodeStep("prompt.select.shape", {
                filter: {
                    allow: (node) => node instanceof ShapeNode,
                },
                multiple: false,
            }),
        ];
    }
}
