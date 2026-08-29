// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type FeatureItem,
    type IDocument,
    type IFeatureListNode,
    type INode,
    Localize,
    PubSub,
    Transaction,
} from "@chili3d/core";
import { div, input, span, svg } from "@chili3d/element";
import commonStyle from "./common.module.css";
import style from "./featureListProperty.module.css";
import inputStyle from "./input.module.css";

/**
 * Renders the ordered feature list of an `IFeatureListNode` (e.g. a parametric
 * body): one row per feature with inline parameter editing and deletion. Edits go
 * through the node's methods inside a transaction, so every change is one undo step.
 */
export class FeatureListProperty extends HTMLElement {
    constructor(
        readonly document: IDocument,
        readonly node: INode & IFeatureListNode,
    ) {
        super();
        this.renderItems();
    }

    connectedCallback(): void {
        this.node.onPropertyChanged(this.handleNodeChanged);
    }

    disconnectedCallback(): void {
        this.node.removePropertyChanged(this.handleNodeChanged);
    }

    private readonly handleNodeChanged = (property: string) => {
        if (property === "featuresJson") this.renderItems();
    };

    private renderItems() {
        this.replaceChildren(...this.node.featureItems().map((item) => this.featureRow(item)));
    }

    private featureRow(item: FeatureItem) {
        return div(
            {
                className: `${style.item} ${item.error === undefined ? "" : style.error} ${
                    item.suppressed ? style.suppressed : ""
                }`,
                title: item.error ?? "",
            },
            div(
                { className: style.header },
                div(
                    { className: style.title },
                    ...(item.icon === undefined ? [] : [svg({ className: style.icon, icon: item.icon })]),
                    span({ className: style.name, textContent: new Localize(item.display) }),
                ),
                div(
                    { className: style.actions },
                    ...(item.reselectable
                        ? [
                              svg({
                                  className: style.action,
                                  icon: "icon-edit",
                                  onclick: () => this.node.reselectShapes?.(item.id),
                              }),
                          ]
                        : []),
                    svg({
                        className: style.action,
                        icon: item.suppressed ? "icon-eye-slash" : "icon-eye",
                        onclick: () => this.toggleSuppressed(item),
                    }),
                    svg({
                        className: `${style.action} ${style.up}`,
                        icon: "icon-angle-down",
                        onclick: () => this.move(item, -1),
                    }),
                    svg({
                        className: style.action,
                        icon: "icon-angle-down",
                        onclick: () => this.move(item, 1),
                    }),
                    svg({
                        className: style.action,
                        icon: "icon-delete",
                        onclick: () => this.removeItem(item),
                    }),
                ),
            ),
            ...(item.error === undefined
                ? []
                : [div({ className: style.errorText, textContent: item.error })]),
            ...item.parameters.map((param) =>
                div(
                    { className: style.param },
                    span({ className: commonStyle.propertyName, textContent: new Localize(param.display) }),
                    input({
                        className: inputStyle.box,
                        value: this.formatParameterValue(param.value),
                        // Reveal the raw value for editing; blur without a change
                        // restores the trimmed display.
                        onfocus: (e) => {
                            const box = e.target as HTMLInputElement;
                            box.value = String(param.value);
                            box.select();
                        },
                        onkeydown: (e) => this.handleKeyDown(e, item, param.key),
                        onblur: (e) => {
                            const box = e.target as HTMLInputElement;
                            this.applyParameter(box, item, param.key);
                            // A applied change re-renders the list, detaching this box.
                            if (box.isConnected) box.value = this.formatParameterValue(param.value);
                        },
                    }),
                ),
            ),
        );
    }

    private readonly handleKeyDown = (e: KeyboardEvent, item: FeatureItem, key: string) => {
        e.stopPropagation();
        if (e.key === "Enter") this.applyParameter(e.target as HTMLInputElement, item, key);
    };

    /** Numbers display trimmed to 4 fraction digits; expression strings stay as-is. */
    private formatParameterValue(value: number | string): string {
        return typeof value === "number" ? String(Number(value.toFixed(4))) : value;
    }

    private applyParameter(box: HTMLInputElement, item: FeatureItem, key: string) {
        const current = item.parameters.find((x) => x.key === key)?.value;
        const text = box.value.trim();
        if (text === "") {
            PubSub.default.pub("showToast", "error.default:{0}", "invalid input");
            box.value = String(current ?? "");
            return;
        }
        if (text === String(current)) return;
        // A non-numeric value is kept as an expression string; a failure to resolve
        // it surfaces as a feature error on the row.
        const asNumber = Number(text);
        const value = Number.isFinite(asNumber) ? asNumber : text;
        Transaction.execute(this.document, "edit feature", () => {
            this.node.setFeatureParameter(item.id, key, value);
            this.document.visual.update();
        });
    }

    private removeItem(item: FeatureItem) {
        Transaction.execute(this.document, "remove feature", () => {
            this.node.removeFeature(item.id);
            this.document.visual.update();
        });
    }

    private toggleSuppressed(item: FeatureItem) {
        Transaction.execute(this.document, "toggle feature", () => {
            this.node.setFeatureSuppressed(item.id, !item.suppressed);
            this.document.visual.update();
        });
    }

    private move(item: FeatureItem, offset: -1 | 1) {
        Transaction.execute(this.document, "reorder features", () => {
            this.node.moveFeature(item.id, offset);
            this.document.visual.update();
        });
    }
}

customElements.define("chili-feature-list", FeatureListProperty);
