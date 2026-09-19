// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    FolderNode,
    type IDocument,
    type INode,
    isConsumedTool,
    Matrix4,
    NodeUtils,
    Transaction,
} from "@chili3d/core";
import type { Tool } from "../llm/types";
import { findNode, requireDocument, requireNode } from "./documentContext";
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

/**
 * The folder a grouping tool targets: `id` names a folder, or the document root when omitted.
 * A parametric body is a linked-list container too, so `instanceof` is doing real work here —
 * moving a node into a body would silently turn it into a consumed tool of that body.
 */
function resolveFolder(doc: IDocument, id: unknown): FolderNode | string {
    const node = id === undefined ? doc.modelManager.rootNode : findNode(doc, String(id));
    if (node === undefined) return JSON.stringify({ error: `folder not found: ${id}` });
    if (!(node instanceof FolderNode)) {
        return JSON.stringify({
            error: `${id} is a ${node.constructor.name}, not a folder — pass a folder id from create_folder or get_document_state`,
        });
    }
    return node;
}

/** True when `folder` is `node` itself or one of its descendants — a move that would orphan the tree. */
function isSelfOrDescendant(node: INode, folder: INode): boolean {
    for (let current: INode | undefined = folder; current !== undefined; current = current.parent) {
        if (current === node) return true;
    }
    return false;
}

/** The nodes named by `ids`, or the message for the first one that cannot be re-parented into `folder`. */
function resolveMovable(doc: IDocument, ids: unknown, folder: FolderNode): INode[] | string {
    if (!Array.isArray(ids)) return "nodeIds must be an array of node ids";
    const nodes: INode[] = [];
    for (const id of ids) {
        const node = findNode(doc, String(id));
        if (node === undefined) return `node not found: ${id}`;
        if (node.parent === undefined) return `cannot move ${id}: it is the document root`;
        // The body rebuilds from its own feature list, so the node would keep rendering the
        // body's features wherever it landed — a move that looks applied and is not.
        if (isConsumedTool(node)) {
            return `cannot move ${id}: it is a tool consumed by "${node.parent.name}", which rebuilds it from its own features`;
        }
        if (isSelfOrDescendant(node, folder)) {
            return `cannot move ${id} into itself or one of its own descendants`;
        }
        nodes.push(node);
    }
    return nodes;
}

interface MoveOutcome {
    moved: string[];
    skipped: { id: string; reason: string }[];
}

/** Re-parents every node into `folder`, reporting the ones left where they were and why. */
function moveAllInto(nodes: INode[], folder: FolderNode): MoveOutcome {
    const outcome: MoveOutcome = { moved: [], skipped: [] };
    for (const node of nodes) {
        if (node.parent === folder) {
            outcome.skipped.push({ id: node.id, reason: "already a child of this folder" });
        } else {
            (node.parent as FolderNode).move(node, folder);
            outcome.moved.push(node.id);
        }
    }
    return outcome;
}

function createFolderTool(): Tool {
    return {
        name: "create_folder",
        description:
            "Create a folder node and optionally move existing nodes into it. A folder only organises the model tree — it does not fuse, hide or transform what it holds (use combine in run_program to make one compound shape, or a boolean op to merge solids, when the parts must become one). Nest folders with parentId, and reuse an existing folder by passing its id to move_nodes instead of making another.",
        parameters: {
            type: "object",
            properties: {
                name: {
                    type: "string",
                    description: "Folder name; defaults to a generated 'Folder1', 'Folder2', …",
                },
                nodeIds: {
                    type: "array",
                    items: { type: "string" },
                    description: "Existing nodes to move into the new folder",
                },
                parentId: {
                    type: "string",
                    description:
                        "Id of an existing folder to nest this one under; defaults to the document root",
                },
            },
        },
        handler: async (args) => {
            const doc = requireDocument();
            if (typeof doc === "string") return doc;

            const parent = resolveFolder(doc, args["parentId"]);
            if (typeof parent === "string") return parent;

            const nodes = resolveMovable(doc, args["nodeIds"] ?? [], parent);
            if (typeof nodes === "string") return JSON.stringify({ error: nodes });

            const given = args["name"];
            const name =
                typeof given === "string" && given.trim() !== ""
                    ? given.trim()
                    : NodeUtils.generateName(doc, "Folder");

            const folder = new FolderNode({ document: doc, name });
            let outcome: MoveOutcome = { moved: [], skipped: [] };
            Transaction.execute(doc, "AI create folder", () => {
                parent.add(folder);
                outcome = moveAllInto(nodes, folder);
            });
            doc.visual.update();
            return JSON.stringify({
                id: folder.id,
                name: folder.name,
                parentId: parent.id,
                moved: outcome.moved,
                skipped: outcome.skipped,
            });
        },
    };
}

function moveNodesTool(): Tool {
    return {
        name: "move_nodes",
        description:
            "Move nodes into a folder, between folders, or back to the document root (omit folderId) to ungroup them. Create the folder with create_folder first. A hidden folder hides whatever moves into it.",
        parameters: {
            type: "object",
            properties: {
                nodeIds: {
                    type: "array",
                    items: { type: "string" },
                    description: "Nodes to move",
                },
                folderId: {
                    type: "string",
                    description: "Target folder; omit to move the nodes to the document root",
                },
            },
            required: ["nodeIds"],
        },
        handler: async (args) => {
            const doc = requireDocument();
            if (typeof doc === "string") return doc;

            const folder = resolveFolder(doc, args["folderId"]);
            if (typeof folder === "string") return folder;

            const nodes = resolveMovable(doc, args["nodeIds"], folder);
            if (typeof nodes === "string") return JSON.stringify({ error: nodes });

            let outcome: MoveOutcome = { moved: [], skipped: [] };
            Transaction.execute(doc, "AI move nodes", () => {
                outcome = moveAllInto(nodes, folder);
            });
            doc.visual.update();
            return JSON.stringify({
                folder: { id: folder.id, name: folder.name },
                moved: outcome.moved,
                skipped: outcome.skipped,
            });
        },
    };
}

export function buildNodeTools(): Tool[] {
    return [
        deleteNodeTool(),
        setNodeVisibleTool(),
        transformNodeTool(),
        createFolderTool(),
        moveNodesTool(),
        undoTool(),
        redoTool(),
    ];
}
