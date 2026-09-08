// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { download, I18n, type IApplication, type IDocument, type INode, VisualNode } from "@chili3d/core";
import type { Tool } from "../llm/types";

function getDocument(): IDocument | undefined {
    return globalThis.app.activeView?.document;
}

function resolveNodes(doc: IDocument, ids: unknown): INode[] | string {
    if (ids === undefined) {
        return doc.modelManager.findNodes((n) => n.parent === doc.modelManager.rootNode);
    }
    if (!Array.isArray(ids)) return "ids must be an array of node ids";
    const nodes = ids.map((id) => doc.modelManager.findNodes((n) => n.id === String(id))[0]);
    const missing = ids.filter((_, i) => !nodes[i]);
    if (missing.length) return `nodes not found: ${missing.join(", ")}`;
    return nodes;
}

function validateFormat(app: IApplication, format: string): string | undefined {
    const formats = app.dataExchange.exportFormats();
    if (formats.includes(format)) return undefined;
    return `unknown format "${format}", expected one of ${formats.join(", ")}`;
}

function resolveFilename(visuals: VisualNode[], format: string, filename: unknown): string {
    const suffix = format.replace(" binary", "");
    let name = (filename as string | undefined)?.trim() || `${visuals[0].name}${suffix}`;
    if (!name.toLowerCase().endsWith(suffix)) name += suffix;
    return name;
}

async function handleExportNodes(args: Record<string, unknown>): Promise<string> {
    const app = globalThis.app;
    const doc = getDocument();
    if (!doc) return JSON.stringify({ error: I18n.translate("ai.error.noDocument") });

    const format = args["format"] as string;
    const formatError = validateFormat(app, format);
    if (formatError) return JSON.stringify({ error: formatError });

    const nodes = resolveNodes(doc, args["ids"]);
    if (typeof nodes === "string") return JSON.stringify({ error: nodes });
    const visuals = nodes.filter((n): n is VisualNode => n instanceof VisualNode);
    if (visuals.length === 0) return JSON.stringify({ error: "no exportable nodes" });

    const data = await app.dataExchange.export(format, visuals);
    if (!data) {
        return JSON.stringify({ error: "export failed: no exportable geometry for this format" });
    }

    const filename = resolveFilename(visuals, format, args["filename"]);
    download(data, filename);
    return JSON.stringify({
        ok: true,
        filename,
        bytes: new Blob(data).size,
        nodes: visuals.map((n) => n.id),
    });
}

export function buildFileTools(): Tool[] {
    return [
        {
            name: "export_nodes",
            description:
                "Export nodes to a CAD file and download it in the browser. format is one of the app's export formats ('.step', '.iges', '.brep' for B-rep geometry; '.stl', '.stl binary', '.ply', '.ply binary', '.obj' for meshes). Nodes merge into a single file. Omit ids to export all top-level nodes.",
            parameters: {
                type: "object",
                properties: {
                    ids: {
                        type: "array",
                        items: { type: "string" },
                        description: "Node ids to export; omit to export all top-level nodes",
                    },
                    format: { type: "string", description: "Export format, e.g. '.step'" },
                    filename: {
                        type: "string",
                        description: "Optional file name; the format extension is appended when missing",
                    },
                },
                required: ["format"],
            },
            handler: handleExportNodes,
        },
    ];
}
