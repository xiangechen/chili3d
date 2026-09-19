// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IDocument, type INode, Logger } from "@chili3d/core";

/**
 * A node whose geometry is derived from the document's parameter table.
 *
 * Structural rather than a `ParametricBodyNode`/`SketchNode` union on purpose: this
 * module must not import either class, or the two would form an import cycle with the
 * constructors that call `ensureVariableSync`.
 */
export interface IVariableConsumer {
    /** Re-derives from the current table; idempotent per table revision. */
    applyVariables(): void;
    /** Lower runs first — a sketch re-solves before the bodies that read it. */
    readonly variableSyncOrder: number;
}

function isVariableConsumer(node: INode): node is INode & IVariableConsumer {
    const candidate = node as unknown as IVariableConsumer;
    return typeof candidate?.applyVariables === "function" && typeof candidate.variableSyncOrder === "number";
}

const synced = new WeakSet<IDocument>();
const seenRevisions = new WeakMap<IDocument, number>();

/**
 * Subscribes `document` to its parameter table, once per document. Every consumer
 * registers, but only the first registration walks the tree.
 *
 * One dispatcher rather than each node subscribing itself: node registration order
 * would decide notification order, so a body could re-evaluate before the sketch it
 * reads has taken the new values — and each sketch's own shape change would then
 * re-trigger its bodies a second time. Sorting by `variableSyncOrder` instead makes
 * the order a property of the roles, not of who was constructed first.
 *
 * The revision gate keeps a run to one dispatch: a consumer re-entering the table
 * (a rebuild that writes back) cannot start a second pass.
 */
export function ensureVariableSync(document: IDocument): void {
    if (synced.has(document)) return;
    synced.add(document);
    document.variables.onPropertyChanged((property) => {
        if (property !== "variablesJson") return;
        const revision = document.variables.revision;
        if (seenRevisions.get(document) === revision) return;
        seenRevisions.set(document, revision);
        refreshConsumers(document);
    });
}

function refreshConsumers(document: IDocument): void {
    // `findNodes` narrows nothing on its own — the filter is what gives the sort its type.
    const consumers = document.modelManager
        .findNodes(isVariableConsumer)
        .filter(isVariableConsumer)
        .sort((a, b) => a.variableSyncOrder - b.variableSyncOrder);
    for (const consumer of consumers) {
        // One consumer failing must not strand the rest: the revision is already spent (see
        // `ensureVariableSync`), so a throw here would freeze every later consumer on the
        // previous parameter values until something else bumped the table.
        try {
            consumer.applyVariables();
        } catch (error) {
            Logger.error("variable sync: a consumer failed to apply the parameter table", error);
        }
    }
}
