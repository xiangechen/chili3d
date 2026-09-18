// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { isConsumedTool, Matrix4, Transaction } from "@chili3d/core";
import type { Tool } from "../llm/types";
import { requireDocument, requireNode } from "./documentContext";
import { buildTransformMatrix, TRANSFORM_ARG_DOC, TRANSFORM_ORDER, VEC3_SCHEMA } from "./transformMatrix";

const TRANSFORM_NODE_PARAMETERS = {
    type: "object",
    properties: {
        id: { type: "string", description: "Node id" },
        translate: { ...VEC3_SCHEMA, description: TRANSFORM_ARG_DOC.translate },
        rotate: {
            type: "object",
            properties: {
                axis: { ...VEC3_SCHEMA, description: "Rotation axis (non-zero)" },
                angle: { type: "number", description: "Rotation angle in degrees" },
                center: { ...VEC3_SCHEMA, description: "Pivot point, defaults to {0,0,0}" },
            },
            required: ["axis", "angle"],
        },
        scale: { description: TRANSFORM_ARG_DOC.scale },
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
        description: `Move, rotate, scale, or mirror a node in world space. Pass any combination of translate, rotate, scale, mirror; combined arguments act on the geometry in ${TRANSFORM_ORDER} order, and the result multiplies onto the node's current transform. Each argument's encoding is described in the parameter schema.`,
        parameters: TRANSFORM_NODE_PARAMETERS,
        handler: transformNodeHandler,
    };
}

const transformNodeHandler: Tool["handler"] = async (args) => {
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
    return JSON.stringify({ id, transform: roundedTransform(node) });
};

function roundedTransform(node: unknown): number[] {
    const transform = (node as { transform: Matrix4 }).transform;
    return transform.toArray().map((v) => Math.round(v * 1000) / 1000);
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
