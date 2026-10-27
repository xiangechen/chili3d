// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { Tool } from "../llm/types";
import { getDocument } from "./documentContext";

/**
 * The one document operation no other tool can stand in for. A page opened from scratch has no
 * document at all, and every modeling and query tool needs one — the in-app assistant could ask
 * the user to click New, an external agent has no one to click for it.
 *
 * It refuses when a document is already open: `Application.newDocument` installs a new active
 * view without closing or saving the old one, so replacing it from a tool would leave the user's
 * unsaved work with no way back to it.
 */
export function buildDocumentTools(): Tool[] {
    return [
        {
            name: "new_document",
            description:
                "Create and activate an empty document. Call this only when get_document_state reports hasActiveDocument: false and the user wants something built. An existing document is never touched — to keep the user's work, keep using it instead.",
            parameters: {
                type: "object",
                properties: {
                    name: { type: "string", description: "Document name (default: Untitled)" },
                },
            },
            handler: async (args) => {
                const existing = getDocument();
                if (existing) {
                    return JSON.stringify({
                        error: "A document is already open. Ask the user to save or close it before creating another; this tool never replaces an open document.",
                        documentId: existing.id,
                        name: existing.name,
                    });
                }
                const name =
                    typeof args["name"] === "string" && args["name"].trim()
                        ? args["name"].trim()
                        : "Untitled";
                const document = await globalThis.app.newDocument(name);
                return JSON.stringify({ documentId: document.id, name: document.name });
            },
        },
    ];
}
