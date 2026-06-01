// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Spawn the bundled server over real stdio (exactly like Claude Desktop) and call
// a heavily-logging tool. If stdout were polluted with non-JSON, the SDK client
// would throw a JSON parse error here — reaching STDIO_CHECK_PASS proves it is clean.
//   npx tsx packages/mcp/scripts/stdio-check.ts   (run `npm run build` first)

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
    command: "node",
    args: ["packages/mcp/dist/server.mjs"],
});
const client = new Client({ name: "stdio-check", version: "1.0.0" });
await client.connect(transport);

const tools = await client.listTools();
console.error("tools:", tools.tools.map((t) => t.name).join(", "));

const result = await client.callTool({ name: "make_box", arguments: { dx: 10, dy: 20, dz: 30 } });
console.error("make_box content items:", (result.content as unknown[]).length);

await client.close();
console.error("STDIO_CHECK_PASS");
