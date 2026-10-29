// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { initWasm } from "@chili3d/wasm";
import { OccShapeProvider } from "@chili3d/wasm";
import { setCurrentApplication, getCurrentApplication } from "@chili3d/core";
import { Plane, XYZ, ShapeTypes, BoundingBox } from "@chili3d/core";
import { metresToMillimetres, MCT88 } from "../src/catalogue";
import { TowerCraneBodyNode } from "../src/body/towerCraneBody";
import { createMockDocument } from "@chili3d/core/test-utils";
import { beforeAll, beforeEach, describe, expect, test } from "@rstest/core";

let provider: OccShapeProvider;

beforeAll(async () => {
    const wasmBinary = readFileSync(
        path.resolve(import.meta.dirname, "..", "..", "..", "packages", "wasm", "lib", "chili-wasm.wasm"),
    );
    await initWasm({ wasmBinary });
    provider = new OccShapeProvider();

    // Set up application with real shape provider
    const app = {
        shapeProvider: provider,
        views: [],
    } as any;
    setCurrentApplication(app);
});

describe("T4: Real geometry — TowerCraneBodyNode integration", () => {
    let doc: ReturnType<typeof createMockDocument>;

    beforeEach(() => {
        doc = createMockDocument();
    });

    test("TowerCraneBodyNode generates real geometry with 30 m jib", () => {
        const node = new TowerCraneBodyNode({ document: doc, crane: MCT88, jibLengthM: 30 });
        const result = node.generateShape();

        expect(result.isOk).toBe(true);
        if (!result.isOk) throw new Error(`generateShape failed: ${result.error}`);

        // The result is a compound; find the jib component
        const solids = result.value.findSubShapes(ShapeTypes.solid);
        expect(solids.length).toBeGreaterThanOrEqual(1);

        // Find the jib by checking X-extent of each solid
        let jibFound = false;
        for (const solid of solids) {
            const bbox = solid.boundingBox();
            const extentX = bbox.max.x - bbox.min.x;
            // Jib should be ~30,000 mm in X, positioned at positive X from origin
            if (Math.abs(extentX - 30_000) < 100 && bbox.min.x >= -100) {
                jibFound = true;
                expect(extentX).toBe(30_000);
                break;
            }
        }
        expect(jibFound).toBe(true);
    });

    test("TowerCraneBodyNode regenerates geometry when jibLengthM changes to 40 m", () => {
        const node = new TowerCraneBodyNode({ document: doc, crane: MCT88, jibLengthM: 30 });
        const result30 = node.generateShape();
        expect(result30.isOk).toBe(true);

        // Find jib extent at 30 m
        let jibExtent30 = 0;
        if (result30.isOk) {
            const solids = result30.value.findSubShapes(ShapeTypes.solid);
            for (const solid of solids) {
                const bbox = solid.boundingBox();
                const extentX = bbox.max.x - bbox.min.x;
                if (Math.abs(extentX - 30_000) < 100 && bbox.min.x >= -100) {
                    jibExtent30 = extentX;
                    break;
                }
            }
        }
        expect(jibExtent30).toBe(30_000);

        // Change jib length to 40 m
        node.jibLengthM = 40;
        const result40 = node.generateShape();
        expect(result40.isOk).toBe(true);

        // Find jib extent at 40 m
        let jibExtent40 = 0;
        if (result40.isOk) {
            const solids = result40.value.findSubShapes(ShapeTypes.solid);
            for (const solid of solids) {
                const bbox = solid.boundingBox();
                const extentX = bbox.max.x - bbox.min.x;
                if (Math.abs(extentX - 40_000) < 100 && bbox.min.x >= -100) {
                    jibExtent40 = extentX;
                    break;
                }
            }
        }
        expect(jibExtent40).toBe(40_000);

        // Verify delta
        expect(jibExtent40 - jibExtent30).toBe(10_000);
    });

    test("jib is positioned correctly along +X from slewing unit center", () => {
        const node = new TowerCraneBodyNode({ document: doc, crane: MCT88, jibLengthM: 30 });
        const result = node.generateShape();
        expect(result.isOk).toBe(true);
        if (!result.isOk) throw new Error(`generateShape failed: ${result.error}`);

        const solids = result.value.findSubShapes(ShapeTypes.solid);
        for (const solid of solids) {
            const bbox = solid.boundingBox();
            const extentX = bbox.max.x - bbox.min.x;
            if (Math.abs(extentX - 30_000) < 100 && bbox.min.x >= -100) {
                // Jib should start at x=0 (slewing unit center) and extend to +30,000
                expect(bbox.min.x).toBe(0);
                expect(bbox.max.x).toBe(30_000);
                break;
            }
        }
    });
});