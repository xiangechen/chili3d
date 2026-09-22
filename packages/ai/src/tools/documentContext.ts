// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { I18n, type IDocument, type INode, ShapeNode, ShapeTypes, ShapeTypeUtils } from "@chili3d/core";

/** The kind names a node can report, lower-cased to match what `shape.shapeType` answers with. */
const SHAPE_KINDS = new Set(
    Object.values(ShapeTypes).map((type) => ShapeTypeUtils.stringValue(type).toLowerCase()),
);

/**
 * The kind of shape a node holds — "solid", "compound", … — or nothing when it holds no shape.
 * A body of several features, a boolean result and an import are compounds, which is the one thing
 * about a node that decides which shape queries apply to it; a model reading a node list without it
 * has only the node class name to go on, and writes a solid query against a compound.
 *
 * Read off what has already been computed: a `ParameterShapeNode` evaluates through its `shape`
 * getter, and listing a document is no reason to rebuild a body nobody is looking at.
 */
export function shapeKindOf(node: INode): string | undefined {
    if (!(node instanceof ShapeNode)) return undefined;
    const kind = node.shapeType.toLowerCase();
    return SHAPE_KINDS.has(kind) ? kind : undefined;
}

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
