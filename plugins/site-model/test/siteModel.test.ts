// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { readFileSync } from "node:fs";
import path from "node:path";
import { ShapeTypes } from "@chili3d/core";
import { initWasm } from "@chili3d/wasm";
import { createTestFactory } from "../../../packages/wasm/test/helpers";
import {
    calculateExactFilletedRectArea,
    calculatePolygonArea,
    parseDxfToSite,
    sampleArc,
} from "../src/dxfParser";
import { extrudeBuildingSolid, getSolidVolumeM3 } from "../src/extrusion";
import { loadProjectJson, saveProjectJson, validateSiteProject } from "../src/schema";
import { metresToMm, mmToMetres, REQUIRED_DISCLAIMER } from "../src/types";

// Load WASM kernel for 3D extrusion tests
const WASM_BINARY = readFileSync(
    path.resolve(import.meta.dirname, "../../../packages/wasm/lib/chili-wasm.wasm"),
);

beforeAll(async () => {
    await initWasm({ wasmBinary: WASM_BINARY });
});

describe("DGOC Site Model Plugin (Ajit Lead)", () => {
    const sampleDxfPath = path.resolve(import.meta.dirname, "../../../public/sample-site/sample-site.dxf");
    const sampleDxfContent = readFileSync(sampleDxfPath, "utf-8");

    const sampleJsonPath = path.resolve(import.meta.dirname, "../../../public/sample-site/sample-site.json");
    const sampleJsonContent = readFileSync(sampleJsonPath, "utf-8");
    const sampleJsonData = JSON.parse(sampleJsonContent);

    // =========================================================================
    // S1: DXF Import via dxf-parser
    // =========================================================================
    describe("S1: DXF import via dxf-parser into project JSON", () => {
        /*
         * HAND CALCULATION:
         * Plot dimensions: Width = 90.0 m, Depth = 72.0 m.
         * Full rectangular area = 90.0 * 72.0 = 6480.0 m².
         * The North-East corner has an inward fillet arc with Radius R = 10.0 m.
         * The corner cutout from a rectangle is a square corner (R x R = 10 x 10 = 100 m²)
         * minus the quarter-circle area enclosed:
         *   Area_quarter_circle = 0.25 * π * R² = 0.25 * π * 100 = 25π ≈ 78.5398 m².
         * Corner cutout area = 100 - 78.5398 = 21.4602 m².
         * Net exact area = 6480.0 - 21.4602 = 6458.5398 m² ≈ 6458.54 m².
         * Acceptance criterion: ≤ 0.5 % of exact area (within ± 32.29 m²).
         *
         * REAL-DXF VERIFICATION:
         * All coordinates come from the DXF file's SITE_BOUNDARY layer — none
         * are hard-coded in parseDxfToSite. The shoelace formula is applied to
         * the chained polygon; the result should equal the hand value within 0.5 %.
         */
        test("sample-site.dxf loads, boundary closes as a loop, NE arc converts radians, area within 0.5%", () => {
            const site = parseDxfToSite(sampleDxfContent);

            // 1. Plot boundary exists
            expect(site.boundary).toBeDefined();
            expect(site.boundary.width_m).toBeCloseTo(90.0, 4);
            expect(site.boundary.depth_m).toBeCloseTo(72.0, 4);
            expect(site.boundary.ne_corner_arc_r).toBeCloseTo(10.0, 4);

            // 2. Polygon has enough vertices to represent the boundary
            const poly = site.boundary.polygon;
            expect(poly.length).toBeGreaterThanOrEqual(5);

            // 3. Hand-calculated reference area (for tolerance comparison only)
            const exactHandArea = calculateExactFilletedRectArea(90, 72, 10);
            expect(exactHandArea).toBeCloseTo(6458.54, 1);

            // 4. area_m2 is the shoelace result on the real DXF polygon —
            //    compare THAT against the hand value (not formula vs formula)
            const percentageDiff = Math.abs(site.boundary.area_m2 - exactHandArea) / exactHandArea;
            expect(percentageDiff).toBeLessThan(0.005); // within 0.5 %

            // 5. Verify buildings were detected by label — NOT by hardcoded coords
            expect(site.buildings.tower_a).toBeDefined();
            expect(site.buildings.tower_b).toBeDefined();
            expect(site.buildings.podium).toBeDefined();

            // 6. Hazards
            expect(site.no_go_zones.length).toBeGreaterThan(0);
            expect(site.no_go_zones[0].id).toBe("well");
            expect(site.no_go_zones[0].radius_m).toBeCloseTo(4.0, 4);
            expect(site.road).toBeDefined();
            expect(site.power_line).toBeDefined();
            expect(site.power_line?.clearance_m).toBeCloseTo(6.0, 4);
        });

        /*
         * REAL DXF SHIFT TEST — Sir's review requirement (PR #4):
         * "Your shift test moves the output polygon in JavaScript, so a hard-coded
         *  parser would pass it too. Shift the DXF text itself (every group 10/20/11/21
         *  value +100), parse that, and check the area and the minimum x/y."
         *
         * HAND CHECK:
         * Original DXF plot boundary: X in [0, 90], Y in [0, 72].
         * When every DXF coordinate (groups 10, 20, 11, 21) is shifted by +100.0 m in the text:
         *   - Bounding box min X shifts from 0.0 m to 100.0 m.
         *   - Bounding box min Y shifts from 0.0 m to 100.0 m.
         *   - Chained boundary width (90.0 m) and depth (72.0 m) remain unchanged.
         *   - Shoelace area remains exactly 6458.54 m² (translation-invariant).
         *   - Tower A footprint shifts from [25, 20] to [125, 120].
         *
         * This proves the parser is truly reading coordinates from the DXF text,
         * not returning any cached or hardcoded numbers.
         */
        test("shift DXF text coordinates by +100 m: area unchanged at 6458.5 m², min x/y move to 100 m", () => {
            const OFFSET = 100.0;

            // Helper: shift all DXF coordinate pairs (groups 10, 20, 11, 21) in the text itself
            function shiftDxfText(dxfText: string, offset: number): string {
                const lines = dxfText.split(/\r?\n/);
                const coordCodes = new Set(["10", "20", "11", "21"]);
                for (let i = 0; i < lines.length - 1; i++) {
                    if (coordCodes.has(lines[i].trim())) {
                        const val = parseFloat(lines[i + 1].trim());
                        if (!Number.isNaN(val)) {
                            lines[i + 1] = (val + offset).toFixed(4);
                        }
                    }
                }
                return lines.join("\n");
            }

            const shiftedDxfContent = shiftDxfText(sampleDxfContent, OFFSET);

            // Parse the shifted DXF file directly through dxf-parser
            const shiftedSite = parseDxfToSite(shiftedDxfContent);

            // 1. Area must remain unchanged (translation-invariant)
            expect(shiftedSite.boundary.area_m2).toBeCloseTo(6458.54, 1);

            // 2. Plot dimensions remain 90 x 72 m
            expect(shiftedSite.boundary.width_m).toBeCloseTo(90.0, 4);
            expect(shiftedSite.boundary.depth_m).toBeCloseTo(72.0, 4);

            // 3. Bounding box minimums must be exactly (100, 100)
            const minX = Math.min(...shiftedSite.boundary.polygon.map((p) => p.x));
            const minY = Math.min(...shiftedSite.boundary.polygon.map((p) => p.y));
            expect(minX).toBeCloseTo(100.0, 3);
            expect(minY).toBeCloseTo(100.0, 3);

            // 4. Tower A must be detected with shifted coordinates (X: 125..165, Y: 120..142)
            expect(shiftedSite.buildings.tower_a).toBeDefined();
            const towerAXs = shiftedSite.buildings.tower_a.polygon.map((p) => p.x);
            const towerAYs = shiftedSite.buildings.tower_a.polygon.map((p) => p.y);
            expect(Math.min(...towerAXs)).toBeCloseTo(125.0, 3);
            expect(Math.min(...towerAYs)).toBeCloseTo(120.0, 3);
        });

        /*
         * BOUNDARY LOOP CLOSURE TEST — Sir's review requirement (PR #4):
         * "Throw an error if the boundary loop doesn't close, and add a test for it."
         */
        test("throws an error if the boundary loop does not close", () => {
            // Remove one boundary LINE from SITE_BOUNDARY so the loop is open
            const brokenDxf = sampleDxfContent.replace(
                /8\r?\nSITE_BOUNDARY\r?\n100\r?\nAcDbLine/,
                "8\r\nOPEN_BOUNDARY\r\n100\r\nAcDbLine",
            );
            expect(brokenDxf).not.toBe(sampleDxfContent);
            expect(() => parseDxfToSite(brokenDxf)).toThrow(/Boundary loop does not close/i);
        });

        /*
         * ENTITY COUNT TEST:
         * Verify that the DXF entities are not silently dropped.
         * Expected from sample-site.dxf:
         *   BUILDING_PROPOSED: tower_a, podium, tower_b (3)
         *   TEMP_WORKS:        site_office             (1)
         *   NEIGHBOUR:         nb_east, nb_north        (2)
         *   SUPPLY_ZONE:       rebar_yard, formwork, pump (3)
         */
        test("entity counts match expected: 4 proposed buildings, 2 neighbours, 3 supply zones", () => {
            const site = parseDxfToSite(sampleDxfContent);

            const proposed = Object.values(site.buildings).filter(
                (b) => b.layer === "BUILDING_PROPOSED" || b.layer === "TEMP_WORKS",
            );
            const neighbours = Object.values(site.buildings).filter((b) => b.isNeighbour);
            const supplyCount = Object.keys(site.supply_zones).length;

            expect(proposed.length).toBe(4); // tower_a, tower_b, podium, site_office
            expect(neighbours.length).toBe(2); // nb_east, nb_north
            expect(supplyCount).toBe(3); // rebar_yard, formwork, pump
        });

        test("road and power-line zones are read from DXF (not constants)", () => {
            const site = parseDxfToSite(sampleDxfContent);

            // Road: DXF has lines at y = -20 and y = -2
            expect(site.road).toBeDefined();
            expect(site.road?.y_from_m).toBeCloseTo(-20.0, 4);
            expect(site.road?.y_to_m).toBeCloseTo(-2.0, 4);

            // Power line: DXF has a vertical LINE at x = -9
            expect(site.power_line).toBeDefined();
            expect(site.power_line?.x_m).toBeCloseTo(-9.0, 4);
        });
    });

    // =========================================================================
    // S2: Units Test (Metres to Millimetres boundary)
    // =========================================================================
    describe("S2: Units test", () => {
        /*
         * HAND CALCULATION:
         * Tower A south edge: x from 25.0 m to 65.0 m (read from DXF via parser).
         * Edge length in metres = 65.0 - 25.0 = 40.0 m.
         * In Chili3D CAD scene (millimetres): 40.0 * 1000 = 40,000.0 mm.
         * Read back: 40,000 / 1000 = 40.000 m.
         */
        test("a known 40 m edge appears as 40,000 mm in the scene and reads back as 40.000 m", () => {
            const site = parseDxfToSite(sampleDxfContent);
            const towerA = site.buildings.tower_a;
            expect(towerA).toBeDefined();

            const p1 = towerA.polygon[0]; // (25, 20) from DXF
            const p2 = towerA.polygon[1]; // (65, 20) from DXF
            const edgeLengthMetres = Math.hypot(p2.x - p1.x, p2.y - p1.y);
            expect(edgeLengthMetres).toBeCloseTo(40.0, 4);

            // Transform to CAD scene (mm)
            const edgeLengthSceneMm = metresToMm(edgeLengthMetres);
            expect(edgeLengthSceneMm).toBeCloseTo(40000.0, 4);

            // Read back to metres
            const readBackMetres = mmToMetres(edgeLengthSceneMm);
            expect(readBackMetres).toBeCloseTo(40.0, 4);
        });
    });

    // =========================================================================
    // S3: 3D Building Extrusion
    // =========================================================================
    describe("S3: Buildings extruded to 3D solids from footprint + height", () => {
        /*
         * HAND CALCULATION:
         * Tower A from DXF: x 25→65 (40 m), y 20→42 (22 m), height 75 m.
         * Width_mm  = 40 * 1000 = 40,000 mm
         * Depth_mm  = 22 * 1000 = 22,000 mm
         * Height_mm = 75 * 1000 = 75,000 mm
         * Volume_mm³ = 40,000 * 22,000 * 75,000 = 6.6 × 10¹³ mm³
         * Volume_m³  = 6.6 × 10¹³ / 10⁹ = 66,000 m³
         */
        test("Tower A gives a 3D solid with volume 40 x 22 x 75 = 66,000 m^3", () => {
            const factory = createTestFactory();
            const site = parseDxfToSite(sampleDxfContent);
            const towerA = site.buildings.tower_a;

            expect(towerA).toBeDefined();
            expect(towerA.height_m).toBeCloseTo(75.0, 1);

            const solidResult = extrudeBuildingSolid(factory, towerA.polygon, towerA.height_m);
            expect(solidResult.isOk).toBe(true);

            const solid = solidResult.value;
            expect(solid.shapeType).toBe(ShapeTypes.solid);

            const volumeM3 = getSolidVolumeM3(solid);
            const expectedVolumeM3 = 40 * 22 * 75; // 66,000 m³
            expect(volumeM3).toBeCloseTo(expectedVolumeM3, 1);
        });
    });

    // =========================================================================
    // S4: Project JSON Schema v1 Round-Trip & Validation
    // =========================================================================
    describe("S4: Project JSON schema v1 with save/load round trip", () => {
        test("Save then load returns identical data", () => {
            const site = parseDxfToSite(sampleDxfContent, {
                picks: sampleJsonData.picks,
            });

            const jsonStr = saveProjectJson(site);
            expect(typeof jsonStr).toBe("string");

            const loadResult = loadProjectJson(jsonStr);
            expect(loadResult.isOk).toBe(true);

            const loadedSite = loadResult.value;
            expect(loadedSite.schema_version).toBe("1.0");
            expect(loadedSite.units).toBe("m");
            expect(loadedSite.boundary.width_m).toBeCloseTo(site.boundary.width_m, 4);
            expect(loadedSite.boundary.depth_m).toBeCloseTo(site.boundary.depth_m, 4);
            expect(loadedSite.boundary.area_m2).toBeCloseTo(site.boundary.area_m2, 4);

            expect(Object.keys(loadedSite.buildings)).toEqual(Object.keys(site.buildings));
            expect(loadedSite.buildings.tower_a.height_m).toBeCloseTo(75.0, 1);

            expect(loadedSite.picks.length).toBe(site.picks.length);
        });

        test("Schema validation rejects invalid data and requires mandatory disclaimer", () => {
            const invalidData = {
                schema_version: "1.0",
                units: "m",
                boundary: {
                    polygon: [
                        { x: 0, y: 0 },
                        { x: 1, y: 0 },
                        { x: 1, y: 1 },
                    ],
                },
                buildings: {},
                disclaimer: "Something else without the exact legal text",
            };
            const result = validateSiteProject(invalidData);
            expect(result.isOk).toBe(false);
            expect(result.error).toContain(REQUIRED_DISCLAIMER);
        });
    });

    // =========================================================================
    // Mandatory Rules Checks
    // =========================================================================
    describe("Mandatory Rules Checks", () => {
        test("Mandatory disclaimer appears in parsed site", () => {
            const site = parseDxfToSite(sampleDxfContent);
            expect(site.disclaimer).toBe("Planning aid, not a certified lift plan.");
        });

        test("All data fields have source attribution or are labelled INDICATIVE", () => {
            const site = parseDxfToSite(sampleDxfContent);
            for (const bldg of Object.values(site.buildings)) {
                expect(bldg.source.length).toBeGreaterThan(0);
                expect(bldg.source).toContain("INDICATIVE");
            }
            for (const noGo of site.no_go_zones) {
                expect(noGo.source).toContain("INDICATIVE");
            }
            expect(site.power_line?.clearance_note).toContain("INDICATIVE");
        });

        test("Oversail rules correctly extracted from DXF NEIGHBOUR labels", () => {
            const site = parseDxfToSite(sampleDxfContent);
            expect(site.no_oversail).toContain("nb_north");
            expect(site.oversail_by_permission).toContain("nb_east");
        });
    });

    // =========================================================================
    // Unit helpers (pure functions — no DXF needed)
    // =========================================================================
    describe("Pure helper sanity checks", () => {
        test("sampleArc produces correct number of points and start/end are on the circle", () => {
            /*
             * HAND CHECK: arc centred at (80,62), R=10, 0°→90° (CCW).
             * Start point: (80+10*cos(0°), 62+10*sin(0°)) = (90, 62).
             * End point:   (80+10*cos(90°), 62+10*sin(90°)) = (80, 72).
             * sampleArc with segments=4 → 5 points (0°, 22.5°, 45°, 67.5°, 90°).
             */
            const arc = {
                center: { x: 80, y: 62 },
                radius: 10,
                startAngleRad: 0,
                endAngleRad: Math.PI / 2,
            };
            const pts = sampleArc(arc, 4);
            expect(pts.length).toBe(5);
            expect(pts[0].x).toBeCloseTo(90, 4);
            expect(pts[0].y).toBeCloseTo(62, 4);
            expect(pts[4].x).toBeCloseTo(80, 4);
            expect(pts[4].y).toBeCloseTo(72, 4);
        });

        test("calculatePolygonArea gives exact result for a simple rectangle", () => {
            /*
             * HAND CHECK: rectangle (0,0)→(10,0)→(10,5)→(0,5).
             * Shoelace:
             *   sum = 0*0 - 10*0 + 10*5 - 10*0 + 10*5 - 0*5 + 0*0 - 0*5 = 100
             *   Area = |100| / 2 = 50 m².
             */
            const rect = [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 5 },
                { x: 0, y: 5 },
            ];
            expect(calculatePolygonArea(rect)).toBeCloseTo(50, 6);
        });
    });
});
