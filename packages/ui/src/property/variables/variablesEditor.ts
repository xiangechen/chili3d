// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type EvaluatedVariables,
    I18n,
    type I18nKeys,
    Localize,
    type VariableData,
    type VariableType,
} from "@chili3d/core";
import { button, div, input, option, select, span, svg } from "@chili3d/element";
import type { VariablesDataContent } from "./variablesDataContent";
import style from "./variablesEditor.module.css";

const TYPES: readonly { value: VariableType; label: I18nKeys }[] = [
    { value: "length", label: "variable.type.length" },
    { value: "angle", label: "variable.type.angle" },
    { value: "unitless", label: "variable.type.unitless" },
];

const COLUMNS: readonly I18nKeys[] = ["common.name", "variable.type", "variable.value"];

/**
 * The parameters table: one row per document parameter — Name / Type / Value, where the
 * value column is also where the expression is written (`Onshape`'s variable feature).
 *
 * The description is not a column: it is an optional note, and a cell for it made every row
 * wider for nothing. It lives behind the marker next to the name instead — `editDescription`.
 *
 * A row carries no buttons of its own. Reordering and deletion act on one parameter at a
 * time, so they live in the floating panel's title bar and follow the selected row (see
 * `floatingActions`) — three icons repeated down every row is a column of noise for buttons
 * that only ever mean one row. The selected row is tinted, because the bar is away from what
 * it changes.
 *
 * Selecting is what focus does: clicking a row or tabbing into one of its fields selects it,
 * clicking anywhere off the rows lets it go. It outlives the field's focus on purpose —
 * reaching for a title-bar button blurs the field, and a selection that died on blur would
 * take the button away from under the pointer.
 *
 * Editing a field refreshes only the value column — rebuilding the rows would take the focus
 * out of the box the user is typing in. Adding, removing and reordering DO rebuild, because
 * the row set itself changed; a rebuild hands focus back (the new row's name box on add, the
 * clicked arrow on move), so repeated clicks and keyboard users never lose their place.
 */
export class VariablesEditor extends HTMLElement {
    private readonly valueCells = new Map<string, HTMLInputElement>();
    private readonly rows = new Map<string, HTMLElement>();
    /** The actions that act on the selected row — hosted by the panel's title bar. */
    private readonly actionsBar = div({ className: style.actions });
    private selectedId: string | undefined;
    /** The open description editor, when one is up (see `editDescription`). */
    private popup: HTMLElement | undefined;

    constructor(private readonly content: VariablesDataContent) {
        super();
        this.className = style.root;
        this.render();
        this.addEventListener("pointerdown", this.handlePointerDown);
        this.addEventListener("focusin", this.handleFocusIn);
        this.content.document.variables.onPropertyChanged(this.handleVariablesChanged);
    }

    /** The title-bar slot contents — see `FloatPanelOptions.actions`. */
    floatingActions(): HTMLElement[] {
        return [this.actionsBar];
    }

    private readonly handlePointerDown = (e: Event) => {
        // Off the rows entirely (the empty row, the table's header, the space under it) is
        // "nothing is selected"; `undefined` is how that is said.
        this.select(this.rowIdAt(e.target));
    };

    private readonly handleFocusIn = (e: Event) => {
        // Tabbing into a row selects it just as clicking it does; a focus that left the
        // rows (nothing is focusable outside them here) does not.
        const id = this.rowIdAt(e.target);
        if (id !== undefined) this.select(id);
    };

    private rowIdAt(target: EventTarget | null): string | undefined {
        const row = (target as HTMLElement | null)?.closest(`.${style.row}`);
        if (row === null || row === undefined) return undefined;
        // Identity, not position: `rows` is keyed by id and is the reverse of this lookup.
        for (const [id, element] of this.rows) {
            if (element === row) return id;
        }
        return undefined;
    }

    private select(id: string | undefined): void {
        if (id === this.selectedId) return;
        this.selectedId = id;
        for (const [rowId, row] of this.rows) {
            row.classList.toggle(style.selected, rowId === id);
        }
        this.updateActions();
    }

    disconnectedCallback(): void {
        this.content.document.variables.removePropertyChanged(this.handleVariablesChanged);
        this.popup?.remove();
        this.popup = undefined;
    }

    /**
     * The table changed behind the panel's back — an undo, a redo, or a second panel on the
     * same document. Without this the rows kept describing a table that no longer exists,
     * and a stale row is a dead control: its id is gone, so its edits write nothing.
     *
     * The panel's own writes are skipped: those rows are already on screen, and rebuilding
     * them would take the focus out of the field being edited. The write notifies from
     * inside `setItems`, so this has to be asked WHILE it is in flight — see `isWriting`.
     */
    private readonly handleVariablesChanged = (property: string) => {
        if (property !== "variablesJson") return;
        if (this.content.isWriting) return;
        this.render();
    };

    /** Rebuilds every row. Only for structural changes — see the class comment. */
    render(): void {
        // A rebuild is also when the table can be seen whole: the selected row may have been
        // deleted from under the bar by an undo, or by another panel on the same document.
        if (this.current(this.selectedId) === undefined) this.selectedId = undefined;
        this.valueCells.clear();
        this.rows.clear();
        this.replaceChildren(
            div(
                { className: style.table },
                div(
                    { className: style.header },
                    ...COLUMNS.map((column) =>
                        span({ className: style.cell, textContent: new Localize(column) }),
                    ),
                ),
                div(
                    { className: style.rows },
                    ...this.content.items.map((item) => this.row(item)),
                    this.newRow(),
                ),
            ),
        );
        this.refreshValues();
        this.updateActions();
    }

    /**
     * The empty row at the bottom: naming something there is how a parameter is added, which
     * needs no button and reads like the table growing a row.
     */
    private newRow() {
        const box = input({
            className: `${style.cell} ${style.field}`,
            placeholder: I18n.translate("variable.namePlaceholder") ?? "",
            onblur: (e: Event) => {
                const name = (e.target as HTMLInputElement).value.trim();
                if (name === "") return;
                this.content.add(name);
                this.render();
            },
            onkeydown: (e: KeyboardEvent) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            },
        });
        return div({ className: style.newRow }, div({ className: style.nameCell }, box));
    }

    private row(item: VariableData) {
        // Kept by id rather than looked up by position: refreshValues runs while editing and
        // must not depend on the row order.
        const value = this.valueCell(item);
        const row = div(
            { className: this.rowClassName(item, undefined) },
            this.nameCell(item),
            this.typeCell(item),
            value,
        );
        this.valueCells.set(item.id, value);
        this.rows.set(item.id, row);
        return row;
    }

    /** Selection and error are both a row's state, and both are repainted from scratch. */
    private rowClassName(item: VariableData, error: string | undefined): string {
        let className = style.row;
        if (item.id === this.selectedId) className += ` ${style.selected}`;
        if (error !== undefined) className += ` ${style.errorRow}`;
        return className;
    }

    /**
     * The value column, which is also where the expression is written: focused it shows what
     * was typed (`w * 2`), left alone it shows what that came to (`100`). One column for both,
     * because a parameter's expression and its value are the same thing seen twice.
     */
    private valueCell(item: VariableData) {
        return input({
            className: `${style.cell} ${style.field} ${style.value}`,
            value: item.expression,
            onfocus: (e: FocusEvent) => {
                const box = e.target as HTMLInputElement;
                box.value = this.current(item.id)?.expression ?? "";
                box.select();
            },
            onblur: (e: FocusEvent) => {
                const box = e.target as HTMLInputElement;
                if (box.value !== (this.current(item.id)?.expression ?? "")) {
                    this.content.setField(item.id, "expression", box.value);
                }
                this.refreshValues();
            },
            onkeydown: (e: KeyboardEvent) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            },
        });
    }

    /**
     * A row's data as it stands now. Controls are built from the `item` snapshot taken when
     * the row was rendered, and an edit refreshes only the value column rather than rebuilding
     * the rows — so a control asking "what was in this field?" must ask the table, not its own
     * closure, or it will hand back the value from before the last edit.
     */
    private current(id: string | undefined): VariableData | undefined {
        return this.content.items.find((x) => x.id === id);
    }

    /** The name, plus the marker that owns the description (see `editDescription`). */
    private nameCell(item: VariableData) {
        const marker = span({
            className: item.description ? `${style.marker} ${style.hasNote}` : style.marker,
            textContent: "•",
            title: item.description ?? new Localize("variable.addDescription"),
            onclick: (e: MouseEvent) => {
                e.stopPropagation();
                this.editDescription(item, e.target as HTMLElement);
            },
        });
        return div(
            { className: style.nameCell },
            this.textCell(item, "name", "variable.namePlaceholder"),
            marker,
        );
    }

    /**
     * The description lives behind the row's marker rather than in a column of its own: it is
     * an optional note, and a cell for it made every row wider for nothing. The marker carries
     * the text as a title (hover) and opens a small editor on click.
     */
    private editDescription(item: VariableData, anchor: HTMLElement) {
        const box = input({
            className: style.noteInput,
            value: item.description ?? "",
            placeholder: I18n.translate("variable.descriptionPlaceholder") ?? "",
            onblur: () => this.commitDescription(item, box.value, popup),
            onkeydown: (e: KeyboardEvent) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            },
        });
        const popup = div({ className: style.notePopup }, box);
        // Fixed placement so the panel's own scrolling cannot clip it.
        const rect = anchor.getBoundingClientRect();
        popup.style.left = `${rect.left}px`;
        popup.style.top = `${rect.bottom + 4}px`;
        this.popup = popup;
        window.document.body.append(popup);
        box.focus();
        box.select();
    }

    private commitDescription(item: VariableData, value: string, popup: HTMLElement) {
        popup.remove();
        this.popup = undefined;
        if (value === (item.description ?? "")) return;
        this.content.setField(item.id, "description", value);
        this.render();
    }

    private textCell(item: VariableData, key: "name" | "expression", placeholder: I18nKeys) {
        return input({
            className: `${style.cell} ${style.field}`,
            value: item[key] ?? "",
            // `placeholder` is a plain string attribute — no reactive binding to hand it.
            placeholder: I18n.translate(placeholder) ?? "",
            // Names and expressions are code; red spellcheck squiggles are noise there.
            spellcheck: false,
            // Committed on the way out, not on every keystroke: a field is one undo step, and
            // a half-typed name never reaches the document. Same as the feature panel's rows.
            onblur: (e: Event) => {
                const value = (e.target as HTMLInputElement).value;
                const current = this.current(item.id);
                if (current === undefined || value === (current[key] ?? "")) return;
                this.content.setField(item.id, key, value);
                this.refreshValues();
            },
            onkeydown: (e: KeyboardEvent) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            },
        });
    }

    private typeCell(item: VariableData) {
        const types = select({
            className: `${style.cell} ${style.field}`,
            onchange: (e: Event) => {
                this.content.setType(item.id, (e.target as HTMLSelectElement).value as VariableType);
                this.refreshValues();
            },
        });
        for (const type of TYPES) {
            types.append(
                option({
                    value: type.value,
                    textContent: new Localize(type.label),
                    selected: type.value === item.type,
                }),
            );
        }
        return types;
    }

    /**
     * The title bar's contents: the three actions on the selected row, and nothing at all
     * when no row is selected. The ends of the table are read off the table rather than
     * cached, so the arrows are already right after a move or an undo.
     */
    private updateActions(): void {
        const id = this.selectedId;
        const index = this.content.items.findIndex((x) => x.id === id);
        if (id === undefined || index < 0) {
            this.actionsBar.replaceChildren();
            return;
        }
        this.actionsBar.replaceChildren(
            this.iconButton("icon-up", "variable.moveUp", index === 0, () => this.move(id, -1, 0)),
            this.iconButton("icon-down", "variable.moveDown", index === this.content.items.length - 1, () =>
                this.move(id, 1, 1),
            ),
            this.iconButton(
                "icon-trash",
                "variable.delete",
                false,
                () => {
                    this.content.remove(id);
                    this.render();
                },
                style.danger,
            ),
        );
    }

    /** A move rebuilds the table; hand focus back to the same arrow so repeated presses keep working. */
    private move(id: string, offset: -1 | 1, arrow: 0 | 1): void {
        this.content.move(id, offset);
        this.render();
        this.actionsBar.querySelectorAll("button")[arrow]?.focus();
    }

    private iconButton(
        icon: string,
        title: I18nKeys,
        disabled: boolean,
        onclick: () => void,
        className = "",
    ) {
        return button(
            {
                className: className === "" ? style.iconButton : `${style.iconButton} ${className}`,
                title: new Localize(title),
                disabled,
                onclick,
            },
            svg({ icon }),
        );
    }

    /**
     * Fills the Value column and the error decorations. That cell is the row's single piece of
     * feedback: a row that fails to resolve (bad name, unknown identifier, wrong unit) shows
     * its message there in place of a value and the row is tinted, exactly where the user is
     * looking — and the same check is what gates the dialog's confirm.
     */
    private refreshValues(evaluated: EvaluatedVariables = this.content.evaluate()): void {
        for (const item of this.content.items) {
            const cell = this.valueCells.get(item.id);
            const row = this.rows.get(item.id);
            if (cell === undefined || row === undefined) continue;
            // The focused box belongs to whoever is typing in it — until they leave, it shows
            // the expression rather than the value.
            if (window.document.activeElement === cell) continue;
            const error = evaluated.errors.get(item.id);
            const value = evaluated.scope.get(item.name)?.value;
            cell.value = error ?? (value === undefined ? "" : this.formatValue(value));
            cell.className =
                error === undefined
                    ? `${style.cell} ${style.field} ${style.value}`
                    : `${style.cell} ${style.field} ${style.value} ${style.error}`;
            // The cell shows what the expression came to; hovering reveals the expression.
            cell.title = error ?? item.expression;
            row.className = this.rowClassName(item, error);
        }
    }

    /**
     * Just the number: the app has no unit system to name one from. A length and an angle are
     * both plain numbers here — the type says how a value is checked, not what it is called.
     */
    private formatValue(value: number): string {
        // Four decimals is enough to judge a parameter without burying the number in noise.
        return String(Math.round(value * 1e4) / 1e4);
    }
}

// Required before `new VariablesEditor(...)`: the constructor of an HTMLElement subclass
// throws "new.target does not define a custom element" until it is registered.
customElements.define("chili-variables-editor", VariablesEditor);
