// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { initWasm } from "@chili3d/wasm";
import { ShapeFactory } from "@chili3d/wasm";
import { Plane, XYZ, ShapeTypes, BoundingBox } from "@chili3d/core";
import { metresToMillimetres } from "../src/units";
import { beforeAll, describe, expect, test } from "@rstest/core";

let factory: ShapeFactory;

beforeAll(async () => {
    const wasmBinary = readFileSync(
        path.resolve(import.meta.dirname, "..", "..", "..", "packages", "wasm", "lib", "chili-wasm.wasm"),
    );
    await initWasm({ wasmBinary });
    factory = new ShapeFactory();
});

describe("T4: Real geometry — jib box length acceptance criterion", () => {
    test("real box at 30,000 mm has X-extent 30,000 mm", () => {
        const jibLengthMm = metresToMillimetres(30);
        const result = factory.box(Plane.XY, jibLengthMm, 2000, 2500);
        expect(result.isOk).toBe(true);
        if (!result.isOk) throw new Error(`box creation failed: ${result.error}`);

        const bbox: BoundingBox = result.value.boundingBox();
        const extentX = bbox.max.x - bbox.min.x;
        expect(extentX).toBe(30_000);
    });

    test("real box at 40,000 mm has X-extent 40,000 mm", () => {
        const jibLengthMm = metresToMillimetres(40);
        const result = factory.box(Plane.XY, jibLengthMm, 2000, 2500);
        expect(result.isOk).toBe(true);
        if (!result.isOk) throw new Error(`box creation failed: ${result.error}`);

        const bbox: BoundingBox = result.value.boundingBox();
        const extentX = bbox.max.x - bbox.min.x;
        expect(extentX).toBe(40_000);
    });

    test("jib length delta is exactly 10,000 mm (real geometry)", () => {
        const result30 = factory.box(Plane.XY, metresToMillimetres(30), 2000, 2500);
        const result40 = factory.box(Plane.XY, metresToMillimetres(40), 2000, 2500);

        expect(result30.isOk).toBe(true);
        expect(result40.isOk).toBe(true);
        if (!result30.isOk || !result40.isOk) throw new Error("box creation failed");

        const bbox30 = result30.value.boundingBox();
        const bbox40 = result40.value.boundingBox();

        const extent30 = bbox30.max.x - bbox30.min.x;
        const extent40 = bbox40.max.x - bbox40.min.x;

        expect(extent30).toBe(30_000);
        expect(extent40).toBe(40_000);
        expect(extent40 - extent30).toBe(10_000);
    });

    test("real box uses Plane.XY with origin at zero", () => {
        const jibLengthMm = metresToMillimetres(30);
        const result = factory.box(Plane.XY, jibLengthMm, 2000, 2500);
        expect(result.isOk).toBe(true);
        if (!result.isOk) throw new Error(`box creation failed: ${result.error}`);

        const bbox = result.value.boundingBox();
        // Box at Plane.XY with dx=30000 should have min.x=0, max.x=30000
        expect(bbox.min.x).toBe(0);
        expect(bbox.max.x).toBe(30_000);
        expect(bbox.min.y).toBe(0);
        expect(bbox.max.y).toBe(2000);
        expect(bbox.min.z).toBe(0);
        expect(bbox.max.z).toBe(2500);
    });
});