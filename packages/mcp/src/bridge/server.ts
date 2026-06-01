// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type WebSocket, WebSocketServer } from "ws";
import { type BridgeMessage, DEFAULT_BRIDGE_PORT } from "./protocol";

// A tiny relay: the browser app connects as "browser", MCP controllers connect as
// "controller". A controller's request is forwarded to the browser; the browser's
// response is routed back to the originating controller by request id.
export function startBridge(port: number = DEFAULT_BRIDGE_PORT): WebSocketServer {
    const wss = new WebSocketServer({ port });
    // Track every browser session; the most-recently-connected one that is still
    // open receives requests. This survives transient browsers (e.g. a refresh or
    // a test client) without orphaning a long-lived ?live tab.
    const browsers: WebSocket[] = [];
    const pending = new Map<string, WebSocket>();

    const activeBrowser = (): WebSocket | undefined => {
        while (
            browsers.length > 0 &&
            browsers[browsers.length - 1].readyState !== browsers[browsers.length - 1].OPEN
        ) {
            browsers.pop();
        }
        return browsers[browsers.length - 1];
    };

    wss.on("connection", (socket) => {
        socket.on("message", (data) => {
            let msg: BridgeMessage;
            try {
                msg = JSON.parse(data.toString());
            } catch {
                return;
            }

            if (msg.kind === "hello") {
                if (msg.role === "browser") browsers.push(socket);
                return;
            }

            if (msg.kind === "request") {
                const browser = activeBrowser();
                if (!browser) {
                    socket.send(
                        JSON.stringify({
                            kind: "response",
                            id: msg.id,
                            ok: false,
                            error: "No browser session connected. Open the app with ?live.",
                        }),
                    );
                    return;
                }
                pending.set(msg.id, socket);
                browser.send(JSON.stringify(msg));
                return;
            }

            if (msg.kind === "response") {
                const controller = pending.get(msg.id);
                pending.delete(msg.id);
                controller?.send(JSON.stringify(msg));
            }
        });

        socket.on("close", () => {
            const index = browsers.indexOf(socket);
            if (index >= 0) browsers.splice(index, 1);
        });
    });

    return wss;
}
