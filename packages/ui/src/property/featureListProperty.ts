// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type FeatureItem,
    type FeatureParameter,
    I18n,
    type I18nKeys,
    type IDocument,
    type IFeatureListNode,
    type INode,
    Localize,
    PubSub,
    Transaction,
} from "@chili3d/core";
import { div, input, span, svg } from "@chili3d/element";
import { showDialog } from "../dialog";
import commonStyle from "./common.module.css";
import style from "./featureListProperty.module.css";
import inputStyle from "./input.module.css";

interface DropTarget {
    readonly id: string;
    readonly before: boolean;
}

/**
 * Renders the ordered feature list of an `IFeatureListNode` (e.g. a parametric
 * body): one collapsible row per feature — the header expands the inline parameter
 * editor, rows are drag-reordered, and a hover "⋯" button opens a floating menu
 * (rename / reselect / suppress / delete). Edits go through the node's methods
 * inside a transaction, so every change is one undo step.
 */
export class FeatureListProperty extends HTMLElement {
    private readonly expanded = new Set<string>();
    private menu: HTMLElement | undefined;
    private draggingId: string | undefined;
    private dropTarget: DropTarget | undefined;

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
        this.closeMenu();
    }

    private readonly handleNodeChanged = (property: string) => {
        if (property === "featuresJson") this.renderItems();
    };

    private renderItems() {
        this.closeMenu();
        this.replaceChildren(...this.node.featureItems().map((item) => this.featureRow(item)));
    }

    private isExpanded(item: FeatureItem) {
        // Errored rows stay expanded so the message and repair path remain visible;
        // warnings don't force expansion — the row tint and title carry the hint.
        return this.expanded.has(item.id) || item.error !== undefined;
    }

    private toggleExpand(item: FeatureItem) {
        if (this.expanded.has(item.id)) this.expanded.delete(item.id);
        else this.expanded.add(item.id);
        this.renderItems();
    }

    private featureRow(item: FeatureItem) {
        const expanded = this.isExpanded(item);
        const row = div(
            {
                className: `${style.item} ${item.error === undefined ? "" : style.error} ${
                    item.warning === undefined ? "" : style.warning
                } ${item.suppressed ? style.suppressed : ""}`,
                title: item.error ?? item.warning ?? "",
            },
            this.featureHeader(item, expanded),
            ...(expanded ? [this.featureBody(item)] : []),
        );
        this.addDropHandlers(row, item);
        return row;
    }

    private featureHeader(item: FeatureItem, expanded: boolean) {
        const more = svg({
            className: style.more,
            icon: "icon-ellipsis-vertical",
            onclick: (e: MouseEvent) => {
                e.stopPropagation();
                this.openMenu(more, item);
            },
        });
        const header = div(
            { className: style.header, onclick: () => this.toggleExpand(item) },
            ...(item.icon === undefined ? [] : [svg({ className: style.icon, icon: item.icon })]),
            span({ className: style.name, textContent: item.name ?? new Localize(item.display) }),
            more,
            svg({
                className: style.expander,
                icon: expanded ? "icon-angle-down" : "icon-angle-right",
            }),
        );
        header.draggable = true;
        header.addEventListener("dragstart", this.handleDragStart(item));
        header.addEventListener("dragend", () => this.clearDrag());
        return header;
    }

    private featureBody(item: FeatureItem) {
        // An error outranks a warning for the message slot (they never co-occur:
        // warnings are computed only after a fully successful chain).
        const message =
            item.error !== undefined
                ? div({ className: style.errorText, textContent: item.error })
                : item.warning !== undefined
                  ? div({ className: style.warningText, textContent: item.warning })
                  : undefined;
        return div(
            { className: style.body },
            ...(message === undefined ? [] : [message]),
            ...item.parameters.map((param) => this.parameterRow(item, param)),
        );
    }

    private parameterRow(item: FeatureItem, param: FeatureParameter) {
        return div(
            { className: style.param },
            span({ className: commonStyle.propertyName, textContent: new Localize(param.display) }),
            typeof param.value === "boolean"
                ? input({
                      type: "checkbox",
                      checked: param.value,
                      onclick: (e) =>
                          this.applyChecked(item, param.key, (e.target as HTMLInputElement).checked),
                  })
                : this.textParamInput(item, param.key, param.value),
        );
    }

    private textParamInput(item: FeatureItem, key: string, value: number | string) {
        return input({
            className: inputStyle.box,
            value: this.formatParameterValue(value),
            // Reveal the raw value for editing; blur without a change
            // restores the trimmed display.
            onfocus: (e) => {
                const box = e.target as HTMLInputElement;
                box.value = String(value);
                box.select();
            },
            onkeydown: (e) => this.handleKeyDown(e, item, key),
            onblur: (e) => {
                const box = e.target as HTMLInputElement;
                this.applyParameter(box, item, key);
                // A applied change re-renders the list, detaching this box.
                if (box.isConnected) box.value = this.formatParameterValue(value);
            },
        });
    }

    private readonly handleKeyDown = (e: KeyboardEvent, item: FeatureItem, key: string) => {
        e.stopPropagation();
        if (e.key === "Enter") this.applyParameter(e.target as HTMLInputElement, item, key);
    };

    /** Numbers display trimmed to 4 fraction digits; expression strings stay as-is. */
    private formatParameterValue(value: number | string): string {
        return typeof value === "number" ? String(Number(value.toFixed(4))) : value;
    }

    // --- floating menu ---

    private openMenu(anchor: Element, item: FeatureItem) {
        this.closeMenu();
        const entries: [icon: string, display: I18nKeys, action: () => void][] = [
            ["icon-edit", "common.rename", () => this.rename(item)],
        ];
        if (item.reselectable) {
            entries.push(["icon-sync-alt", "features.reselect", () => this.node.reselectShapes?.(item.id)]);
        }
        entries.push(
            [
                item.suppressed ? "icon-eye" : "icon-eye-slash",
                item.suppressed ? "features.unsuppress" : "features.suppress",
                () => this.toggleSuppressed(item),
            ],
            ["icon-delete", "common.delete", () => this.removeItem(item)],
        );
        const menu = div(
            { className: style.menu },
            ...entries.map(([icon, display, action]) =>
                div(
                    {
                        className: style.menuItem,
                        onclick: (e: MouseEvent) => {
                            e.stopPropagation();
                            this.closeMenu();
                            action();
                        },
                    },
                    svg({ className: style.menuIcon, icon }),
                    span({ textContent: new Localize(display) }),
                ),
            ),
        );
        document.body.appendChild(menu);
        const { top, left } = this.menuPosition(anchor.getBoundingClientRect(), menu);
        menu.style.top = `${top}px`;
        menu.style.left = `${left}px`;
        this.menu = menu;
        document.addEventListener("click", this.handleOutsideClick, true);
        document.addEventListener("keydown", this.handleMenuKeyDown);
    }

    /**
     * Keeps the floating menu inside the viewport: flips above the anchor when it
     * would overflow the bottom edge, and clamps horizontally.
     */
    private menuPosition(anchorRect: DOMRect, menu: HTMLElement) {
        const margin = 4;
        const height = menu.offsetHeight;
        const width = menu.offsetWidth;
        let top = anchorRect.bottom + 2;
        if (top + height > window.innerHeight - margin) {
            top = Math.max(margin, anchorRect.top - height - 2);
        }
        let left = Math.max(anchorRect.left, anchorRect.right - width);
        left = Math.min(left, window.innerWidth - width - margin);
        return { top, left: Math.max(margin, left) };
    }

    private closeMenu() {
        if (this.menu === undefined) return;
        this.menu.remove();
        this.menu = undefined;
        document.removeEventListener("click", this.handleOutsideClick, true);
        document.removeEventListener("keydown", this.handleMenuKeyDown);
    }

    private readonly handleOutsideClick = (e: Event) => {
        if (this.menu !== undefined && !this.menu.contains(e.target as Node)) this.closeMenu();
    };

    private readonly handleMenuKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") this.closeMenu();
    };

    private rename(item: FeatureItem) {
        const box = input({ className: inputStyle.box, value: item.name ?? I18n.translate(item.display) });
        showDialog("common.rename", box, () => {
            Transaction.execute(this.document, "rename feature", () => {
                this.node.renameFeature?.(item.id, box.value.trim());
            });
        });
        setTimeout(() => {
            box.focus();
            box.select();
        });
    }

    // --- drag reorder ---

    private readonly handleDragStart = (item: FeatureItem) => (e: DragEvent) => {
        this.draggingId = item.id;
        if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
    };

    private addDropHandlers(row: HTMLElement, item: FeatureItem) {
        row.addEventListener("dragover", (e) => this.handleDragOver(e, row, item));
        row.addEventListener("dragleave", () => row.classList.remove(style.dropBefore, style.dropAfter));
        row.addEventListener("drop", (e) => {
            e.preventDefault();
            this.applyDrop();
        });
    }

    private handleDragOver(e: DragEvent, row: HTMLElement, item: FeatureItem) {
        if (this.draggingId === undefined || this.draggingId === item.id) return;
        e.preventDefault();
        const rect = row.getBoundingClientRect();
        const before = e.clientY < rect.top + rect.height / 2;
        this.dropTarget = { id: item.id, before };
        this.clearDropIndicators();
        row.classList.add(before ? style.dropBefore : style.dropAfter);
    }

    private applyDrop() {
        const target = this.dropTarget;
        const draggingId = this.draggingId;
        this.clearDrag();
        if (target === undefined || draggingId === undefined) return;
        const items = this.node.featureItems();
        const from = items.findIndex((x) => x.id === draggingId);
        let index = items.findIndex((x) => x.id === target.id) + (target.before ? 0 : 1);
        if (from < 0 || index < 0 || from === index || from === index - 1) return;
        if (from < index) index -= 1;
        Transaction.execute(this.document, "reorder features", () => {
            this.moveFeatureTo(draggingId, index);
            this.document.visual.update();
        });
    }

    private moveFeatureTo(featureId: string, index: number) {
        if (this.node.moveFeatureTo !== undefined) {
            this.node.moveFeatureTo(featureId, index);
            return;
        }
        // Fallback for nodes without absolute moves: step towards the target index.
        let current = this.node.featureItems().findIndex((x) => x.id === featureId);
        while (current !== -1 && current < index) {
            this.node.moveFeature(featureId, 1);
            current++;
        }
        while (current !== -1 && current > index) {
            this.node.moveFeature(featureId, -1);
            current--;
        }
    }

    private clearDrag() {
        this.clearDropIndicators();
        this.draggingId = undefined;
        this.dropTarget = undefined;
    }

    private clearDropIndicators() {
        this.querySelectorAll(`.${style.item}`).forEach((row) =>
            row.classList.remove(style.dropBefore, style.dropAfter),
        );
    }

    // --- feature actions ---

    private applyChecked(item: FeatureItem, key: string, checked: boolean) {
        Transaction.execute(this.document, "edit feature", () => {
            this.node.setFeatureParameter(item.id, key, checked);
            this.document.visual.update();
        });
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
}

customElements.define("chili-feature-list", FeatureListProperty);
