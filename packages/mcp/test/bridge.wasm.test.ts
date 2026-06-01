// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Node-env test (no WASM): the bridge relays controller<->browser messages.
import { describe, expect, test } from "@rstest/core";
import WebSocket from "ws";
import { startBridge } from "../src/bridge/server";

function open(ws: WebSocket): Promise<void> {
    return new Promise((resolve, reject) => {
        ws.on("open", () => resolve());
        ws.on("error", reject);
    });
}

function once(ws: WebSocket): Promise<any> {
    return new Promise((resolve) => ws.once("message", (d) => resolve(JSON.parse(d.toString()))));
}

describe("live bridge relay", () => {
    test("forwards a controller request to the browser and routes the response back", async () => {
        const wss = startBridge(8799);
        const url = "ws://localhost:8799";

        const browser = new WebSocket(url);
        await open(browser);
        browser.send(JSON.stringify({ kind: "hello", role: "browser" }));
        // browser echoes a canned state for any request
        browser.on("message", (d) => {
            const msg = JSON.parse(d.toString());
            if (msg.kind === "request") {
                browser.send(
                    JSON.stringify({
                        kind: "response",
                        id: msg.id,
                        ok: true,
                        state: { hasActiveDocument: true, nodeCount: 42 },
                    }),
                );
            }
        });

        const controller = new WebSocket(url);
        await open(controller);
        controller.send(JSON.stringify({ kind: "hello", role: "controller" }));
        const responsePromise = once(controller);
        controller.send(JSON.stringify({ kind: "request", id: "req-1", action: "get_state" }));
        const response = await responsePromise;

        expect(response.id).toBe("req-1");
        expect(response.ok).toBe(true);
        expect(response.state.nodeCount).toBe(42);

        controller.close();
        browser.close();
        wss.close();
    });

    test("responds with an error when no browser session is connected", async () => {
        const wss = startBridge(8798);
        const controller = new WebSocket("ws://localhost:8798");
        await open(controller);
        controller.send(JSON.stringify({ kind: "hello", role: "controller" }));
        const responsePromise = once(controller);
        controller.send(JSON.stringify({ kind: "request", id: "req-2", action: "get_state" }));
        const response = await responsePromise;

        expect(response.ok).toBe(false);
        expect(response.error).toContain("No browser");

        controller.close();
        wss.close();
    });
});
