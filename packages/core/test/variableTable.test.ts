// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    ANGLE_UNITS,
    LENGTH_UNITS,
    Transaction,
    UNITLESS,
    type VariableData,
    type VariableTable,
} from "../src";
import { TestDocument } from "../test-utils";

function variable(id: string, name: string, expression: string, overrides: Partial<VariableData> = {}) {
    return { id, name, expression, type: "length" as const, ...overrides };
}

function tableWith(...items: VariableData[]): { document: TestDocument; table: VariableTable } {
    const document = new TestDocument();
    // Seeding is setup, not an edit — keep it out of the undo stack.
    document.history.disabled = true;
    document.variables.setItems(items);
    document.history.disabled = false;
    return { document, table: document.variables as VariableTable };
}

describe("evaluateVariables", () => {
    test("resolves in order, so a variable may reference the ones above it", () => {
        const { document } = tableWith(
            variable("v1", "w", "50"),
            variable("v2", "h", "w / 2"),
            variable("v3", "third", "h + w"),
        );
        const { scope, errors } = document.variables.evaluate();
        expect(errors.size).toBe(0);
        expect(scope.get("w")?.value).toBe(50);
        expect(scope.get("h")?.value).toBe(25);
        expect(scope.get("third")?.value).toBe(75);
    });

    test("a variable carries its DECLARED unit, not the expression's", () => {
        // `5` on its own is unitless; declaring it a length is what makes it usable
        // as one (and what makes `sin(...)` reject it).
        const { document } = tableWith(variable("v1", "w", "5"), variable("v2", "r", "w / w"));
        const { scope } = document.variables.evaluate();
        expect(scope.get("w")?.unit).toEqual(LENGTH_UNITS);
        expect(scope.get("r")?.unit).toEqual(LENGTH_UNITS);
    });

    test("reports a forward reference instead of resolving it", () => {
        const { document } = tableWith(variable("v1", "h", "w / 2"), variable("v2", "w", "50"));
        const { scope, errors } = document.variables.evaluate();
        expect(errors.get("v1")).toBe("Unknown identifier: w");
        expect(scope.has("h")).toBe(false);
        // The rest of the table still resolves — one bad row is not fatal.
        expect(scope.get("w")?.value).toBe(50);
    });

    test("rejects a name that is not an identifier", () => {
        const { document } = tableWith(variable("v1", "1bad", "10"));
        expect(document.variables.evaluate().errors.get("v1")).toBe("Invalid variable name: 1bad");
    });

    test("rejects shadowing a constant", () => {
        const { document } = tableWith(variable("v1", "pi", "3.2"));
        expect(document.variables.evaluate().errors.get("v1")).toBe("Variable name shadows a constant: pi");
    });

    test("rejects a duplicate name", () => {
        const { document } = tableWith(variable("v1", "w", "1"), variable("v2", "w", "2"));
        const { scope, errors } = document.variables.evaluate();
        expect(errors.get("v2")).toBe("Duplicate variable name: w");
        expect(scope.get("w")?.value).toBe(1);
    });

    test("rejects an expression whose unit contradicts the declared one", () => {
        const { document } = tableWith(
            variable("v1", "a", "45", { type: "angle" }),
            variable("v2", "bad", "a", { type: "length" }),
        );
        const { errors } = document.variables.evaluate();
        expect(errors.get("v2")).toBe("Dimension mismatch: expected length, got angle");
    });

    test("accepts a unitless expression for any declared unit", () => {
        const { document } = tableWith(
            variable("v1", "w", "50"),
            variable("v2", "ratio", "w / w", { type: "unitless" }),
            variable("v3", "a", "w / w", { type: "angle" }),
        );
        const { scope, errors } = document.variables.evaluate();
        expect(errors.size).toBe(0);
        expect(scope.get("ratio")?.unit).toEqual(UNITLESS);
        expect(scope.get("a")?.unit).toEqual(ANGLE_UNITS);
        expect(scope.get("a")?.value).toBe(1);
    });
});

describe("a table that arrives malformed", () => {
    /**
     * The stored table is JSON — from a file, an undo record, or a hand edit. None of it is
     * typed, and a document must still open: a bad row reports on itself, and a bad table
     * reads as empty. Before, either one threw out of every reader.
     */
    function rawTable(json: string): VariableTable {
        const document = new TestDocument();
        document.history.disabled = true;
        document.variables.variablesJson = json;
        document.history.disabled = false;
        return document.variables as VariableTable;
    }

    const good = { id: "v0", name: "w", expression: "50", type: "length" };

    test("an unreadable table reads as empty", () => {
        const table = rawTable("{ not json");
        expect(table.items).toEqual([]);
        expect(table.evaluate().scope.size).toBe(0);
    });

    test("a stored value that is not a list reads as empty", () => {
        const table = rawTable(JSON.stringify({ w: 50 }));
        expect(table.items).toEqual([]);
        expect(table.evaluate().scope.size).toBe(0);
    });

    test.each<{ row: Record<string, unknown>; error: string }>([
        { row: { id: "v1", name: "a", type: "length" }, error: "Missing expression: a" },
        { row: { id: "v2", name: "b", expression: "10" }, error: "Unknown variable type: undefined" },
        {
            row: { id: "v3", name: "c", expression: "10", type: "Length" },
            error: "Unknown variable type: Length",
        },
        { row: { id: "v4", expression: "10", type: "length" }, error: "Invalid variable name: undefined" },
    ])("reports `$error` on its own row", ({ row, error }) => {
        const evaluated = rawTable(JSON.stringify([good, row])).evaluate();
        expect(evaluated.errors.get(String(row["id"]))).toBe(error);
        // The row above it is unaffected — the error stays on the row that has it.
        expect(evaluated.scope.get("w")?.value).toBe(50);
    });

    test("a row that is not an object is skipped, not fatal", () => {
        const evaluated = rawTable(JSON.stringify([null, good])).evaluate();
        expect(evaluated.errors.size).toBe(0);
        expect(evaluated.scope.get("w")?.value).toBe(50);
    });

    test("a parameter may be named after an Object.prototype member", () => {
        // `constructor` shadows nothing — only `pi` and `e` are reserved.
        const table = rawTable(JSON.stringify([{ ...good, name: "constructor" }]));
        expect(table.evaluate().errors.size).toBe(0);
        expect(table.evaluate().scope.get("constructor")?.value).toBe(50);
    });
});

describe("VariableTable", () => {
    test("starts empty", () => {
        const document = new TestDocument();
        expect(document.variables.items).toEqual([]);
        expect(document.variables.evaluate().scope.size).toBe(0);
    });

    test("round-trips through variablesJson, description included", () => {
        const items = [variable("v1", "w", "50", { description: "总宽" })];
        const { document, table } = tableWith(...items);
        expect(JSON.parse(table.variablesJson)).toEqual(items);
        table.variablesJson = JSON.stringify([...items, variable("v2", "h", "10")]);
        expect(document.variables.items).toHaveLength(2);
    });

    test("bumps the revision on every effective write", () => {
        const { table } = tableWith();
        const initial = table.revision;
        table.setItems([variable("v1", "w", "1")]);
        expect(table.revision).toBe(initial + 1);
        table.setItems([variable("v1", "w", "2")]);
        expect(table.revision).toBe(initial + 2);
        // A write that does not change the value is not an effective write.
        table.setItems([variable("v1", "w", "2")]);
        expect(table.revision).toBe(initial + 2);
    });

    test("notifies once per write", () => {
        const { table } = tableWith();
        let notified = 0;
        table.onPropertyChanged((property) => {
            if (property === "variablesJson") notified++;
        });
        table.setItems([variable("v1", "w", "1")]);
        expect(notified).toBe(1);
    });

    test("records one undo step per write, and undo restores the previous table", async () => {
        const { document, table } = tableWith(variable("v1", "w", "1"));
        Transaction.execute(document, "edit variables", () => {
            table.setItems([variable("v1", "w", "1"), variable("v2", "h", "2")]);
        });
        expect(table.items).toHaveLength(2);
        expect(document.history.undoCount()).toBe(1);

        await document.history.undo();
        expect(table.items).toHaveLength(1);
        expect(document.variables.evaluate().scope.get("w")?.value).toBe(1);

        await document.history.redo();
        expect(table.items).toHaveLength(2);
        expect(document.variables.evaluate().scope.get("h")?.value).toBe(2);
    });

    test("undo bumps the revision too, so consumers re-sync", async () => {
        const { document, table } = tableWith(variable("v1", "w", "1"));
        const before = table.revision;
        Transaction.execute(document, "edit variables", () => {
            table.setItems([variable("v1", "w", "2")]);
        });
        await document.history.undo();
        expect(table.revision).toBeGreaterThan(before + 1);
    });

    test("stops notifying once the handler is removed", () => {
        const { table } = tableWith();
        let notified = 0;
        const handler = () => notified++;
        table.onPropertyChanged(handler);
        table.setItems([variable("v1", "w", "1")]);
        expect(notified).toBe(1);
        table.removePropertyChanged(handler);
        table.setItems([variable("v1", "w", "2")]);
        expect(notified).toBe(1);
    });
});
