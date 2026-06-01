// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Build a gear plate (disc + center bore + circular array of cut-out holes) live
// in the browser via the bridge.
//   npx tsx packages/mcp/scripts/live-gear.ts

import { BridgeController } from "../src/bridge/controller";

const c = new BridgeController();
await c.connect();

const state = await c.getState();
console.error("get_state:", JSON.stringify(state));
if (!state.ok) {
    console.error("NO_BROWSER — refresh the http://localhost:8080/?live tab");
    c.close();
    process.exit(1);
}
if (state.state && state.state.hasActiveDocument === false) {
    console.error("new_document:", JSON.stringify(await c.newDocument("gear-plate")));
}

const ops = [
    // disc: Ø80 x 8 thick
    { op: "cylinder", id: "disc", radius: 40, height: 8 },
    // center bore (taller than the disc so it cuts clean through)
    { op: "cylinder", id: "bore", radius: 8, height: 20, at: { x: 0, y: 0, z: -6 } },
    // one hole at radius 28, then arrayed 8x around the centre
    { op: "cylinder", id: "hole", radius: 4, height: 20, at: { x: 28, y: 0, z: -6 } },
    {
        op: "array",
        id: "holes",
        input: { ref: "hole" },
        mode: "circular",
        count: 8,
        center: { x: 0, y: 0, z: 0 },
        axis: { x: 0, y: 0, z: 1 },
        angle: 360,
    },
    // disc - bore - holes
    { op: "boolean", id: "withBore", kind: "cut", a: { ref: "disc" }, b: { ref: "bore" } },
    { op: "boolean", id: "gear", kind: "cut", a: { ref: "withBore" }, b: { ref: "holes" } },
];

console.error("run_cad_program:", JSON.stringify(await c.runProgram(ops as never)));
c.close();
