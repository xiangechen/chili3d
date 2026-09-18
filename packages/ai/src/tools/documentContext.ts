// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { I18n, type IDocument, type INode } from "@chili3d/core";

/**
 * The active document, or undefined when none is open. `globalThis.app` is a core getter that
 * throws before any Application exists, so the read is guarded — every tool that needs the
 * document starts here.
 */
export function getDocument(): IDocument | undefined {
    try {
        return globalThis.app?.activeView?.document;
    } catch {
        return undefined;
    }
}

export function findNode(doc: IDocument, id: string): INode | undefined {
    return doc.modelManager.findNodes((n) => n.id === id)[0];
}

/** Active document, or the serialized error response when no document is open. */
export function requireDocument(): IDocument | string {
    return getDocument() ?? JSON.stringify({ error: I18n.translate("ai.error.noDocument") });
}

/** Node with the given id, or the serialized error response when it does not exist. */
export function requireNode(doc: IDocument, id: string): INode | string {
    return (
        findNode(doc, id) ??
        JSON.stringify({
            error: `node not found: ${id} — it may have been consumed by an edit-style run_program op (e.g. booleanCut) or deleted; the consumed nodes are listed in run_program's "removed". Call get_document_state for the current node list instead of retrying.`,
        })
    );
}
