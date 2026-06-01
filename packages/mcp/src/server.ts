// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Must be first: defines build-time globals before @chili3d/app is evaluated.
import "./globals";

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Logger } from "@chili3d/core";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { initHeadlessWasm } from "./headless";
import { createServer } from "./mcpServer";

// MCP speaks JSON-RPC over stdout. The core Logger (console.log/info/debug) and the
// Emscripten/OCCT runtime (which binds its output to console.log) would otherwise
// write plain text to stdout and corrupt the protocol stream. Re-route those to
// stderr. Must run before initHeadlessWasm(), as Emscripten captures console.log at
// module init. stderr still shows up in the MCP client's server logs.
const toStderr = (...args: unknown[]) => {
    console.error(...args);
};
console.log = toStderr;
console.info = toStderr;
console.debug = toStderr;
// In dev builds (__IS_PRODUCTION__ false) the core Logger captures direct references
// to console.log/debug at import time — BEFORE the reassignments above run — so the
// captured refs still point at the original stdout writer. Re-point them explicitly.
Logger.info = toStderr;
Logger.debug = toStderr;

async function main() {
    // The OCCT .wasm ships next to @chili3d/wasm; load its bytes for Node.
    const wasmPath = fileURLToPath(new URL("../../wasm/lib/chili-wasm.wasm", import.meta.url));
    await initHeadlessWasm(readFileSync(wasmPath));

    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
    // stdio transport keeps the process alive; tool calls arrive over stdin.
    console.error("chili3d-mcp server ready (stdio)");
}

main().catch((error) => {
    console.error("chili3d-mcp failed to start:", error);
    process.exitCode = 1;
});
