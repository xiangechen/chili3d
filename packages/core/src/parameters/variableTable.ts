// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument } from "../document";
import { Logger } from "../foundation/logger";
import { HistoryObservable, type IPropertyChanged } from "../foundation/observer";
import { type EvaluatedValue, isConstantName, resolveUnitSpec, type Scope } from "./expression";
import { isVariableType, unitSpecOfType, type VariableType } from "./unitSpec";

const NAME_PATTERN = /^[A-Za-z_]\w*$/;

/** One document-level parameter: a named, typed value usable across the whole document. */
export interface VariableData {
    readonly id: string;
    readonly name: string;
    /** The unit the user declares; an expression must resolve to it (or be unitless). */
    readonly type: VariableType;
    readonly expression: string;
    readonly description?: string;
}

/** One pass of the table: what resolved, and what did not. */
export interface EvaluatedVariables {
    readonly scope: Scope;
    /** Variable id → the message shown on its row. */
    readonly errors: ReadonlyMap<string, string>;
}

/**
 * Resolves the table in order — a variable may reference the ones above it, never
 * below (that is what keeps a cycle impossible without a graph walk). A variable
 * that fails to resolve is left out of the scope and reported in `errors`, so one
 * bad row does not take the rest of the table down with it.
 *
 * Pure: the parameters dialog previews a draft table by calling this directly.
 */
export function evaluateVariables(items: readonly VariableData[]): EvaluatedVariables {
    const scope = new Map<string, EvaluatedValue>();
    const errors = new Map<string, string>();
    const defined = new Set<string>();
    for (const item of items) {
        // A row that is not an object at all has no id to report against — skip it rather
        // than let it take down the pass every other row depends on.
        if (item === null || typeof item !== "object") continue;
        const error = evaluateVariable(item, scope, defined);
        if (error !== undefined) errors.set(String(item.id), error);
    }
    return { scope, errors };
}

/** Resolves one variable into `scope`; returns the error message when it cannot. */
function evaluateVariable(
    item: VariableData,
    scope: Map<string, EvaluatedValue>,
    defined: Set<string>,
): string | undefined {
    // The fields are typed by the interface but arrive from JSON — a hand-edited or
    // truncated table entry must report on its own row, not throw on `name.length`.
    if (typeof item.name !== "string" || !NAME_PATTERN.test(item.name)) {
        return `Invalid variable name: ${String(item.name)}`;
    }
    if (isConstantName(item.name)) return `Variable name shadows a constant: ${item.name}`;
    if (defined.has(item.name)) return `Duplicate variable name: ${item.name}`;
    if (!isVariableType(item.type)) return `Unknown variable type: ${String(item.type)}`;
    if (typeof item.expression !== "string") return `Missing expression: ${item.name}`;

    // The declared unit, not the expression's — `w = 5` is a length because the
    // user said so, which is what makes `sin(a)` work when `a` is declared an angle.
    const declared = unitSpecOfType(item.type);
    const resolved = resolveUnitSpec(item.expression, scope, declared);
    if (!resolved.isOk) return resolved.error;
    scope.set(item.name, { value: resolved.value, unit: declared });
    defined.add(item.name);
    return undefined;
}

/** The document's shared parameter table. */
export interface IVariableTable extends IPropertyChanged {
    readonly document: IDocument;
    /** Ordered: a variable may reference the ones declared above it. */
    readonly items: readonly VariableData[];
    get variablesJson(): string;
    set variablesJson(value: string);
    /** Bumped by every effective write, undo and redo included. Consumers de-duplicate on it. */
    readonly revision: number;
    /** One write, one notification, one undo step. */
    setItems(items: readonly VariableData[]): void;
    evaluate(): EvaluatedVariables;
}

/**
 * `HistoryObservable` rather than plain `Observable`: its `setProperty` records a
 * `PropertyHistoryRecord`, so a write here is a single undo step for free. The value
 * travels as a JSON string (like a node's `featuresJson`) so undo can assign it back
 * through the setter without knowing the shape.
 */
export class VariableTable extends HistoryObservable implements IVariableTable {
    private _revision = 0;

    constructor(document: IDocument) {
        super(document);
        this.setPrivateValue("variablesJson", "[]");
    }

    get variablesJson(): string {
        return this.getPrivateValue("variablesJson");
    }

    set variablesJson(value: string) {
        if (this.setProperty("variablesJson", value)) this._revision++;
    }

    get items(): readonly VariableData[] {
        // Loaded documents, undo records and the setter all reach this string. A corrupt
        // one must leave the table empty, not throw out of every reader — the panel's
        // `evaluate`, and the scope every command resolves its parameters against.
        let parsed: unknown;
        try {
            parsed = JSON.parse(this.variablesJson);
        } catch (error) {
            Logger.error("variable table: the stored table is not readable", error);
            return [];
        }
        if (Array.isArray(parsed)) return parsed as VariableData[];
        Logger.error(`variable table: the stored table is a ${typeof parsed}, not a list`);
        return [];
    }

    get revision(): number {
        return this._revision;
    }

    setItems(items: readonly VariableData[]): void {
        this.variablesJson = JSON.stringify(items);
    }

    evaluate(): EvaluatedVariables {
        return evaluateVariables(this.items);
    }
}
