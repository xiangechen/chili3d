// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Start the live bridge that connects the browser session to the MCP server.
//   npm run bridge -w @chili3d/mcp   (optionally pass a port)

import { DEFAULT_BRIDGE_PORT } from "../src/bridge/protocol";
import { startBridge } from "../src/bridge/server";

const port = Number(process.argv[2] ?? DEFAULT_BRIDGE_PORT);
startBridge(port);
console.error(`chili3d live bridge listening on ws://localhost:${port}`);
console.error("Open the app at http://localhost:8080/?live and point the MCP server here.");
