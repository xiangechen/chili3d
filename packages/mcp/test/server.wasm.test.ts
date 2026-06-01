// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { describe, expect, test } from "@rstest/core";
import { initHeadlessWasm } from "../src/headless";
import { createServer } from "../src/mcpServer";

const WASM_BINARY = readFileSync(path.join(process.cwd(), "packages/wasm/lib/chili-wasm.wasm"));

describe("MCP server", () => {
    test("an MCP client calls make_box and gets valid STL + an editable .cd", async () => {
        await initHeadlessWasm(WASM_BINARY);

        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        const server = createServer();
        await server.connect(serverTransport);

        const client = new Client({ name: "test-client", version: "1.0.0" });
        await client.connect(clientTransport);

        // tool is advertised
        const tools = await client.listTools();
        expect(tools.tools.map((t) => t.name)).toContain("make_box");

        const outPath = path.join(os.tmpdir(), "chili3d-mcp-make-box.stl");
        const result = await client.callTool({
            name: "make_box",
            arguments: { dx: 10, dy: 20, dz: 30, outPath },
        });

        const content = result.content as Array<{ type: string; text: string }>;
        expect(content[0].text).toContain("Created box");

        // STL file is written and well-formed
        const stl = readFileSync(outPath);
        const view = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
        expect(view.getUint32(80, true)).toBeGreaterThanOrEqual(12);

        // an editable parametric .cd was returned (not a dead mesh)
        const cd = JSON.parse(content[1].text);
        expect(cd["__cla$$__"]).toBe("Document");
        expect(JSON.stringify(cd)).toContain("BoxNode");

        await client.close();
        await server.close();
    });

    test("run_cad_program then export_stl across calls (session continuity)", async () => {
        await initHeadlessWasm(WASM_BINARY);

        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        const server = createServer();
        await server.connect(serverTransport);
        const client = new Client({ name: "test-client", version: "1.0.0" });
        await client.connect(clientTransport);

        const prog = await client.callTool({
            name: "run_cad_program",
            arguments: {
                ops: [
                    { op: "box", id: "b", dx: 10, dy: 10, dz: 10 },
                    { op: "sphere", id: "s", radius: 6, at: { x: 5, y: 5, z: 5 } },
                ],
            },
        });
        const progOut = JSON.parse((prog.content as Array<{ text: string }>)[0].text);
        expect(typeof progOut.documentId).toBe("string");
        expect(progOut.nodeCount).toBe(2);

        const outPath = path.join(os.tmpdir(), "chili3d-prog.stl");
        const exported = await client.callTool({
            name: "export_stl",
            arguments: { documentId: progOut.documentId, outPath },
        });
        const expOut = JSON.parse((exported.content as Array<{ text: string }>)[0].text);
        expect(expOut.triangles).toBeGreaterThan(0);
        expect(readFileSync(outPath).byteLength).toBe(expOut.bytes);

        await client.close();
        await server.close();
    });

    test("closed loop: run_cad_program -> render_preview -> export_stl", async () => {
        await initHeadlessWasm(WASM_BINARY);

        const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
        const server = createServer();
        await server.connect(serverTransport);
        const client = new Client({ name: "test-client", version: "1.0.0" });
        await client.connect(clientTransport);

        const prog = await client.callTool({
            name: "run_cad_program",
            arguments: {
                ops: [
                    { op: "rect", id: "r", dx: 20, dy: 20 },
                    { op: "extrude", id: "e", section: { ref: "r" }, length: 10 },
                ],
            },
        });
        const { documentId } = JSON.parse((prog.content as Array<{ text: string }>)[0].text);

        // AI looks at the model
        const preview = await client.callTool({
            name: "render_preview",
            arguments: { documentId, size: 128 },
        });
        const image = (preview.content as Array<{ type: string; data: string; mimeType: string }>)[0];
        expect(image.type).toBe("image");
        expect(image.mimeType).toBe("image/png");
        const png = Buffer.from(image.data, "base64");
        expect([...png.subarray(0, 4)]).toEqual([137, 80, 78, 71]);

        // AI exports
        const outPath = path.join(os.tmpdir(), "chili3d-loop.stl");
        const exported = await client.callTool({ name: "export_stl", arguments: { documentId, outPath } });
        expect(JSON.parse((exported.content as Array<{ text: string }>)[0].text).triangles).toBeGreaterThan(
            0,
        );

        await client.close();
        await server.close();
    });
});
