// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Drive the LIVE tools through the real stdio server (exactly as Claude Desktop
// does): spawn the bundled server, which connects to the running bridge as a
// controller; the browser tab open at /?live renders the result.
//   npx tsx packages/mcp/scripts/live-stdio-send.ts

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({ command: "node", args: ["packages/mcp/dist/server.mjs"] });
const client = new Client({ name: "live-stdio-send", version: "1.0.0" });
await client.connect(transport);

const call = async (name: string, args: Record<string, unknown>) => {
    const r = await client.callTool({ name, arguments: args });
    console.error(`${name}:`, JSON.stringify((r.content as Array<{ text: string }>)[0]?.text ?? r.content));
};

await call("live_get_state", {});
await call("live_new_document", { name: "ai-session" });
await call("live_run_cad_program", { ops: [{ op: "box", id: "b", dx: 30, dy: 30, dz: 30 }] });

await client.close();
