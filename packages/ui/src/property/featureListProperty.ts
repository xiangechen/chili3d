// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    Binding,
    type FeatureItem,
    type FeatureMissingInput,
    type FeatureParameter,
    type FeatureParameterChoice,
    type FeatureParameterGroup,
    type FeatureReference,
    I18n,
    type I18nKeys,
    type IDocument,
    type IFeatureListNode,
    type INode,
    Localize,
    PubSub,
    Transaction,
    type UnitSpec,
} from "@chili3d/core";
import { div, input, label, option, select, span, svg } from "@chili3d/element";
import { showDialog } from "../dialog";
import commonStyle from "./common.module.css";
import style from "./featureListProperty.module.css";
import inputStyle from "./input.module.css";

interface DropTarget {
    readonly id: string;
    readonly before: boolean;
}

/**
 * False for a parameter the feature's current values say is not in play — see
 * `FeatureParameter.visibleWhen`. The controlling entries are looked up in the SAME item's
 * parameters, so a condition naming a key the feature no longer declares hides the row rather
 * than showing a parameter that answers to nothing.
 */
function isParameterVisible(item: FeatureItem, param: FeatureParameter): boolean {
    return (param.visibleWhen ?? []).every((condition) => {
        const value = item.parameters.find((candidate) => candidate.key === condition.key)?.value;
        return Array.isArray(condition.value)
            ? condition.value.some((candidate) => candidate === value)
            : value === condition.value;
    });
}

/** The i18n label of a unit the panel can name; undefined for derived ones (area, ...). */
function unitSpecLabelKey(unit: UnitSpec | undefined): I18nKeys | undefined {
    if (unit === undefined) return undefined;
    if (unit.length === 1 && unit.angle === 0) return "variable.type.length";
    if (unit.length === 0 && unit.angle === 1) return "variable.type.angle";
    if (unit.length === 0 && unit.angle === 0) return "variable.type.unitless";
    return undefined;
}

/**
 * Renders the ordered feature list of an `IFeatureListNode` (e.g. a parametric
 * body): one collapsible row per feature — the header expands the inline parameter
 * editor, rows are drag-reordered, and a hover "⋯" button opens a floating menu
 * (rename / reselect / suppress / delete). Between the rows sit the rollback-bar
 * slots (`rollbackSlot`): click one to truncate the rebuild there, drag or re-click
 * the active bar to release it; rolled-back rows dim like suppressed ones but stay
 * editable. Edits go through the node's methods inside a transaction, so every
 * change is one undo step.
 */
export class FeatureListProperty extends HTMLElement {
    private readonly expanded = new Set<string>();
    /** Live row elements by feature id, rebuilt by every `renderItems` — the dependency jump target. */
    private readonly rowElements = new Map<string, HTMLElement>();
    private menu: HTMLElement | undefined;
    private draggingId: string | undefined;
    private dropTarget: DropTarget | undefined;
    /** True while the rollback bar itself is being dragged (not a feature row). */
    private draggingRollback = false;

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
        if (property === "featuresJson" || property === "rollbackBarIndex") this.renderItems();
    };

    private renderItems() {
        this.closeMenu();
        this.rowElements.clear();
        const items = this.node.featureItems();
        // Nodes without a rollback bar (the interface's members are optional) render rows only.
        if (this.node.setRollbackBar === undefined) {
            this.replaceChildren(...items.map((item) => this.featureRow(item, false, items)));
            return;
        }
        const bar = this.node.rollbackBarIndex;
        const children: HTMLElement[] = [];
        items.forEach((item, index) => {
            children.push(
                this.rollbackSlot(index),
                this.featureRow(item, bar !== undefined && index >= bar, items),
            );
        });
        children.push(this.rollbackSlot(items.length));
        this.replaceChildren(...children);
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

    private featureRow(item: FeatureItem, rolledBack: boolean, items: readonly FeatureItem[]) {
        const expanded = this.isExpanded(item);
        // A manually suppressed (or rolled-back) row keeps the plain dim; a row suppressed
        // by its variable gets the distinct tint so the source of the suppression is visible.
        const variableSuppressed = item.suppressedByVariable === true && !item.suppressed && !rolledBack;
        const row = div(
            {
                className: `${style.item} ${item.error === undefined ? "" : style.error} ${
                    item.warning === undefined ? "" : style.warning
                } ${item.suppressed || rolledBack ? style.suppressed : ""} ${
                    variableSuppressed ? style.variableSuppressed : ""
                }`,
                title: item.error ?? item.warning ?? this.suppressionTitle(item),
            },
            this.featureHeader(item, expanded),
            ...(expanded ? [this.featureBody(item, items)] : []),
        );
        this.rowElements.set(item.id, row);
        this.addDropHandlers(row, item);
        return row;
    }

    /** The tooltip naming the suppression source; empty when the feature is not suppressed. */
    private suppressionTitle(item: FeatureItem): string {
        // The row's style gives a manual suppression priority over the variable's
        // (featureRow) — the tooltip names the same source the row actually shows.
        if (item.suppressed === true) return I18n.translate("features.suppressedManually");
        return item.suppressedByVariable === true
            ? I18n.translate("features.suppressedByVariable{0}", item.suppressVariable ?? "")
            : "";
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

    private featureBody(item: FeatureItem, items: readonly FeatureItem[]) {
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
            ...(item.missingInputs ?? []).map((missing) => this.missingInputRow(item, missing)),
            ...(item.references ?? []).map((ref) => this.referenceRow(item, ref)),
            ...this.dependencyRows(item, items),
            ...this.parameterRows(item),
        );
    }

    /**
     * The parameter rows with grouped neighbours merged (see `FeatureParameter.group`):
     * a run of adjacent visible parameters sharing a `group.id` renders as ONE row,
     * everything else renders its own row, unchanged.
     */
    private parameterRows(item: FeatureItem): HTMLElement[] {
        const visible = item.parameters.filter((param) => isParameterVisible(item, param));
        const rows: HTMLElement[] = [];
        let index = 0;
        while (index < visible.length) {
            const group = visible[index].group;
            if (group === undefined) {
                rows.push(this.parameterRow(item, visible[index]));
                index++;
                continue;
            }
            const members: FeatureParameter[] = [];
            while (index < visible.length && visible[index].group?.id === group.id) {
                members.push(visible[index]);
                index++;
            }
            rows.push(this.parameterGroupRow(item, group, members));
        }
        return rows;
    }

    /**
     * One row for a group of adjacent parameters (see `FeatureParameter.group`): the
     * group's display is the row label, and each visible member keeps its own control
     * beside a small label with the member's `display`. Commits go through the same
     * per-key paths as a standalone row, so a grouped parameter writes back exactly as
     * if it had one.
     */
    private parameterGroupRow(
        item: FeatureItem,
        group: FeatureParameterGroup,
        members: readonly FeatureParameter[],
    ) {
        return div(
            { className: style.param },
            span({ className: commonStyle.propertyName, textContent: new Localize(group.display) }),
            div(
                { className: style.groupMembers },
                ...members.map((member) =>
                    div(
                        { className: style.groupMember },
                        span({
                            className: style.groupMemberLabel,
                            textContent: new Localize(member.display),
                        }),
                        this.parameterControl(item, member),
                    ),
                ),
            ),
        );
    }

    /**
     * The "depends on / used by" lines — the lightweight dependency graph: names of the
     * upstream features this row's stored references point at, and of the downstream
     * rows pointing back. Clicking a name jumps to that row (expands and scrolls to it).
     * Both lines hide when the node cannot tell (undefined) or the list is empty.
     * `items` is the render pass's own fetch — re-reading `featureItems()` per row would
     * rebuild the whole list once per expanded row.
     */
    private dependencyRows(item: FeatureItem, items: readonly FeatureItem[]): HTMLElement[] {
        const dependsOn = this.node.featureDependencies?.(item.id);
        const usedBy = this.node.featureDependents?.(item.id);
        return [
            ...(dependsOn !== undefined && dependsOn.length > 0
                ? [this.dependencyRow("features.dependsOn", dependsOn, items)]
                : []),
            ...(usedBy !== undefined && usedBy.length > 0
                ? [this.dependencyRow("features.usedBy", usedBy, items)]
                : []),
        ];
    }

    private dependencyRow(
        display: I18nKeys,
        ids: readonly string[],
        items: readonly FeatureItem[],
    ): HTMLElement {
        const nameOf = (id: string) => {
            const target = items.find((candidate) => candidate.id === id);
            return target?.name ?? (target === undefined ? id : I18n.translate(target.display));
        };
        return div(
            { className: style.param },
            span({ className: commonStyle.propertyName, textContent: new Localize(display) }),
            ...ids.map((id) =>
                span({
                    className: style.reference,
                    textContent: nameOf(id),
                    onclick: () => this.jumpToFeature(id),
                }),
            ),
        );
    }

    /** Expands the named feature's row and scrolls it into view. */
    private jumpToFeature(id: string) {
        this.expanded.add(id);
        this.renderItems();
        this.rowElements.get(id)?.scrollIntoView({ block: "nearest" });
    }

    /**
     * A pick the feature built without, standing where the pick itself would be. On a
     * feature that can re-pick, the line is the door to it — the node's own
     * `reselectShapes`, the same action the row's menu offers, reached from the thing the
     * user is looking at rather than from a menu item for it. A feature that cannot
     * re-pick (`reselectable` unset, e.g. a boolean whose tool node was deleted) keeps the
     * plain line: the slot is shown, and the way back is to put the node back.
     */
    private missingInputRow(item: FeatureItem, missing: FeatureMissingInput) {
        const repickable = item.reselectable === true;
        return div({
            className: repickable ? `${style.missingInput} ${style.missingInputAction}` : style.missingInput,
            textContent: missing.label,
            ...(repickable ? { onclick: () => this.node.reselectShapes?.(item.id) } : {}),
        });
    }

    /**
     * A node this feature holds (e.g. its sketch). The name is the door: click
     * selects the node, double-click opens it (the node decides what opening means —
     * for a sketch, entering its editing session).
     */
    private referenceRow(item: FeatureItem, ref: FeatureReference) {
        return div(
            { className: style.param },
            span({ className: commonStyle.propertyName, textContent: new Localize(ref.display) }),
            span({
                className: style.reference,
                textContent: new Binding(ref.node, "name"),
                onclick: () => this.document.selection.setSelectedNodes([ref.node], false),
                ondblclick: () => this.node.activateReference?.(item.id, ref.key),
            }),
        );
    }

    private parameterRow(item: FeatureItem, param: FeatureParameter) {
        return div(
            { className: style.param },
            span({ className: commonStyle.propertyName, textContent: new Localize(param.display) }),
            this.parameterControl(item, param),
        );
    }

    /**
     * The control a parameter edits through — a dropdown for a fixed `choices` set, a
     * checkbox for a boolean, otherwise the expression text box. Shared by standalone
     * rows and group members, so both commit identically.
     */
    private parameterControl(item: FeatureItem, param: FeatureParameter) {
        return param.choices !== undefined && param.choices.length > 0
            ? this.choiceSelect(item, param)
            : typeof param.value === "boolean"
              ? input({
                    type: "checkbox",
                    checked: param.value,
                    onclick: (e) =>
                        this.applyChecked(item, param.key, (e.target as HTMLInputElement).checked),
                })
              : this.textParamInput(item, param.key, param.value, param.unit);
    }

    /**
     * The row of a parameter that holds one of a fixed set (see `FeatureParameter.choices`): a
     * dropdown, so the value cannot be typed into something the rebuild will refuse. The option
     * values are the indexes into `choices`, which keeps the stored value whatever type the
     * handler declared rather than round-tripping it through the DOM's string.
     */
    private choiceSelect(item: FeatureItem, param: FeatureParameter) {
        const choices = param.choices ?? [];
        return select(
            {
                className: inputStyle.box,
                onchange: (e) => {
                    const index = Number((e.target as HTMLSelectElement).value);
                    const chosen = Number.isInteger(index) ? choices[index] : undefined;
                    if (chosen !== undefined) this.applyChoice(item, param.key, chosen.value);
                },
            },
            ...choices.map((choice, index) =>
                option({
                    value: String(index),
                    selected: choice.value === param.value,
                    textContent: this.choiceLabel(choice),
                }),
            ),
        );
    }

    /** A choice's label: its translation, or the value itself uppercased when it carries none. */
    private choiceLabel(choice: FeatureParameterChoice): string | Localize {
        return choice.display === undefined
            ? String(choice.value).toUpperCase()
            : new Localize(choice.display);
    }

    private textParamInput(item: FeatureItem, key: string, value: number | string, unit?: UnitSpec) {
        const expected = unitSpecLabelKey(unit);
        return input({
            className: inputStyle.box,
            value: this.formatParameterValue(value),
            // What the slot measures — the value may be an expression, and the rebuild
            // rejects one of the wrong unit, so say up front what fits.
            title: expected === undefined ? "" : (I18n.translate(expected) ?? ""),
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
        entries.push([
            item.suppressed ? "icon-eye" : "icon-eye-slash",
            item.suppressed ? "features.unsuppress" : "features.suppress",
            () => this.toggleSuppressed(item),
        ]);
        if (this.node.setFeatureSuppressVariable !== undefined) {
            entries.push(["icon-tag", "features.suppressByVariable", () => this.editSuppressVariable(item)]);
        }
        entries.push(["icon-delete", "common.delete", () => this.removeItem(item)]);
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

    /**
     * Sets or clears the variable driving the feature's suppression: the named document
     * variable suppresses the feature when it resolves to 0 (the invert checkbox flips
     * the test). An empty name clears the binding. The variable's absence never
     * suppresses — the node warns on the row instead (see `FeatureBase.suppressBy`).
     */
    private editSuppressVariable(item: FeatureItem) {
        const name = input({ className: inputStyle.box, value: item.suppressVariable ?? "" });
        const invert = input({ type: "checkbox", checked: item.suppressVariableInvert === true });
        const content = div(
            {},
            name,
            label(
                { className: style.suppressInvert },
                invert,
                span({ textContent: new Localize("features.suppressVariableInvert") }),
            ),
        );
        showDialog("features.suppressByVariable", content, () => {
            const variable = name.value.trim();
            Transaction.execute(this.document, "set suppress variable", () => {
                this.node.setFeatureSuppressVariable?.(
                    item.id,
                    variable === "" ? undefined : { variable, invert: invert.checked || undefined },
                );
            });
        });
        setTimeout(() => {
            name.focus();
            name.select();
        });
    }

    // --- drag reorder ---

    private readonly handleDragStart = (item: FeatureItem) => (e: DragEvent) => {
        this.draggingId = item.id;
        // The rollback slots between rows answer to nothing during a row drag — without
        // this their hover/click zones swallow the dragover and the drop dead-ends.
        this.classList.add(style.rowsDragging);
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
        this.classList.remove(style.rowsDragging);
        this.draggingId = undefined;
        this.dropTarget = undefined;
    }

    private clearDropIndicators() {
        this.querySelectorAll(`.${style.item}`).forEach((row) =>
            row.classList.remove(style.dropBefore, style.dropAfter),
        );
    }

    // --- rollback bar ---

    /**
     * One position the persisted rollback bar can sit at: before the feature at
     * `index` (the last slot, past every feature, is the bar's resting place and
     * always inert). At rest the slot is the rows' hairline separator; the position
     * holding the bar renders it solid and is its drag handle. Clicking a position
     * moves the bar there; clicking the bar itself releases it back to the full list.
     */
    private rollbackSlot(index: number) {
        const active = this.node.rollbackBarIndex === index;
        const slot = div({
            className: `${style.rollbackSlot} ${active ? style.rollbackActive : ""}`,
            title: I18n.translate("features.rollbackBar"),
            onclick: (e: MouseEvent) => {
                e.stopPropagation();
                this.applyRollbackBar(active ? undefined : index);
            },
        });
        if (active) {
            slot.draggable = true;
            slot.addEventListener("dragstart", (e: DragEvent) => {
                this.draggingRollback = true;
                if (e.dataTransfer) e.dataTransfer.effectAllowed = "move";
            });
            slot.addEventListener("dragend", () => this.clearRollbackDrag());
        }
        slot.addEventListener("dragover", (e) => this.handleRollbackDragOver(e, slot));
        slot.addEventListener("dragleave", () => slot.classList.remove(style.rollbackDrop));
        slot.addEventListener("drop", (e) => {
            e.preventDefault();
            this.applyRollbackDrop(index);
        });
        return slot;
    }

    private handleRollbackDragOver(e: DragEvent, slot: HTMLElement) {
        if (!this.draggingRollback) return;
        e.preventDefault();
        this.clearRollbackIndicators();
        slot.classList.add(style.rollbackDrop);
    }

    private applyRollbackDrop(index: number) {
        if (!this.draggingRollback) return;
        this.clearRollbackDrag();
        // Dropping past the last feature releases the bar; the node also normalizes it.
        this.applyRollbackBar(index >= this.node.featureItems().length ? undefined : index);
    }

    private clearRollbackDrag() {
        this.clearRollbackIndicators();
        this.draggingRollback = false;
    }

    private clearRollbackIndicators() {
        this.querySelectorAll(`.${style.rollbackSlot}`).forEach((slot) => {
            slot.classList.remove(style.rollbackDrop);
        });
    }

    private applyRollbackBar(index: number | undefined) {
        if (index === this.node.rollbackBarIndex) return;
        Transaction.execute(this.document, "move rollback bar", () => {
            this.node.setRollbackBar?.(index);
            this.document.visual.update();
        });
    }

    // --- feature actions ---

    private applyChecked(item: FeatureItem, key: string, checked: boolean) {
        Transaction.execute(this.document, "edit feature", () => {
            this.node.setFeatureParameter(item.id, key, checked);
            this.document.visual.update();
        });
    }

    /** A dropdown choice — the same commit as `applyChecked`, with the value the handler declared. */
    private applyChoice(item: FeatureItem, key: string, value: number | string | boolean) {
        Transaction.execute(this.document, "edit feature", () => {
            this.node.setFeatureParameter(item.id, key, value);
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
        if (!item.suppressed) {
            const dependents = this.node.featureDependents?.(item.id);
            if (dependents !== undefined && dependents.length > 0) {
                this.confirmSuppressWithDependents(item, dependents);
                return;
            }
        }
        this.applySuppressed(item, !item.suppressed);
    }

    /**
     * Suppressing a feature whose geometry downstream features reference strands their
     * picks — say so first, naming them, and offer the way back. Confirming suppresses
     * either way: the dialog is a warning, not a gate.
     */
    private confirmSuppressWithDependents(item: FeatureItem, dependents: string[]) {
        const items = this.node.featureItems();
        const names = dependents.map((id) => {
            const dependent = items.find((x) => x.id === id);
            return dependent?.name ?? I18n.translate(dependent?.display ?? "common.name");
        });
        const text = I18n.translate("features.suppressDependents{0}", names.join(", "));
        showDialog("features.suppress", div({ textContent: text }), () => this.applySuppressed(item, true));
    }

    private applySuppressed(item: FeatureItem, suppressed: boolean) {
        Transaction.execute(this.document, "toggle feature", () => {
            this.node.setFeatureSuppressed(item.id, suppressed);
            this.document.visual.update();
        });
    }
}

customElements.define("chili-feature-list", FeatureListProperty);
