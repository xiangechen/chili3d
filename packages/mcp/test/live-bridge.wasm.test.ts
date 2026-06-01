// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import type { IApplication, IDocument } from "@chili3d/core";
import { afterAll, beforeAll, describe, expect, test } from "@rstest/core";
import type { WebSocketServer } from "ws";
import WebSocket from "ws";
import { BridgeController } from "../src/bridge/controller";
import { startBridge } from "../src/bridge/server";
import { createHeadlessApplication, initHeadlessWasm } from "../src/headless";
import { collectShapes, measureDocument, serializeDocument } from "../src/pipeline";
import { runProgram } from "../src/program/interpreter";

const WASM = readFileSync(path.join(process.cwd(), "packages/wasm/lib/chili-wasm.wasm"));
const PORT = 8799;
const URL = `ws://localhost:${PORT}`;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Stand-in for the ?live browser: it runs the SAME export logic as packages/web/src/live.ts
// (collectShapes / measureDocument / serializeDocument / converter) against a headless document.
// This proves the bridge protocol + controller + base64 round-trip end-to-end without a real browser.
// (toImage / render_preview needs a real Three.js canvas and is verified manually in the browser.)
function attachFakeBrowser(ws: WebSocket, app: IApplication, document: IDocument) {
    ws.on("open", () => ws.send(JSON.stringify({ kind: "hello", role: "browser" })));
    ws.on("message", (raw) => {
        const msg = JSON.parse(raw.toString());
        if (msg.kind !== "request") return;
        try {
            let payload: Record<string, unknown> = {};
            if (msg.action === "run_cad_program") {
                runProgram(document, { ops: msg.ops });
                payload = { state: { hasActiveDocument: true, nodeCount: 1 } };
            } else if (msg.action === "export_stl") {
                const r = app.shapeFactory.converter.convertToSTL(collectShapes(document), {
                    binary: msg.binary ?? true,
                });
                if (!r.isOk) throw new Error(r.error);
                payload = { data: Buffer.from(r.value).toString("base64"), dataType: "stl" };
            } else if (msg.action === "export_step") {
                const r = app.shapeFactory.converter.convertToSTEP(...collectShapes(document));
                if (!r.isOk) throw new Error(r.error);
                payload = { data: r.value, dataType: "step" };
            } else if (msg.action === "save_document") {
                payload = { data: JSON.stringify(serializeDocument(document)), dataType: "cd" };
            } else if (msg.action === "get_properties") {
                payload = { data: JSON.stringify(measureDocument(document)), dataType: "properties" };
            }
            ws.send(JSON.stringify({ kind: "response", id: msg.id, ok: true, ...payload }));
        } catch (error) {
            ws.send(JSON.stringify({ kind: "response", id: msg.id, ok: false, error: String(error) }));
        }
    });
}

describe("live bridge round-trip (controller <-> bridge <-> browser stand-in)", () => {
    let wss: WebSocketServer;
    let browser: WebSocket;
    let controller: BridgeController;

    beforeAll(async () => {
        await initHeadlessWasm(WASM);
        const app = createHeadlessApplication();
        const document = await app.newDocument("live-test");
        wss = startBridge(PORT);
        browser = new WebSocket(URL);
        attachFakeBrowser(browser, app, document);
        await new Promise<void>((resolve) => browser.on("open", () => resolve()));
        await delay(100); // let the bridge register the browser before the controller calls in
        controller = new BridgeController(URL);
        await controller.connect();
    });

    afterAll(() => {
        controller?.close();
        browser?.close();
        wss?.close();
    });

    test("run_cad_program then export STL / STEP / .cd / measure", async () => {
        const run = await controller.runProgram([{ op: "box", id: "b", dx: 10, dy: 10, dz: 10 } as never]);
        expect(run.ok).toBe(true);

        const stl = await controller.exportStl(true);
        expect(stl.ok).toBe(true);
        const stlBytes = Buffer.from(stl.data ?? "", "base64");
        const tris = new DataView(stlBytes.buffer, stlBytes.byteOffset, stlBytes.byteLength).getUint32(
            80,
            true,
        );
        expect(tris).toBeGreaterThanOrEqual(12); // a box meshes to >= 12 triangles

        const step = await controller.exportStep();
        expect(step.ok).toBe(true);
        expect(step.data).toContain("ISO-10303"); // STEP header signature

        const cd = await controller.saveDocument();
        expect(cd.ok).toBe(true);
        expect(() => JSON.parse(cd.data ?? "")).not.toThrow();

        const props = await controller.getProperties();
        expect(props.ok).toBe(true);
        const measured = JSON.parse(props.data ?? "{}");
        expect(measured.totalVolume).toBeGreaterThan(900);
        expect(measured.totalVolume).toBeLessThan(1100);
    });
});
