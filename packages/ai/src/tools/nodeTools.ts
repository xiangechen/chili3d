// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { I18n, type IDocument, type INode, isConsumedTool, Matrix4, Transaction } from "@chili3d/core";
import type { Tool } from "../llm/types";
import { buildTransformMatrix, VEC3_SCHEMA } from "./transformMatrix";

function getDocument(): IDocument | undefined {
    return globalThis.app.activeView?.document;
}

function findNode(doc: IDocument, id: string) {
    return doc.modelManager.findNodes((n) => n.id === id)[0];
}

/** Active document, or the serialized error response when no document is open. */
function requireDocument(): IDocument | string {
    return getDocument() ?? JSON.stringify({ error: I18n.translate("ai.error.noDocument") });
}

/** Node with the given id, or the serialized error response when it does not exist. */
function requireNode(doc: IDocument, id: string): INode | string {
    return (
        findNode(doc, id) ??
        JSON.stringify({
            error: `node not found: ${id} — it may have been consumed by an edit-style run_program op (e.g. booleanCut) or deleted; the consumed nodes are listed in run_program's "removed". Call get_document_state for the current node list instead of retrying.`,
        })
    );
}

const TRANSFORM_NODE_PARAMETERS = {
    type: "object",
    properties: {
        id: { type: "string", description: "Node id" },
        translate: { ...VEC3_SCHEMA, description: "Translation in mm" },
        rotate: {
            type: "object",
            properties: {
                axis: { ...VEC3_SCHEMA, description: "Rotation axis (non-zero)" },
                angle: { type: "number", description: "Rotation angle in degrees" },
                center: { ...VEC3_SCHEMA, description: "Pivot point, defaults to {0,0,0}" },
            },
            required: ["axis", "angle"],
        },
        scale: { description: "Uniform scale number or {x, y, z}, must be non-zero" },
        mirror: {
            type: "object",
            properties: {
                origin: { ...VEC3_SCHEMA, description: "A point on the mirror plane" },
                normal: { ...VEC3_SCHEMA, description: "Mirror plane normal (non-zero)" },
            },
            required: ["origin", "normal"],
        },
    },
    required: ["id"],
};

function deleteNodeTool(): Tool {
    return {
        name: "delete_node",
        description:
            "Delete a node by id (ids come from get_document_state or run_program's created[].nodeId).",
        parameters: {
            type: "object",
            properties: { id: { type: "string", description: "Node id" } },
            required: ["id"],
        },
        handler: async (args) => {
            const doc = requireDocument();
            if (typeof doc === "string") return doc;
            const id = args["id"] as string;
            const node = requireNode(doc, id);
            if (typeof node === "string") return node;
            Transaction.execute(doc, "AI delete node", () => {
                node.parent?.remove(node);
                doc.visual.update();
            });
            return JSON.stringify({ deleted: id });
        },
    };
}

function setNodeVisibleTool(): Tool {
    return {
        name: "set_node_visible",
        description: "Show or hide a node by id. visible=true shows it, false hides it.",
        parameters: {
            type: "object",
            properties: {
                id: { type: "string", description: "Node id" },
                visible: { type: "boolean", description: "true to show, false to hide" },
            },
            required: ["id", "visible"],
        },
        handler: async (args) => {
            const doc = requireDocument();
            if (typeof doc === "string") return doc;
            const id = args["id"] as string;
            const node = requireNode(doc, id);
            if (typeof node === "string") return node;
            Transaction.execute(doc, "AI set node visible", () => {
                node.visible = args["visible"] as boolean;
            });
            doc.visual.update();
            return JSON.stringify({ id, visible: node.visible });
        },
    };
}

function transformNodeTool(): Tool {
    return {
        name: "transform_node",
        description:
            "Move, rotate, scale, or mirror a node in world space. Pass any combination of translate, rotate, scale, mirror; they compose in mirror → scale → rotate → translate order and multiply onto the node's current transform. rotate: axis (non-zero), angle in degrees, optional center (defaults to the world origin). scale: a uniform number or {x, y, z}. mirror: plane origin + normal.",
        parameters: TRANSFORM_NODE_PARAMETERS,
        handler: async (args) => {
            const doc = requireDocument();
            if (typeof doc === "string") return doc;
            const id = args["id"] as string;
            const node = requireNode(doc, id);
            if (typeof node === "string") return node;
            if (!("transform" in node) || !((node as { transform: unknown }).transform instanceof Matrix4)) {
                return JSON.stringify({ error: `node has no transform: ${id}` });
            }
            if (isConsumedTool(node)) {
                return JSON.stringify({
                    error: `node is a consumed boolean tool owned by a parametric body: ${id}`,
                });
            }
            const matrix = buildTransformMatrix(args);
            if (typeof matrix === "string") return JSON.stringify({ error: matrix });
            Transaction.execute(doc, "AI transform node", () => {
                const visual = node as { transform: Matrix4 };
                visual.transform = visual.transform.multiply(matrix);
            });
            doc.visual.update();
            const transform = (node as { transform: Matrix4 }).transform
                .toArray()
                .map((v) => Math.round(v * 1000) / 1000);
            return JSON.stringify({ id, transform });
        },
    };
}

function undoTool(): Tool {
    return {
        name: "undo",
        description: "Undo the last operation, reverting the model to its previous state.",
        parameters: { type: "object", properties: {} },
        handler: async () => {
            const doc = requireDocument();
            if (typeof doc === "string") return doc;
            doc.history.undo();
            doc.visual.update();
            return JSON.stringify({ ok: true });
        },
    };
}

function redoTool(): Tool {
    return {
        name: "redo",
        description: "Redo the last undone operation.",
        parameters: { type: "object", properties: {} },
        handler: async () => {
            const doc = requireDocument();
            if (typeof doc === "string") return doc;
            doc.history.redo();
            doc.visual.update();
            return JSON.stringify({ ok: true });
        },
    };
}

export function buildNodeTools(): Tool[] {
    return [deleteNodeTool(), setNodeVisibleTool(), transformNodeTool(), undoTool(), redoTool()];
}
