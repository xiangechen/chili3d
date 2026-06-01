// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IApplication, Logger } from "@chili3d/core";
import type { DataType, DocumentState, RequestMessage } from "@chili3d/mcp/src/bridge/protocol";
import { collectShapes, measureDocument, serializeDocument } from "@chili3d/mcp/src/pipeline";
import { runProgram } from "@chili3d/mcp/src/program/interpreter";

interface LiveStatus {
    connected: boolean;
    lastNodeCount: number;
    lastError?: string;
}

interface HandleResult {
    state?: DocumentState;
    data?: string;
    dataType?: DataType;
}

function bytesToBase64(bytes: Uint8Array): string {
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

// Connect this browser session to the live bridge so an AI (via the MCP server)
// can edit / export / measure the model the user is currently looking at. The same
// headless interpreter + converters run here against the live document.
export function connectLive(application: IApplication, url: string): void {
    const status: LiveStatus = { connected: false, lastNodeCount: 0 };
    (window as unknown as { __chili3dLive: LiveStatus }).__chili3dLive = status;

    const connect = () => {
        const ws = new WebSocket(url);

        ws.addEventListener("open", () => {
            status.connected = true;
            ws.send(JSON.stringify({ kind: "hello", role: "browser" }));
            Logger.info(`[live] connected to ${url}`);
        });
        // Auto-reconnect: the bridge can be started/restarted at any time.
        ws.addEventListener("close", () => {
            status.connected = false;
            setTimeout(connect, 2000);
        });
        ws.addEventListener("error", () => ws.close());

        ws.addEventListener("message", async (event) => {
            let msg: RequestMessage;
            try {
                msg = JSON.parse(event.data);
            } catch {
                return;
            }
            if (msg.kind !== "request") return;
            try {
                const result = await handle(application, msg, status);
                ws.send(JSON.stringify({ kind: "response", id: msg.id, ok: true, ...result }));
            } catch (error) {
                status.lastError = String(error);
                ws.send(JSON.stringify({ kind: "response", id: msg.id, ok: false, error: String(error) }));
            }
        });
    };

    connect();
}

function readState(application: IApplication): DocumentState {
    const document = application.activeView?.document;
    if (!document) return { hasActiveDocument: false };
    const nodes = document.modelManager.findNodes(() => true);
    return {
        hasActiveDocument: true,
        documentId: document.id,
        documentName: document.name,
        nodeCount: nodes.length,
    };
}

async function handle(
    application: IApplication,
    msg: RequestMessage,
    status: LiveStatus,
): Promise<HandleResult> {
    if (msg.action === "get_state") {
        return { state: readState(application) };
    }
    if (msg.action === "new_document") {
        await application.newDocument(msg.name ?? "untitled"); // also creates the active view
        return { state: readState(application) };
    }

    const document = application.activeView?.document;
    if (!document) return { state: { hasActiveDocument: false } };

    if (msg.action === "run_cad_program") {
        const { addedNodeIds } = runProgram(document, { ops: msg.ops ?? [] });
        document.visual.update();
        application.activeView?.cameraController.fitContent();
        const state = readState(application);
        state.addedNodeIds = addedNodeIds;
        status.lastNodeCount = state.nodeCount ?? 0;
        return { state };
    }
    if (msg.action === "export_stl") {
        const result = application.shapeFactory.converter.convertToSTL(collectShapes(document), {
            binary: msg.binary ?? true,
        });
        if (!result.isOk) throw new Error(`STL export failed: ${result.error}`);
        return { state: readState(application), data: bytesToBase64(result.value), dataType: "stl" };
    }
    if (msg.action === "export_step") {
        const result = application.shapeFactory.converter.convertToSTEP(...collectShapes(document));
        if (!result.isOk) throw new Error(`STEP export failed: ${result.error}`);
        return { state: readState(application), data: result.value, dataType: "step" };
    }
    if (msg.action === "save_document") {
        return {
            state: readState(application),
            data: JSON.stringify(serializeDocument(document)),
            dataType: "cd",
        };
    }
    if (msg.action === "render_preview") {
        const dataUrl = application.activeView?.toImage() ?? "";
        return { state: readState(application), data: dataUrl.split(",")[1] ?? "", dataType: "png" };
    }
    if (msg.action === "get_properties") {
        return {
            state: readState(application),
            data: JSON.stringify(measureDocument(document)),
            dataType: "properties",
        };
    }
    throw new Error(`unknown action: ${msg.action}`);
}
