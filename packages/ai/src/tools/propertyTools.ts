// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    I18n,
    type IDocument,
    type INode,
    isConsumedTool,
    Node,
    type Property,
    PropertyUtils,
    PubSub,
    Transaction,
    XY,
    XYZ,
} from "@chili3d/core";
import type { Tool } from "../llm/types";
import { findNode, requireDocument, requireNode } from "./documentContext";

/**
 * Property kinds as the model sees them. Mirrors what the property panel can render: the panel
 * picks a control from `Property.type` first (color/materialId) and from the value's class
 * otherwise, and warns + skips anything else — so the AI reads and writes the same set.
 */
type PropertyKind = "number" | "string" | "boolean" | "xyz" | "xy" | "color" | "materialId" | "unsupported";

/**
 * The properties the panel shows for a node, in its order: the ones Node itself declares
 * (name) and then the node type's own (a box's dx/dy/dz, a circle's radius, …).
 */
function panelProperties(node: INode): Property[] {
    return [
        ...PropertyUtils.getOwnProperties(Node.prototype),
        ...PropertyUtils.getProperties(Object.getPrototypeOf(node), Node.prototype),
    ];
}

function kindOf(prop: Property, value: unknown): PropertyKind {
    if (prop.type === "color") return "color";
    if (prop.type === "materialId") return "materialId";
    if (typeof value === "number") return "number";
    if (typeof value === "string") return "string";
    if (typeof value === "boolean") return "boolean";
    if (value instanceof XYZ) return "xyz";
    if (value instanceof XY) return "xy";
    return "unsupported";
}

/** Plain-value form of a property, the same encodings the modeling tools take back. */
function encodeValue(kind: PropertyKind, value: unknown): unknown {
    if (kind === "xyz") {
        const xyz = value as XYZ;
        return { x: xyz.x, y: xyz.y, z: xyz.z };
    }
    if (kind === "xy") {
        const xy = value as XY;
        return { x: xy.x, y: xy.y };
    }
    return kind === "unsupported" ? undefined : value;
}

/** Whether the panel offers this property for editing — a getter without a setter is read-only. */
function hasSetter(node: INode, name: string): boolean {
    let target: object | null = node;
    while (target !== null) {
        const descriptor = Object.getOwnPropertyDescriptor(target, name);
        if (descriptor !== undefined) return typeof descriptor.set === "function";
        target = Object.getPrototypeOf(target);
    }
    return false;
}

function availableMaterialIds(doc: IDocument): string[] {
    return doc.modelManager.materials.map((material) => material.id);
}

/** A rejected write, in the shape the tool's error response takes. */
function rejectValue(prop: Property, expected: string): { error: string } {
    return { error: `"${prop.name}" takes ${expected}` };
}

function rejectionOf(value: unknown): string | undefined {
    return value !== null && typeof value === "object" && "error" in value
        ? (value as { error: string }).error
        : undefined;
}

/** Builds the geometry class a point property's setter assigns, or the rejection for a bad point. */
function coercePoint(prop: Property, kind: "xyz" | "xy", value: unknown): unknown {
    const point = value as { x?: unknown; y?: unknown; z?: unknown };
    const expected = kind === "xyz" ? "a point {x,y,z}" : "a point {x,y}";
    if (typeof point?.x !== "number" || typeof point.y !== "number") return rejectValue(prop, expected);
    if (kind === "xy") return new XY(point.x, point.y);
    return typeof point.z === "number" ? new XYZ(point.x, point.y, point.z) : rejectValue(prop, expected);
}

/** A material property may only name materials this document actually has. */
function coerceMaterialId(doc: IDocument, prop: Property, value: unknown): unknown {
    const ids = Array.isArray(value) ? value : [value];
    if (ids.length === 0 || !ids.every((id) => typeof id === "string")) {
        return rejectValue(prop, "a material id, or an array of them");
    }
    const known = availableMaterialIds(doc);
    const unknown = ids.filter((id) => !known.includes(id as string));
    return unknown.length > 0
        ? rejectValue(prop, `one of this document's materials (${known.join(", ")})`)
        : value;
}

/**
 * A property value from the model's JSON, coerced to what the property's setter expects. The
 * panel's converters do the same job for typed text; here the input is already JSON, so the
 * only real work is turning {x,y,z} into the geometry class the setter assigns.
 */
function coerceValue(doc: IDocument, prop: Property, kind: PropertyKind, value: unknown): unknown {
    if (kind === "number") return typeof value === "number" ? value : rejectValue(prop, "a number");
    if (kind === "string") return typeof value === "string" ? value : rejectValue(prop, "a string");
    if (kind === "boolean") return typeof value === "boolean" ? value : rejectValue(prop, "true or false");
    if (kind === "xyz" || kind === "xy") return coercePoint(prop, kind, value);
    if (kind === "materialId") return coerceMaterialId(doc, prop, value);
    // Material.color takes 0xRRGGBB or a CSS color string, exactly as the panel's picker gives it.
    if (kind === "color") {
        return typeof value === "number" || typeof value === "string"
            ? value
            : rejectValue(prop, "a color as 0xRRGGBB or a CSS string");
    }
    return rejectValue(prop, "a plain value — appearance properties are set with set_material");
}

function describeNode(node: INode, doc: IDocument) {
    const properties = panelProperties(node).map((prop) => {
        const value = (node as unknown as Record<string, unknown>)[prop.name];
        const kind = kindOf(prop, value);
        const encoded = encodeValue(kind, value);
        return {
            name: prop.name,
            label: I18n.translate(prop.display),
            kind,
            ...(encoded === undefined ? {} : { value: encoded }),
            ...(hasSetter(node, prop.name) ? {} : { readOnly: true }),
            // A material property is useless to write without knowing what may be assigned.
            ...(kind === "materialId" ? { options: availableMaterialIds(doc) } : {}),
        };
    });

    const display = (node as { display?: () => Parameters<typeof I18n.translate>[0] }).display;
    return {
        id: node.id,
        type: node.constructor.name,
        name: node.name,
        ...(display ? { display: I18n.translate(display.call(node)) } : {}),
        ...(isConsumedTool(node) ? { note: consumedToolNote(node) } : {}),
        properties,
    };
}

/**
 * A tool node the app consumed into a body (a boolean operand, a sketch a feature builds on)
 * is a rendering of that body's own feature data: the body re-generates from the features it
 * stores, never from this node. Both reading and writing here are misleading, so both say so.
 */
function consumedToolNote(node: INode): string {
    return `this node is a tool consumed by "${node.parent?.name ?? "its owner"}"; the owner rebuilds from its own feature list, so these values are not what drives the model — the owner's features are`;
}

function getNodePropertiesTool(): Tool {
    return {
        name: "get_node_properties",
        description:
            "Read the editable properties of nodes — the same rows the property panel shows: the node name, the material, and the parameters of the shape (a box's length/width/height, a circle's radius, …). Defaults to the selected nodes. Use it to answer what a node's dimensions currently are, or before set_node_properties to see the writable names.",
        parameters: {
            type: "object",
            properties: {
                ids: {
                    type: "array",
                    items: { type: "string" },
                    description: "Node ids (from get_document_state); omit for the selected nodes",
                },
            },
        },
        handler: getNodePropertiesHandler,
    };
}

const getNodePropertiesHandler: Tool["handler"] = async (args) => {
    const doc = requireDocument();
    if (typeof doc === "string") return doc;

    const requested = (args["ids"] as string[] | undefined) ?? [];
    const ids = requested.length > 0 ? requested : doc.selection.getSelectedNodes().map((n) => n.id);
    if (ids.length === 0) {
        return JSON.stringify({
            error: "no nodes given and nothing is selected — pass ids from get_document_state, then call again",
        });
    }

    const nodes = ids.map((id) => {
        const node = findNode(doc, id);
        return node === undefined ? { id, error: "node not found" } : describeNode(node, doc);
    });
    return JSON.stringify({ nodes });
};

function setNodePropertiesTool(): Tool {
    return {
        name: "set_node_properties",
        description:
            "Change a node's properties — what the property panel edits, and the panel updates to show it. Typical: a node's name, or a shape parameter (a box's dx/dy/dz, a circle's radius/center, a location). This keeps the node and its identity, unlike deleting and re-creating it. Read the writable names with get_node_properties first; appearance (color, opacity, texture) is set_material's job.",
        parameters: {
            type: "object",
            properties: {
                id: { type: "string", description: "Node id" },
                properties: {
                    type: "object",
                    description:
                        'Property name to new value, e.g. { "dx": 20, "name": "plate" }. A point property takes {x,y,z}.',
                },
            },
            required: ["id", "properties"],
        },
        handler: setNodePropertiesHandler,
    };
}

/** One requested write after checking: the value to assign, or the error response to return. */
type Prepared = { value: unknown } | { error: string; available?: string[] };

function prepareUpdate(
    node: INode,
    doc: IDocument,
    properties: Property[],
    name: string,
    value: unknown,
): Prepared {
    const prop = properties.find((p) => p.name === name);
    if (prop === undefined) {
        return {
            error: `"${name}" is not a property of this node`,
            available: properties.map((p) => p.name),
        };
    }
    if (!hasSetter(node, name)) {
        return { error: `"${name}" is read-only`, available: writableNames(node) };
    }
    const current = (node as unknown as Record<string, unknown>)[name];
    const coerced = coerceValue(doc, prop, kindOf(prop, current), value);
    const rejection = rejectionOf(coerced);
    return rejection === undefined ? { value: coerced } : { error: rejection };
}

/**
 * Validate every requested write against the node: the property has to exist, be writable, and
 * take the value given. Returns the values to assign, or the serialized error response.
 */
function prepareUpdates(
    node: INode,
    doc: IDocument,
    requested: Record<string, unknown>,
): Map<string, unknown> | string {
    const properties = panelProperties(node);
    const updates = new Map<string, unknown>();

    for (const [name, value] of Object.entries(requested)) {
        const prepared = prepareUpdate(node, doc, properties, name, value);
        if ("error" in prepared) return JSON.stringify(prepared);
        updates.set(name, prepared.value);
    }

    if (updates.size === 0) {
        return JSON.stringify({ error: "no properties given", available: writableNames(node) });
    }
    return updates;
}

/** Assign the values and refresh the panel, the way the property panel itself writes. */
function applyUpdates(doc: IDocument, node: INode, updates: Map<string, unknown>): void {
    // Assignment inside one transaction, so a parameter edit is a single undo step and the
    // node re-generates its shape.
    Transaction.execute(doc, "AI set node properties", () => {
        for (const [name, value] of updates) {
            (node as unknown as Record<string, unknown>)[name] = value;
        }
        doc.visual.update();
    });

    // A property change is not a selection change, which is what the panel rebuilds on, so it
    // has to be republished — otherwise it keeps showing the values it was built with.
    PubSub.default.pub("showProperties", doc, doc.selection.getSelectedNodes());
}

const setNodePropertiesHandler: Tool["handler"] = async (args) => {
    const doc = requireDocument();
    if (typeof doc === "string") return doc;
    const id = args["id"] as string;
    const node = requireNode(doc, id);
    if (typeof node === "string") return node;
    // Writing here would look like it worked and change nothing, which is worse than refusing:
    // the owner only ever replays its own features.
    if (isConsumedTool(node)) {
        return JSON.stringify({
            error: `cannot set properties on a consumed tool: ${consumedToolNote(node)}. Change the parameter on that owner instead (or have the user edit the feature in the property panel).`,
        });
    }

    const updates = prepareUpdates(node, doc, (args["properties"] ?? {}) as Record<string, unknown>);
    if (typeof updates === "string") return updates;

    applyUpdates(doc, node, updates);
    return JSON.stringify({
        id,
        updated: describeNode(node, doc).properties.filter((p) => updates.has(p.name)),
    });
};

function writableNames(node: INode): string[] {
    return panelProperties(node)
        .filter((prop) => hasSetter(node, prop.name))
        .map((prop) => prop.name);
}

export function buildPropertyTools(): Tool[] {
    return [getNodePropertiesTool(), setNodePropertiesTool()];
}
