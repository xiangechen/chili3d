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
} from "@chili3d/core";
import type { Tool } from "../llm/types";
import { findNode, requireDocument, requireNode } from "./documentContext";
import { describeProperties, prepareUpdates } from "./propertyBag";

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

function describeNode(node: INode, doc: IDocument) {
    const properties = describeProperties(node, panelProperties(node), doc);

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

    const requested = (args["properties"] ?? {}) as Record<string, unknown>;
    const updates = prepareUpdates(node, panelProperties(node), doc, requested, "this node");
    if (typeof updates === "string") return updates;

    applyUpdates(doc, node, updates);
    return JSON.stringify({
        id,
        updated: describeNode(node, doc).properties.filter((p) => updates.has(p.name)),
    });
};

export function buildPropertyTools(): Tool[] {
    return [getNodePropertiesTool(), setNodePropertiesTool()];
}
