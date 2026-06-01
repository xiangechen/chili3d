// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import WebSocket from "ws";
import { DEFAULT_BRIDGE_URL, type Op, type RequestMessage, type ResponseMessage } from "./protocol";

// Controller side of the bridge (used by the MCP server / CLI): connects to the
// bridge and issues request/response calls that the browser executes on the live model.
export class BridgeController {
    private readonly ws: WebSocket;
    private seq = 0;
    private readonly pending = new Map<string, (response: ResponseMessage) => void>();
    private readonly ready: Promise<void>;

    constructor(url: string = DEFAULT_BRIDGE_URL) {
        this.ws = new WebSocket(url);
        this.ready = new Promise<void>((resolve, reject) => {
            this.ws.on("open", () => {
                this.ws.send(JSON.stringify({ kind: "hello", role: "controller" }));
                resolve();
            });
            this.ws.on("error", reject);
        });
        this.ws.on("message", (data) => {
            const msg = JSON.parse(data.toString());
            if (msg.kind === "response") {
                this.pending.get(msg.id)?.(msg);
                this.pending.delete(msg.id);
            }
        });
    }

    connect(): Promise<void> {
        return this.ready;
    }

    private request(
        payload: Omit<RequestMessage, "kind" | "id">,
        timeoutMs = 20000,
    ): Promise<ResponseMessage> {
        this.seq += 1;
        const id = String(this.seq);
        return new Promise<ResponseMessage>((resolve) => {
            const timer = setTimeout(() => {
                this.pending.delete(id);
                resolve({ kind: "response", id, ok: false, error: "bridge request timed out" });
            }, timeoutMs);
            this.pending.set(id, (response) => {
                clearTimeout(timer);
                resolve(response);
            });
            this.ws.send(JSON.stringify({ kind: "request", id, ...payload }));
        });
    }

    getState(): Promise<ResponseMessage> {
        return this.request({ action: "get_state" });
    }

    newDocument(name?: string): Promise<ResponseMessage> {
        return this.request({ action: "new_document", name });
    }

    runProgram(ops: Op[]): Promise<ResponseMessage> {
        return this.request({ action: "run_cad_program", ops });
    }

    exportStl(binary = true): Promise<ResponseMessage> {
        return this.request({ action: "export_stl", binary });
    }

    exportStep(): Promise<ResponseMessage> {
        return this.request({ action: "export_step" });
    }

    saveDocument(): Promise<ResponseMessage> {
        return this.request({ action: "save_document" });
    }

    renderPreview(): Promise<ResponseMessage> {
        return this.request({ action: "render_preview" });
    }

    getProperties(): Promise<ResponseMessage> {
        return this.request({ action: "get_properties" });
    }

    close(): void {
        this.ws.close();
    }
}
