// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Build a 30x30x30 hollow cube in the live browser session via the bridge.
//   npx tsx packages/mcp/scripts/live-cube.ts

import { BridgeController } from "../src/bridge/controller";
import type { Op } from "../src/bridge/protocol";

const c = new BridgeController();
await c.connect();

const state = await c.getState();
console.error("get_state:", JSON.stringify(state));

if (!state.ok) {
    console.error("NO_BROWSER: refresh the http://localhost:8080/?live tab");
    c.close();
    process.exit(1);
}

if (state.state && state.state.hasActiveDocument === false) {
    console.error("new_document:", JSON.stringify(await c.newDocument("ai-live")));
}

const ops: Op[] = [
    { op: "box", id: "outer", dx: 30, dy: 30, dz: 30 },
    // inner cavity pokes through the top -> visibly hollow, 3mm walls
    { op: "box", id: "inner", dx: 24, dy: 24, dz: 40, at: { x: 3, y: 3, z: 3 } },
    { op: "boolean", id: "hollow", kind: "cut", a: { ref: "outer" }, b: { ref: "inner" } },
];
console.error("run_cad_program:", JSON.stringify(await c.runProgram(ops)));

c.close();
