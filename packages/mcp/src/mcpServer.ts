// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { IDocument } from "@chili3d/core";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { BridgeController } from "./bridge/controller";
import { DEFAULT_BRIDGE_URL, type ResponseMessage } from "./bridge/protocol";
import { createHeadlessApplication } from "./headless";
import { addBox, collectShapes, documentToStl, measureDocument, serializeDocument } from "./pipeline";
import { runProgram } from "./program/interpreter";
import { OpSchema } from "./program/schema";
import { renderPreview, renderViews } from "./render/preview";

function tmp(name: string) {
    return path.join(os.tmpdir(), name);
}

function textResult(text: string) {
    return { content: [{ type: "text" as const, text }] };
}

/**
 * Build the Chili3D MCP server. Tools share one headless application and keep
 * in-progress documents in a session map, so an AI can build incrementally:
 *   new_document -> run_cad_program -> get_document_state / render -> export.
 * The model is always a parametric .cd node tree (editable in the app), not a mesh.
 */
export function createServer(): McpServer {
    const app = createHeadlessApplication();
    const sessions = new Map<string, IDocument>();
    const server = new McpServer(
        { name: "chili3d-mcp", version: "0.7.0-beta" },
        {
            instructions:
                "Chili3D builds editable parametric CAD (a .cd node tree, not a mesh) over a shared OCCT core. Units are millimetres. " +
                "There are two tool families that run the SAME geometry core, so a headless dry-run faithfully predicts the live result.\n\n" +
                "• LIVE (live_*): drives the model in the user's OPEN browser tab (started with ?live). The 3D view updates as you go. " +
                "Use these by default whenever the user wants to SEE the result — modeling (live_run_cad_program), screenshot (live_render_preview), measure (live_get_properties), export (live_export_stl/step, live_save_cd). " +
                "If live_get_state reports hasActiveDocument=false, ask the user before creating a document.\n\n" +
                "• HEADLESS (new_document, run_cad_program, get_properties, render_preview, export_*, save_cd): a private SERVER-SIDE scratchpad that does NOT touch the user's browser. " +
                "Use it to draft and SELF-VERIFY geometry — build, then check dimensions with get_properties and look at render_preview — before pushing the model to the live view, or for fully headless/batch runs that write files with no browser open.\n\n" +
                "Prefer LIVE when the user is watching; use HEADLESS to verify yourself.",
        },
    );

    const getDoc = (documentId: string): IDocument => {
        const doc = sessions.get(documentId);
        if (!doc) throw new Error(`unknown documentId "${documentId}" — call new_document first`);
        return doc;
    };

    server.registerTool(
        "new_document",
        {
            title: "New document",
            description: "Create an empty document and return its documentId for subsequent tool calls.",
            inputSchema: { name: z.string().optional() },
        },
        async ({ name }) => {
            const doc = await app.newDocument(name ?? "untitled");
            sessions.set(doc.id, doc);
            return textResult(JSON.stringify({ documentId: doc.id, name: doc.name }));
        },
    );

    server.registerTool(
        "run_cad_program",
        {
            title: "Run a CAD program",
            description:
                'HEADLESS build (writes .cd/STL files on the server; does NOT change what the user sees in the open browser). If the user wants the model to appear in their open Chili3D browser tab, use live_run_cad_program instead. Execute a sequence of modeling ops to build a parametric model. Ops run in order; shape inputs reference earlier ops via { ref: "<id>" }. Primitives (box/sphere/cylinder/cone/pyramid), sketches (rect/circle/polygon), and operations (extrude/revolve/boolean) are supported. If documentId is omitted a new document is created. boolean/fillet results are baked (non-parametric); primitives and extrude/revolve stay editable. All lengths/coordinates are millimetres (mm); angles (revolve/rotate/array) are DEGREES. Plan exact dimensions before building, then self-verify with get_properties (compare bounding box against your intended mm) and render_preview before trusting the result.',
            inputSchema: {
                documentId: z.string().optional(),
                ops: z.array(OpSchema).min(1),
            },
        },
        async ({ documentId, ops }) => {
            const doc = documentId ? getDoc(documentId) : await app.newDocument("program");
            sessions.set(doc.id, doc);
            const { addedNodeIds } = runProgram(doc, { ops });
            return textResult(
                JSON.stringify({
                    documentId: doc.id,
                    addedNodes: addedNodeIds,
                    nodeCount: addedNodeIds.length,
                }),
            );
        },
    );

    server.registerTool(
        "get_document_state",
        {
            title: "Get document state",
            description: "Return the editable .cd document JSON and a summary of its nodes.",
            inputSchema: { documentId: z.string() },
        },
        async ({ documentId }) => {
            const doc = getDoc(documentId);
            const nodes = doc.modelManager.findNodes(() => true).map((n) => n.constructor.name);
            const cd = serializeDocument(doc);
            return textResult(JSON.stringify({ documentId, nodeTypes: nodes, cd }));
        },
    );

    server.registerTool(
        "export_stl",
        {
            title: "Export STL",
            description:
                "Export the document to an STL file (binary by default) and return the path. STL is a faceted triangle mesh (lossy approximation of the surfaces) — best for 3D printing or quick visualization; use export_step for machining or exact-geometry handoff.",
            inputSchema: {
                documentId: z.string(),
                outPath: z.string().optional(),
                binary: z.boolean().optional(),
            },
        },
        async ({ documentId, outPath, binary }) => {
            const doc = getDoc(documentId);
            const stl = documentToStl(app, doc, { binary: binary ?? true });
            const file = outPath ?? tmp(`chili3d-${documentId}.stl`);
            writeFileSync(file, stl);
            const triangles = new DataView(stl.buffer, stl.byteOffset, stl.byteLength).getUint32(80, true);
            return textResult(JSON.stringify({ path: file, bytes: stl.byteLength, triangles }));
        },
    );

    server.registerTool(
        "export_step",
        {
            title: "Export STEP",
            description:
                "Export the document to a STEP file (exact B-rep geometry) and return the path. Prefer STEP when the part is headed for machining/CAM or further CAD editing, since it preserves exact B-rep surfaces (STL is a triangle mesh better suited to 3D printing).",
            inputSchema: { documentId: z.string(), outPath: z.string().optional() },
        },
        async ({ documentId, outPath }) => {
            const doc = getDoc(documentId);
            const shapes = collectShapes(doc);
            const result = app.shapeFactory.converter.convertToSTEP(...shapes);
            if (!result.isOk) throw new Error(`STEP export failed: ${result.error}`);
            const file = outPath ?? tmp(`chili3d-${documentId}.step`);
            writeFileSync(file, result.value);
            return textResult(JSON.stringify({ path: file, bytes: result.value.length }));
        },
    );

    server.registerTool(
        "save_cd",
        {
            title: "Save .cd document",
            description: "Write the editable .cd document JSON to a file (openable in the Chili3D app).",
            inputSchema: { documentId: z.string(), outPath: z.string().optional() },
        },
        async ({ documentId, outPath }) => {
            const doc = getDoc(documentId);
            const json = JSON.stringify(serializeDocument(doc));
            const file = outPath ?? tmp(`chili3d-${documentId}.cd`);
            writeFileSync(file, json);
            return textResult(JSON.stringify({ path: file, bytes: json.length }));
        },
    );

    server.registerTool(
        "get_properties",
        {
            title: "Measure document",
            description:
                "HEADLESS: bounding box (overall size in mm) + total solid volume (mm³) of the document, for verifying dimensions. Use this to confirm the model matches your intended dimensions: compare the bounding box against the sizes you specified (in mm) before exporting or pushing to the live view.",
            inputSchema: { documentId: z.string() },
        },
        async ({ documentId }) => textResult(JSON.stringify(measureDocument(getDoc(documentId)))),
    );

    server.registerTool(
        "render_preview",
        {
            title: "Render preview",
            description:
                "Render an isometric PNG preview of the current model so a vision-capable model can see the result and self-correct. Returns an image.",
            inputSchema: {
                documentId: z.string(),
                size: z.number().int().min(64).max(2048).optional(),
            },
        },
        async ({ documentId, size }) => {
            const doc = getDoc(documentId);
            const png = renderPreview(doc, { width: size ?? 512, height: size ?? 512 });
            return {
                content: [{ type: "image" as const, data: png.toString("base64"), mimeType: "image/png" }],
            };
        },
    );

    server.registerTool(
        "render_views",
        {
            title: "Render three-view sheet",
            description:
                "HEADLESS human-review gate: render a 2x2 orthographic sheet of the current model as one PNG — top-left FRONT, top-right RIGHT, bottom-left TOP, bottom-right ISO. Show this to the user so a person can sanity-check the geometry BEFORE pushing the model to the live view. Run it after you have self-verified dimensions with get_properties.",
            inputSchema: {
                documentId: z.string(),
                size: z.number().int().min(64).max(1024).optional(),
            },
        },
        async ({ documentId, size }) => {
            const doc = getDoc(documentId);
            const png = renderViews(doc, { size: size ?? 320 });
            return {
                content: [
                    {
                        type: "text" as const,
                        text: "Three-view sheet — top-left: FRONT, top-right: RIGHT, bottom-left: TOP, bottom-right: ISO.",
                    },
                    { type: "image" as const, data: png.toString("base64"), mimeType: "image/png" },
                ],
            };
        },
    );

    server.registerTool(
        "make_box",
        {
            title: "Make a box",
            description:
                "HEADLESS convenience: create a one-box document and export STL to a file. Does NOT update the open browser — use live_run_cad_program for that.",
            inputSchema: {
                dx: z.number().positive(),
                dy: z.number().positive(),
                dz: z.number().positive(),
                outPath: z.string().optional(),
                binary: z.boolean().optional(),
            },
        },
        async ({ dx, dy, dz, outPath, binary }) => {
            const doc = await app.newDocument("make_box");
            sessions.set(doc.id, doc);
            addBox(doc, { dx, dy, dz });
            const stl = documentToStl(app, doc, { binary: binary ?? true });
            const file = outPath ?? tmp(`chili3d-box-${dx}x${dy}x${dz}.stl`);
            writeFileSync(file, stl);
            return {
                content: [
                    {
                        type: "text" as const,
                        text: `Created box ${dx}×${dy}×${dz}; ${stl.byteLength} bytes of STL at ${file}.`,
                    },
                    { type: "text" as const, text: JSON.stringify(serializeDocument(doc)) },
                ],
            };
        },
    );

    // --- Live tools: drive the model the user is looking at in the browser, via
    // the bridge (run `npm run bridge` and open the app at /?live). ---
    let controller: BridgeController | undefined;
    const bridgeUrl = process.env["CHILI3D_BRIDGE_URL"] ?? DEFAULT_BRIDGE_URL;
    const ensureController = async (): Promise<BridgeController> => {
        if (!controller) {
            const c = new BridgeController(bridgeUrl);
            await c.connect();
            controller = c;
        }
        return controller;
    };
    const bridgeUnavailable = (error: unknown) =>
        textResult(
            JSON.stringify({
                ok: false,
                error: `Live bridge unavailable (${error}). Start it with 'npm run bridge -w @chili3d/mcp' and open the app at http://localhost:8080/?live`,
            }),
        );
    const withController = async (fn: (c: BridgeController) => Promise<unknown>) => {
        try {
            return textResult(JSON.stringify(await fn(await ensureController())));
        } catch (error) {
            return bridgeUnavailable(error);
        }
    };
    // Proxy a binary/text export from the live browser to a file on the server.
    const liveExportToFile = async (
        call: (c: BridgeController) => Promise<ResponseMessage>,
        decode: (data: string) => Buffer,
        suffix: string,
        outPath?: string,
    ) => {
        try {
            const res = await call(await ensureController());
            if (!res.ok || res.data === undefined) {
                throw new Error(res.error ?? "no data returned from the browser");
            }
            const bytes = decode(res.data);
            const file = outPath ?? tmp(`chili3d-live.${suffix}`);
            writeFileSync(file, bytes);
            return textResult(JSON.stringify({ path: file, bytes: bytes.byteLength }));
        } catch (error) {
            return bridgeUnavailable(error);
        }
    };

    server.registerTool(
        "live_get_state",
        {
            title: "Get live browser state",
            description: "Report what the user currently has open in the browser (document + node count).",
            inputSchema: {},
        },
        () => withController((c) => c.getState()),
    );

    server.registerTool(
        "live_new_document",
        {
            title: "New live document",
            description:
                "Create a new document in the browser session. Ask the user before doing this if they did not request it.",
            inputSchema: { name: z.string().optional() },
        },
        ({ name }) => withController((c) => c.newDocument(name)),
    );

    server.registerTool(
        "live_run_cad_program",
        {
            title: "Edit the live model",
            description:
                "PREFERRED for interactive modeling: run a CAD program against the model the user is currently viewing in the browser — the 3D view updates LIVE. Use this whenever the user wants to see the result in their open Chili3D tab. Same ops as run_cad_program. If no document is open, the response has hasActiveDocument=false — ask the user whether to create one (live_new_document) before retrying. Lengths are millimetres (mm); revolve/rotate/array angles are DEGREES. After editing, verify with live_get_properties and live_render_preview.",
            inputSchema: { ops: z.array(OpSchema).min(1) },
        },
        ({ ops }) => withController((c) => c.runProgram(ops)),
    );

    server.registerTool(
        "live_export_stl",
        {
            title: "Export the live model to STL",
            description:
                "Export the model the user is viewing in the browser to an STL file on the server disk (binary by default) and return the path.",
            inputSchema: { outPath: z.string().optional(), binary: z.boolean().optional() },
        },
        ({ outPath, binary }) =>
            liveExportToFile(
                (c) => c.exportStl(binary ?? true),
                (d) => Buffer.from(d, "base64"),
                "stl",
                outPath,
            ),
    );

    server.registerTool(
        "live_export_step",
        {
            title: "Export the live model to STEP",
            description:
                "Export the model the user is viewing in the browser to a STEP file (exact B-rep) on the server disk and return the path.",
            inputSchema: { outPath: z.string().optional() },
        },
        ({ outPath }) =>
            liveExportToFile(
                (c) => c.exportStep(),
                (d) => Buffer.from(d, "utf8"),
                "step",
                outPath,
            ),
    );

    server.registerTool(
        "live_save_cd",
        {
            title: "Save the live document (.cd)",
            description:
                "Write the editable .cd document the user has open in the browser to a file on the server disk and return the path.",
            inputSchema: { outPath: z.string().optional() },
        },
        ({ outPath }) =>
            liveExportToFile(
                (c) => c.saveDocument(),
                (d) => Buffer.from(d, "utf8"),
                "cd",
                outPath,
            ),
    );

    server.registerTool(
        "live_render_preview",
        {
            title: "Screenshot the live view",
            description:
                "Capture a real PNG screenshot of the model as the user currently sees it in the browser (their camera angle), so a vision-capable model can verify the result. Returns an image.",
            inputSchema: {},
        },
        async () => {
            try {
                const res = await (await ensureController()).renderPreview();
                if (!res.ok || !res.data) throw new Error(res.error ?? "no image returned from the browser");
                return { content: [{ type: "image" as const, data: res.data, mimeType: "image/png" }] };
            } catch (error) {
                return bridgeUnavailable(error);
            }
        },
    );

    server.registerTool(
        "live_get_properties",
        {
            title: "Measure the live model",
            description:
                "Bounding box (overall size in mm) + total solid volume (mm³) of the model the user is viewing in the browser, for verifying dimensions.",
            inputSchema: {},
        },
        async () => {
            try {
                const res = await (await ensureController()).getProperties();
                if (!res.ok || !res.data)
                    throw new Error(res.error ?? "no properties returned from the browser");
                return textResult(res.data);
            } catch (error) {
                return bridgeUnavailable(error);
            }
        },
    );

    return server;
}
