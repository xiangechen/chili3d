// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

// Live self-test as the mechanical-engineer persona: build a bell crank (鐘形曲柄)
// — an L-shaped pivoting lever that converts a vertical input force to a horizontal
// output. Drives the bridge exactly like the live_* MCP tools (same core).
//   pivot (10,10)  input pin (50,10)  output pin (10,30)
//   arm ratio L_in/L_out = 40/20 = MA 2.0 ; plate thickness 8 mm
//   intended bbox (60,40,8) mm ; intended volume ~11719 mm^3

import { writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { BridgeController } from "../src/bridge/controller";

const P = (x: number, y: number, z: number) => ({ x, y, z });
const t = 8;

const ops: unknown[] = [
    // L-shaped flat profile in the XY plane (pivot corner at origin), both arms 20 wide
    {
        op: "polyline",
        id: "Lprofile",
        points: [P(0, 0, 0), P(60, 0, 0), P(60, 20, 0), P(20, 20, 0), P(20, 40, 0), P(0, 40, 0)],
        closed: true,
    },
    { op: "to_face", id: "Lface", input: { ref: "Lprofile" } },
    { op: "extrude", id: "plate", section: { ref: "Lface" }, length: t }, // editable extrude, z[0,8]
    // through-holes: base at z=-1, height 10 -> span z[-1,9] guarantees a clean cut through z[0,8]
    { op: "cylinder", id: "pivot_drill", radius: 5, height: 10, at: P(10, 10, -1) }, // pivot Ø10
    { op: "cylinder", id: "in_drill", radius: 3, height: 10, at: P(50, 10, -1) }, // input pin Ø6
    { op: "cylinder", id: "out_drill", radius: 3, height: 10, at: P(10, 30, -1) }, // output pin Ø6
    { op: "boolean", id: "c1", kind: "cut", a: { ref: "plate" }, b: { ref: "pivot_drill" } },
    { op: "boolean", id: "c2", kind: "cut", a: { ref: "c1" }, b: { ref: "in_drill" } },
    { op: "boolean", id: "bellcrank", kind: "cut", a: { ref: "c2" }, b: { ref: "out_drill" } },
];

async function main() {
    const c = new BridgeController();
    await c.connect();

    const state = await c.getState();
    console.log("STATE " + JSON.stringify(state));
    if (!state.ok) {
        console.log(
            "NO_BROWSER — open the app at http://localhost:8080/?live and ensure the bridge is running",
        );
        c.close();
        return;
    }
    // Persona rule §4: ask before creating a doc when none is open. The user explicitly
    // asked to build a part (= consent), so we create one if the live session is empty.
    if (!state.state?.hasActiveDocument) {
        console.log("NEW_DOC " + JSON.stringify(await c.newDocument("bellcrank-demo")));
    }

    console.log("RUN " + JSON.stringify(await c.runProgram(ops as never)));

    const props = await c.getProperties();
    console.log("PROPS " + (props.data ?? JSON.stringify(props)));

    const prev = await c.renderPreview();
    if (prev.ok && prev.data) {
        const pngPath = path.join(os.tmpdir(), "chili3d-bellcrank.png");
        writeFileSync(pngPath, Buffer.from(prev.data, "base64"));
        console.log("PREVIEW " + pngPath);
    } else {
        console.log("PREVIEW_FAIL " + JSON.stringify(prev));
    }

    const step = await c.exportStep();
    if (step.ok && step.data) {
        const stepPath = path.join(os.tmpdir(), "chili3d-bellcrank.step");
        writeFileSync(stepPath, step.data, "utf8");
        console.log("STEP " + stepPath + " (" + step.data.length + " bytes)");
    } else {
        console.log("STEP_FAIL " + JSON.stringify(step));
    }

    c.close();
}

main().catch((e) => {
    console.error("ERR " + e);
    process.exit(1);
});
