// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type EvaluatedVariables,
    evaluateVariables,
    type IDocument,
    Id,
    Transaction,
    type VariableData,
    type VariableType,
} from "@chili3d/core";

/** The fields the table edits in place; `id` and `type` have their own setters. */
type VariableField = "name" | "expression" | "description";

/**
 * The parameters panel's edit state, writing straight through to the document.
 *
 * There is no draft: a floating panel exists so the geometry stays visible while the table is
 * edited, which is only worth anything if the edit has already landed. Each change is one
 * transaction and so one undo step — the same contract the feature panel's rows have.
 *
 * A row that does not resolve is stored AS WRITTEN rather than refused. The table carries its
 * own errors (`evaluate`), and a body reading a broken parameter fails the way a body reading a
 * deleted sketch does: the last good shape stays on screen. Refusing the keystroke instead
 * would make a new variable's name impossible to type — `w` is undefined until it is not.
 */
export class VariablesDataContent {
    private _writing = false;

    constructor(
        readonly document: IDocument,
        private readonly onApplied: () => void,
    ) {}

    /**
     * True while one of this panel's own writes is in flight. The write notifies
     * synchronously from inside `setItems`, so anything listening has to look at this to
     * tell its own change from someone else's — a revision recorded after the write lands
     * is already too late. See `VariablesEditor`.
     */
    get isWriting(): boolean {
        return this._writing;
    }

    get items(): readonly VariableData[] {
        return this.document.variables.items;
    }

    /** What the table evaluates to — the value column and the per-row errors. */
    evaluate(): EvaluatedVariables {
        return evaluateVariables(this.items);
    }

    /**
     * Appends a parameter. It starts at `0` rather than empty: the new row is usable the
     * moment it is named, and an empty expression would only show as an error.
     */
    add(name: string): string {
        const item: VariableData = { id: Id.generate(), name, type: "length", expression: "0" };
        this.write([...this.items, item]);
        return item.id;
    }

    remove(id: string): void {
        this.write(this.items.filter((x) => x.id !== id));
    }

    /** Reorders a row; the table is ordered because a variable may reference the ones above it. */
    move(id: string, offset: -1 | 1): void {
        const index = this.items.findIndex((x) => x.id === id);
        const target = index + offset;
        if (index < 0 || target < 0 || target >= this.items.length) return;
        const next = [...this.items];
        [next[index], next[target]] = [next[target], next[index]];
        this.write(next);
    }

    setField(id: string, key: VariableField, value: string): void {
        const next = this.items.map((x) => (x.id === id ? { ...x, [key]: value } : x));
        this.write(next);
    }

    setType(id: string, type: VariableType): void {
        this.write(this.items.map((x) => (x.id === id ? { ...x, type } : x)));
    }

    /** One write, one transaction, one undo step. */
    private write(items: readonly VariableData[]): void {
        this._writing = true;
        try {
            Transaction.execute(this.document, "edit variables", () => {
                this.document.variables.setItems(items);
            });
        } finally {
            this._writing = false;
        }
        this.onApplied();
    }
}
