// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument, INode } from "@chili3d/core";
import type { Tool } from "../llm/types";
import { getDocument, shapeKindOf } from "./documentContext";

function summarizeNode(node: INode) {
    // parentId is what makes the tree legible: a FolderNode's children share its id, and a
    // node moved by create_folder/move_nodes stays present here with its parent changed.
    // shapeKind is what says which shape queries apply to it (see documentContext.shapeKindOf).
    return {
        id: node.id,
        type: node.constructor.name,
        name: node.name,
        parentId: node.parent?.id,
        shapeKind: shapeKindOf(node),
    };
}

function documentSummary(doc: IDocument) {
    const nodes = doc.modelManager.findNodes(() => true).map(summarizeNode);
    return { hasActiveDocument: true, name: doc.name, nodeCount: nodes.length, nodes };
}

async function readDocumentState(): Promise<string> {
    const doc = getDocument();
    if (!doc) return JSON.stringify({ hasActiveDocument: false });
    return JSON.stringify(documentSummary(doc));
}

async function readSelection(): Promise<string> {
    const doc = getDocument();
    if (!doc) return JSON.stringify({ hasActiveDocument: false });
    const selected = doc.selection.getSelectedNodes().map(summarizeNode);
    return JSON.stringify({ hasActiveDocument: true, selected });
}

/**
 * Compact JSON snapshot of the document and its selection, injected into the system prompt
 * at run start so the model can skip the first get_document_state / get_selection calls.
 */
export function documentSnapshot(): string {
    const doc = getDocument();
    if (!doc) return JSON.stringify({ hasActiveDocument: false });
    const selected = doc.selection.getSelectedNodes().map(summarizeNode);
    return JSON.stringify({ ...documentSummary(doc), selected });
}

export function buildReadTools(): Tool[] {
    return [
        {
            name: "get_document_state",
            description:
                "Read the current document: whether there is an active document, its name, node count, and each node's id/type/name/parentId/shapeKind. Nodes of type FolderNode are the groups; a node's parentId is the folder holding it. shapeKind is the kind of shape the node holds (a compound is a body of several features, a boolean result or an import) — the shape-query skill's compound.* and solid.* sections say which queries each kind takes.",
            parameters: { type: "object", properties: {} },
            handler: readDocumentState,
        },
        {
            name: "get_selection",
            description: "Read the currently selected nodes.",
            parameters: { type: "object", properties: {} },
            handler: readSelection,
        },
    ];
}
