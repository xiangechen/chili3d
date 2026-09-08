// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IDocument, INode } from "@chili3d/core";
import type { Tool } from "../llm/types";

function getDocument(): IDocument | undefined {
    return globalThis.app.activeView?.document;
}

function summarizeNode(node: INode) {
    return { id: node.id, type: node.constructor.name, name: node.name };
}

async function readDocumentState(): Promise<string> {
    const doc = getDocument();
    if (!doc) return JSON.stringify({ hasActiveDocument: false });
    const nodes = doc.modelManager.findNodes(() => true).map(summarizeNode);
    return JSON.stringify({
        hasActiveDocument: true,
        name: doc.name,
        nodeCount: nodes.length,
        nodes,
    });
}

async function readSelection(): Promise<string> {
    const doc = getDocument();
    if (!doc) return JSON.stringify({ hasActiveDocument: false });
    const selected = doc.selection.getSelectedNodes().map(summarizeNode);
    return JSON.stringify({ hasActiveDocument: true, selected });
}

export function buildReadTools(): Tool[] {
    return [
        {
            name: "get_document_state",
            description:
                "Read the current document: whether there is an active document, its name, node count, and each node's id/type/name.",
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
