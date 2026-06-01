// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, test } from "@rstest/core";
import { createHeadlessApplication, initHeadlessWasm } from "../src/headless";
import { documentToStl, measureDocument } from "../src/pipeline";
import { runProgram } from "../src/program/interpreter";

const WASM = readFileSync(path.join(process.cwd(), "packages/wasm/lib/chili-wasm.wasm"));

beforeAll(async () => {
    await initHeadlessWasm(WASM);
});

// run a program and return the STL triangle count of the resulting model
async function tris(ops: any[]): Promise<number> {
    const app = createHeadlessApplication();
    const doc = await app.newDocument("t");
    runProgram(doc, { ops });
    const stl = documentToStl(app, doc, { binary: true });
    return new DataView(stl.buffer, stl.byteOffset, stl.byteLength).getUint32(80, true);
}

const P = (x: number, y: number, z: number) => ({ x, y, z });

describe("CAD ops — geometry smoke (every DSL op produces valid solids)", () => {
    test("primitives", async () => {
        expect(await tris([{ op: "box", id: "b", dx: 10, dy: 10, dz: 10 }])).toBeGreaterThanOrEqual(12);
        expect(await tris([{ op: "sphere", id: "s", radius: 8 }])).toBeGreaterThan(0);
        expect(await tris([{ op: "cylinder", id: "c", radius: 5, height: 12 }])).toBeGreaterThan(0);
        expect(await tris([{ op: "cone", id: "c", radius: 6, height: 12 }])).toBeGreaterThan(0);
        expect(await tris([{ op: "pyramid", id: "p", dx: 10, dy: 10, dz: 10 }])).toBeGreaterThan(0);
    });

    test("sketch -> extrude (rect/circle/polygon)", async () => {
        expect(
            await tris([
                { op: "rect", id: "r", dx: 20, dy: 10 },
                { op: "extrude", id: "e", section: { ref: "r" }, length: 5 },
            ]),
        ).toBeGreaterThan(0);
        expect(
            await tris([
                { op: "circle", id: "c", radius: 8 },
                { op: "extrude", id: "e", section: { ref: "c" }, length: 5 },
            ]),
        ).toBeGreaterThan(0);
        expect(
            await tris([
                { op: "polygon", id: "p", points: [P(0, 0, 0), P(10, 0, 0), P(5, 10, 0)] },
                { op: "extrude", id: "e", section: { ref: "p" }, length: 5 },
            ]),
        ).toBeGreaterThan(0);
    });

    test("revolve", async () => {
        expect(
            await tris([
                { op: "rect", id: "r", dx: 5, dy: 10, at: P(10, 0, 0) },
                {
                    op: "revolve",
                    id: "rv",
                    profile: { ref: "r" },
                    angle: 360,
                    axisOrigin: P(0, 0, 0),
                    axisDirection: P(0, 1, 0),
                },
            ]),
        ).toBeGreaterThan(0);
    });

    test("boolean fuse / cut / common", async () => {
        const two = (kind: string) => [
            { op: "box", id: "a", dx: 20, dy: 20, dz: 20 },
            { op: "box", id: "b", dx: 20, dy: 20, dz: 20, at: P(10, 10, 10) },
            { op: "boolean", id: "r", kind, a: { ref: "a" }, b: { ref: "b" } },
        ];
        expect(await tris(two("fuse"))).toBeGreaterThan(0);
        expect(await tris(two("cut"))).toBeGreaterThan(0);
        expect(await tris(two("common"))).toBeGreaterThan(0);
    });

    test("transforms move / rotate / mirror", async () => {
        expect(
            await tris([
                { op: "box", id: "b", dx: 10, dy: 10, dz: 10 },
                { op: "move", id: "m", input: { ref: "b" }, dx: 50, dy: 0, dz: 0 },
            ]),
        ).toBeGreaterThanOrEqual(12);
        expect(
            await tris([
                { op: "box", id: "b", dx: 10, dy: 20, dz: 30 },
                { op: "rotate", id: "r", input: { ref: "b" }, angle: 45 },
            ]),
        ).toBeGreaterThanOrEqual(12);
        expect(
            await tris([
                { op: "box", id: "b", dx: 10, dy: 10, dz: 10, at: P(5, 0, 0) },
                { op: "mirror", id: "mi", input: { ref: "b" }, planeNormal: P(1, 0, 0) },
            ]),
        ).toBeGreaterThanOrEqual(12);
    });

    test("array linear & circular", async () => {
        const single = await tris([{ op: "box", id: "b", dx: 10, dy: 10, dz: 10 }]);
        const linear = await tris([
            { op: "box", id: "b", dx: 10, dy: 10, dz: 10 },
            { op: "array", id: "a", input: { ref: "b" }, mode: "linear", count: 3, spacing: P(20, 0, 0) },
        ]);
        expect(linear).toBeGreaterThan(single);
        const circular = await tris([
            { op: "cylinder", id: "c", radius: 3, height: 10, at: P(20, 0, 0) },
            {
                op: "array",
                id: "a",
                input: { ref: "c" },
                mode: "circular",
                count: 6,
                center: P(0, 0, 0),
                axis: P(0, 0, 1),
                angle: 360,
            },
        ]);
        expect(circular).toBeGreaterThan(0);
    });

    test("pipe along a polyline path", async () => {
        expect(
            await tris([
                { op: "polyline", id: "p", points: [P(0, 0, 0), P(0, 0, 30), P(20, 0, 30)] },
                { op: "pipe", id: "pp", path: { ref: "p" }, radius: 3 },
            ]),
        ).toBeGreaterThan(0);
    });

    test("sweep a closed profile along a line", async () => {
        expect(
            await tris([
                {
                    op: "polyline",
                    id: "prof",
                    points: [P(0, 0, 0), P(6, 0, 0), P(6, 6, 0), P(0, 6, 0)],
                    closed: true,
                },
                { op: "line", id: "path", start: P(0, 0, 0), end: P(0, 0, 30) },
                { op: "sweep", id: "sw", profile: { ref: "prof" }, path: { ref: "path" }, round: false },
            ]),
        ).toBeGreaterThan(0);
    });

    test("shell hollows a solid (more faces than the solid)", async () => {
        const solid = await tris([{ op: "box", id: "b", dx: 20, dy: 20, dz: 20 }]);
        const hollow = await tris([
            { op: "box", id: "b", dx: 20, dy: 20, dz: 20 },
            { op: "shell", id: "s", input: { ref: "b" }, thickness: 2 },
        ]);
        expect(hollow).toBeGreaterThan(solid);
    });

    test("to_face turns a custom wire into an extrudable profile", async () => {
        expect(
            await tris([
                {
                    op: "polyline",
                    id: "w",
                    points: [P(0, 0, 0), P(20, 0, 0), P(20, 10, 0), P(10, 16, 0), P(0, 10, 0)],
                    closed: true,
                },
                { op: "to_face", id: "f", input: { ref: "w" } },
                { op: "extrude", id: "e", section: { ref: "f" }, length: 8 },
            ]),
        ).toBeGreaterThan(0);
    });

    test("loft between two closed sections", async () => {
        expect(
            await tris([
                {
                    op: "polyline",
                    id: "bottom",
                    points: [P(0, 0, 0), P(20, 0, 0), P(20, 20, 0), P(0, 20, 0)],
                    closed: true,
                },
                {
                    op: "polyline",
                    id: "top",
                    points: [P(6, 6, 25), P(14, 6, 25), P(14, 14, 25), P(6, 14, 25)],
                    closed: true,
                },
                { op: "loft", id: "lf", sections: [{ ref: "bottom" }, { ref: "top" }], isSolid: true },
            ]),
        ).toBeGreaterThan(0);
    });

    test("fillet / chamfer all edges of a box", async () => {
        const box = await tris([{ op: "box", id: "b", dx: 20, dy: 20, dz: 20 }]);
        expect(
            await tris([
                { op: "box", id: "b", dx: 20, dy: 20, dz: 20 },
                { op: "fillet", id: "f", input: { ref: "b" }, radius: 2 },
            ]),
        ).toBeGreaterThan(box);
        expect(
            await tris([
                { op: "box", id: "b", dx: 20, dy: 20, dz: 20 },
                { op: "chamfer", id: "c", input: { ref: "b" }, distance: 2 },
            ]),
        ).toBeGreaterThan(box);
    });

    test("get_properties: bounding box + volume", async () => {
        const app = createHeadlessApplication();
        const doc = await app.newDocument("m");
        runProgram(doc, { ops: [{ op: "box", id: "b", dx: 10, dy: 10, dz: 10 }] });
        const props = measureDocument(doc);
        expect(props.totalVolume).toBeGreaterThan(900);
        expect(props.totalVolume).toBeLessThan(1100);
        expect(props.boundingBox?.size.x ?? 0).toBeCloseTo(10, 0);
    });

    // Regression: a boolean result is a compound, not a bare solid — measureDocument
    // must descend into sub-solids or it reports volume 0 (caught in live bell-crank test).
    test("get_properties: volume of a boolean-cut compound is non-zero", async () => {
        const app = createHeadlessApplication();
        const doc = await app.newDocument("m");
        runProgram(doc, {
            ops: [
                { op: "box", id: "b", dx: 20, dy: 20, dz: 20 },
                { op: "cylinder", id: "d", radius: 5, height: 30, at: P(10, 10, -5) },
                { op: "boolean", id: "cut", kind: "cut", a: { ref: "b" }, b: { ref: "d" } },
            ],
        });
        const props = measureDocument(doc);
        // 20^3 = 8000 minus a Ø10 through-hole (~1571) ≈ 6429
        expect(props.totalVolume).toBeGreaterThan(6000);
        expect(props.totalVolume).toBeLessThan(7000);
    });
});
