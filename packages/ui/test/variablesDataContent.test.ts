// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { VariableData, VariableType } from "@chili3d/core";
import { TestDocument } from "@chili3d/core/test-utils";
import { describe, expect, rs, test } from "@rstest/core";
import { VariablesDataContent } from "../src/property/variables/variablesDataContent";

function variable(id: string, name: string, expression: string, type: VariableType = "length"): VariableData {
    return { id, name, expression, type };
}

function contentWith(items: VariableData[]) {
    const document = new TestDocument();
    document.history.disabled = true;
    document.variables.setItems(items);
    document.history.disabled = false;
    const onApplied = rs.fn();
    return { document, onApplied, content: new VariablesDataContent(document, onApplied) };
}

describe("VariablesDataContent", () => {
    test("writes an edit straight through, as one undo step", () => {
        const { document, content, onApplied } = contentWith([variable("v1", "w", "50")]);

        content.setField("v1", "expression", "60");

        expect(document.variables.items[0].expression).toBe("60");
        expect(document.history.undoCount()).toBe(1);
        expect(onApplied).toHaveBeenCalledTimes(1);
    });

    test("undoing a write restores the previous table", async () => {
        const { document, content } = contentWith([variable("v1", "w", "50")]);
        content.setField("v1", "expression", "60");

        await document.history.undo();

        expect(document.variables.items[0].expression).toBe("50");
    });

    test("stores a row that does not resolve as written, and reports it", () => {
        const { document, content } = contentWith([]);
        const id = content.add("w");

        content.setField(id, "name", "w");
        content.setField(id, "expression", "nope");

        // Refusing the keystroke would make a new name impossible to type; the table carries
        // the error instead, and the bodies reading it keep their last good shape.
        expect(document.variables.items[0].expression).toBe("nope");
        expect(content.evaluate().errors.get(id)).toBe("Unknown identifier: nope");
    });

    test("appends a blank row and returns its id", () => {
        const { document, content } = contentWith([]);

        const id = content.add("w");

        expect(document.variables.items).toHaveLength(1);
        expect(document.variables.items[0]).toMatchObject({ id, name: "w", type: "length", expression: "0" });
    });

    test("removes a row by id", () => {
        const { document, content } = contentWith([variable("v1", "w", "1"), variable("v2", "h", "2")]);

        content.remove("v1");

        expect(document.variables.items.map((x) => x.id)).toEqual(["v2"]);
    });

    test("reorders rows, since a variable may reference the ones above it", () => {
        const { document, content } = contentWith([variable("v2", "h", "w * 2"), variable("v1", "w", "1")]);
        // `h` sits above `w`, so it cannot resolve; moving it below restores the order.
        expect(content.evaluate().errors.get("v2")).toBe("Unknown identifier: w");

        content.move("v2", 1);

        expect(document.variables.items.map((x) => x.id)).toEqual(["v1", "v2"]);
        expect(content.evaluate().errors.size).toBe(0);
    });

    test("ignores a move that would fall off either end", () => {
        const { document, content } = contentWith([variable("v1", "w", "1")]);

        content.move("v1", -1);
        content.move("v1", 1);

        expect(document.variables.items.map((x) => x.id)).toEqual(["v1"]);
    });

    test("a type change is what fixes a quantity mismatch", () => {
        const { document, content } = contentWith([
            variable("v1", "a", "45", "angle"),
            variable("v2", "bad", "a", "length"),
        ]);
        expect(content.evaluate().errors.get("v2")).toBe("Dimension mismatch: expected length, got angle");

        content.setType("v2", "angle");

        expect(content.evaluate().errors.size).toBe(0);
        expect(document.variables.items[1].type).toBe("angle");
    });
});
