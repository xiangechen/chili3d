// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IDocument, Id, Transaction, type VariableData, type VariableType } from "@chili3d/core";
import type { Tool } from "../llm/types";
import { requireDocument } from "./documentContext";

/**
 * The document's named parameters, as the model sees them: declared fields plus what each
 * row currently resolves to. A row that does not resolve is still returned — the table is
 * designed to keep a bad row from taking the rest down, so its `error` is the answer, not
 * an exception.
 */
function variableRows(document: IDocument) {
    const { scope, errors } = document.variables.evaluate();
    return document.variables.items.map((item) => ({
        name: item.name,
        type: item.type,
        expression: item.expression,
        description: item.description,
        value: scope.get(item.name)?.value,
        error: errors.get(item.id),
    }));
}

/** One entry as it arrives from the model — every field is unknown until it is checked. */
interface VariableInput {
    name?: unknown;
    type?: unknown;
    expression?: unknown;
    description?: unknown;
}

/**
 * Upserts by name: an existing variable keeps its id and its position in the table, so
 * variables declared below it keep resolving. A new one is appended, which is what makes
 * it visible to later rows and to nothing else.
 */
function upsert(document: IDocument, incoming: readonly VariableInput[]): void {
    const items = [...document.variables.items];
    for (const raw of incoming) {
        const name = requireString(raw.name, "name");
        const type = requireType(raw.type);
        const expression = requireString(raw.expression, "expression");
        const index = items.findIndex((item) => item.name === name);
        const entry: VariableData = {
            id: items[index]?.id ?? Id.generate(),
            name,
            type,
            expression,
            ...(raw.description === undefined
                ? {}
                : { description: requireString(raw.description, "description") }),
        };
        if (index < 0) items.push(entry);
        else items[index] = entry;
    }
    document.variables.setItems(items);
}

function remove(document: IDocument, names: readonly unknown[]): void {
    const doomed = new Set(names.map((name) => requireString(name, "names[]")));
    document.variables.setItems(document.variables.items.filter((item) => !doomed.has(item.name)));
}

function requireString(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim() === "") {
        throw new Error(`"${field}" is required and must be a non-empty string`);
    }
    return value;
}

function requireType(value: unknown): VariableType {
    if (value === "length" || value === "angle" || value === "unitless") return value;
    throw new Error(`"type" must be length, angle or unitless, got ${JSON.stringify(value)}`);
}

function requireArray<T>(value: unknown, field: string): readonly T[] {
    if (!Array.isArray(value) || value.length === 0) {
        throw new Error(`"${field}" is required and must be a non-empty array`);
    }
    return value as readonly T[];
}

const ACTION = { list: "list", set: "set", remove: "remove" } as const;

export function buildVariableTools(): Tool[] {
    return [
        {
            name: "document_variables",
            description: `Read and write the document's named parameters — the values a feature parameter can reference by name instead of repeating a number. Actions: "list" (default) returns every variable with what it resolves to and any error; "set" upserts the given entries by name, leaving the others alone; "remove" drops the given names. A variable is ordered: its expression may reference the variables declared ABOVE it and no others, so declare a value before the one that uses it. type is length | angle | unitless and decides what the expression must resolve to. The expression syntax is + - * / %, parentheses, other variable names, pi and e, and abs/sqrt/floor/ceil/round/min/max/sin/cos/tan/asin/acos/atan/atan2 — angles are in degrees throughout. Feature parameters (run_parametric's depth, radius, distance, angle, startOffset) accept an expression string naming a variable instead of a number, which is the point of the table: one edit re-drives every feature that references it.`,
            parameters: {
                type: "object",
                properties: {
                    action: {
                        type: "string",
                        enum: [ACTION.list, ACTION.set, ACTION.remove],
                        description: "Defaults to list",
                    },
                    variables: {
                        type: "array",
                        description: "set: entries to write, matched to existing ones by name",
                        items: {
                            type: "object",
                            properties: {
                                name: { type: "string", description: "Identifier, e.g. width" },
                                type: {
                                    type: "string",
                                    enum: ["length", "angle", "unitless"],
                                    description: "What the expression must resolve to",
                                },
                                expression: {
                                    type: "string",
                                    description: 'A number ("40"), or an expression ("width * 2")',
                                },
                                description: { type: "string" },
                            },
                            required: ["name", "type", "expression"],
                        },
                    },
                    names: {
                        type: "array",
                        items: { type: "string" },
                        description: "remove: the variables to drop",
                    },
                },
                required: ["action"],
            },
            handler: handleVariables,
        },
    ];
}

async function handleVariables(args: Record<string, unknown>): Promise<string> {
    const document = requireDocument();
    if (typeof document === "string") return document;

    const action = args["action"] ?? ACTION.list;
    if (action !== ACTION.list && action !== ACTION.set && action !== ACTION.remove) {
        throw new Error(`unknown action ${JSON.stringify(action)} — expected list, set or remove`);
    }

    if (action !== ACTION.list) {
        Transaction.execute(document, `AI variables: ${action}`, () => {
            if (action === ACTION.set) {
                upsert(document, requireArray<VariableInput>(args["variables"], "variables"));
            } else {
                remove(document, requireArray<unknown>(args["names"], "names"));
            }
            document.visual.update();
        });
    }
    return JSON.stringify({ variables: variableRows(document) });
}
