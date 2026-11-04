// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "@rstest/core";
import {
    calibrateImageScale,
    createImageUnderlay,
    measureUnderlayDistanceM,
    pixelToWorldMetres,
    worldMetresToPixel,
} from "../src/imageUnderlay";
import {
    createSiteFeature,
    insertPolygonVertex,
    removePolygonVertex,
    SitePolygonEditor,
} from "../src/polygonEditor";
import { REQUIRED_DISCLAIMER } from "../src/types";

describe("DGOC Site Model — Check-in 2 (S5 & S6)", () => {
    describe("S5: PNG/PDF underlay with 2-point scale calibration", () => {
        /**
         * Hand-worked calculation reference (Task S5):
         * - Scale bar endpoints clicked on an image:
         *   Point A = (100.0, 250.0) px
         *   Point B = (900.0, 250.0) px
         * - Horizontal distance in pixels = |900.0 - 100.0| = 800.0 px
         * - Known distance = 40.0 m
         * - Scale = 40.0 m / 800.0 px = 0.05 m/px (20.0 px/m)
         * - Any two points 800 px apart measure: 800 px * 0.05 m/px = 40.0 m
         */
        test("calibrates scale from two points and verifies 40 m reads within 1 percent", () => {
            const pointA = { u: 100, v: 250 };
            const pointB = { u: 900, v: 250 };
            const knownDistanceM = 40.0;

            const calibRes = calibrateImageScale(pointA, pointB, knownDistanceM);
            expect(calibRes.isOk).toBe(true);
            if (!calibRes.isOk) return;

            const calib = calibRes.value;
            expect(calib.pixelDistance).toBe(800);
            expect(calib.metresPerPixel).toBe(0.05);
            expect(calib.pixelsPerMetre).toBe(20);

            // Measure a test segment of 800 px:
            const testP1 = { u: 50, v: 100 };
            const testP2 = { u: 850, v: 100 }; // exactly 800 px apart
            const measuredM = measureUnderlayDistanceM(testP1, testP2, calib);

            expect(measuredM).toBe(40.0);
            const errorPercent = (Math.abs(measuredM - 40.0) / 40.0) * 100;
            expect(errorPercent).toBeLessThanOrEqual(1.0);
        });

        test("diagonal calibration accurately converts scale", () => {
            // 3-4-5 right triangle in pixels: dx = 300, dy = 400 -> hypotenuse = 500 px
            const p1 = { u: 50, v: 50 };
            const p2 = { u: 350, v: 450 };
            const knownDistanceM = 50.0; // 50m over 500 px -> 0.1 m/px

            const calibRes = calibrateImageScale(p1, p2, knownDistanceM);
            expect(calibRes.isOk).toBe(true);
            if (!calibRes.isOk) return;

            const calib = calibRes.value;
            expect(calib.pixelDistance).toBe(500);
            expect(calib.metresPerPixel).toBeCloseTo(0.1, 6);

            // Measure a 400 px segment (should be 40.0 m):
            const m1 = { u: 0, v: 0 };
            const m2 = { u: 400, v: 0 };
            const measuredM = measureUnderlayDistanceM(m1, m2, calib);
            expect(measuredM).toBeCloseTo(40.0, 4);
            expect(Math.abs(measuredM - 40.0)).toBeLessThan(0.4); // well within 1%
        });

        test("sample-site.png exists and is accessible", () => {
            const pngPath = path.resolve(
                import.meta.dirname,
                "..",
                "..",
                "..",
                "public",
                "sample-site",
                "sample-site.png",
            );
            expect(existsSync(pngPath)).toBe(true);

            const buffer = readFileSync(pngPath);
            expect(buffer.length).toBeGreaterThan(1000);
            // Verify PNG magic header bytes: 0x89 'P' 'N' 'G'
            expect(buffer[0]).toBe(0x89);
            expect(buffer[1]).toBe(0x50);
            expect(buffer[2]).toBe(0x4e);
            expect(buffer[3]).toBe(0x47);
        });

        test("pixelToWorldMetres and worldMetresToPixel round-trip accurately", () => {
            const calibRes = calibrateImageScale({ u: 0, v: 0 }, { u: 1000, v: 0 }, 100.0);
            expect(calibRes.isOk).toBe(true);
            if (!calibRes.isOk) return;

            const underlay = createImageUnderlay({
                id: "test-underlay",
                name: "Site Plan PNG",
                imageUri: "public/sample-site/sample-site.png",
                widthPx: 1200,
                heightPx: 800,
                calibration: calibRes.value,
                originPixel: { u: 100, v: 700 }, // SW corner at u=100, v=700
            });

            // Origin pixel should map to world (0, 0)
            const originWorld = pixelToWorldMetres({ u: 100, v: 700 }, underlay);
            expect(originWorld.isOk).toBe(true);
            if (!originWorld.isOk) return;
            expect(originWorld.value.x).toBeCloseTo(0, 5);
            expect(originWorld.value.y).toBeCloseTo(0, 5);

            // A point 400 px right and 200 px up (v=500):
            // x = +40 m, y = +20 m
            const ptPixel = { u: 500, v: 500 };
            const ptWorld = pixelToWorldMetres(ptPixel, underlay);
            expect(ptWorld.isOk).toBe(true);
            if (!ptWorld.isOk) return;
            expect(ptWorld.value.x).toBeCloseTo(40.0, 5);
            expect(ptWorld.value.y).toBeCloseTo(20.0, 5);

            // Round-trip back to pixel:
            const backToPixel = worldMetresToPixel(ptWorld.value, underlay);
            expect(backToPixel.isOk).toBe(true);
            if (!backToPixel.isOk) return;
            expect(backToPixel.value.u).toBeCloseTo(500, 4);
            expect(backToPixel.value.v).toBeCloseTo(500, 4);
        });

        test("rejects invalid calibration inputs", () => {
            // Same points (zero distance):
            const zeroDistRes = calibrateImageScale({ u: 50, v: 50 }, { u: 50, v: 50 }, 40);
            expect(zeroDistRes.isOk).toBe(false);

            // Non-positive distance:
            const negDistRes = calibrateImageScale({ u: 0, v: 0 }, { u: 100, v: 0 }, -5);
            expect(negDistRes.isOk).toBe(false);

            // Non-finite coords:
            const nanRes = calibrateImageScale({ u: Number.NaN, v: 0 }, { u: 100, v: 0 }, 40);
            expect(nanRes.isOk).toBe(false);
        });

        test("includes mandatory disclaimer in calibration and underlay objects", () => {
            const calibRes = calibrateImageScale({ u: 0, v: 0 }, { u: 500, v: 0 }, 25);
            expect(calibRes.isOk).toBe(true);
            if (!calibRes.isOk) return;

            expect(calibRes.value.disclaimer).toBe(REQUIRED_DISCLAIMER);

            const underlay = createImageUnderlay({
                id: "u1",
                name: "Underlay",
                imageUri: "test.png",
                widthPx: 1000,
                heightPx: 1000,
                calibration: calibRes.value,
            });
            expect(underlay.disclaimer).toBe(REQUIRED_DISCLAIMER);
        });
    });

    describe("S6: Polygon draw/edit for building, road, power line, no-go", () => {
        /**
         * Hand-worked calculation reference (Task S6):
         * - 10 m x 10 m rectangle:
         *   P0 = (0, 0), P1 = (10, 0), P2 = (10, 10), P3 = (0, 10)
         * - Area = 10 * 10 = 100.0 m^2
         */
        test("draw a 10 x 10 m rectangle and verify area is exactly 100 m^2", () => {
            const rectPoints = [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 10 },
                { x: 0, y: 10 },
            ];

            const featureRes = createSiteFeature({
                id: "bldg_rect_1",
                kind: "building",
                label: "Substation Box",
                polygon: rectPoints,
                height_m: 5.0,
            });

            expect(featureRes.isOk).toBe(true);
            if (!featureRes.isOk) return;

            const feature = featureRes.value;
            expect(feature.area_m2).toBe(100.0);
            expect(feature.disclaimer).toBe(REQUIRED_DISCLAIMER);
            expect(feature.kind).toBe("building");
            expect(feature.height_m).toBe(5.0);
        });

        /**
         * Hand-worked calculation reference (Task S6 vertex edit & undo):
         * - Original rectangle: (0,0), (10,0), (10,10), (0,10) -> Area = 100.0 m^2
         * - Edit vertex P2 from (10, 10) to (12, 10):
         *   Trapezoid bases = 10 m and 12 m, height = 10 m
         *   Area = ((10 + 12) / 2) * 10 = 110.0 m^2
         * - Undo restores P2 to (10, 10) -> Area returns to 100.0 m^2
         */
        test("edit a vertex updates area to 110 m^2 and undo restores original area", () => {
            const editor = new SitePolygonEditor();

            const initialPoints = [
                { x: 0, y: 0 },
                { x: 10, y: 0 },
                { x: 10, y: 10 },
                { x: 0, y: 10 },
            ];

            const featureRes = createSiteFeature({
                id: "bldg_1",
                kind: "building",
                label: "Proposed Block",
                polygon: initialPoints,
            });
            expect(featureRes.isOk).toBe(true);
            if (!featureRes.isOk) return;

            editor.addFeature(featureRes.value);
            expect(editor.getFeature("bldg_1")?.area_m2).toBe(100.0);

            // Edit vertex index 2 from (10, 10) to (12, 10):
            const moveRes = editor.moveVertex("bldg_1", 2, { x: 12, y: 10 });
            expect(moveRes.isOk).toBe(true);

            // Area should now be 110.0 m^2
            const updated = editor.getFeature("bldg_1");
            expect(updated?.polygon[2]).toEqual({ x: 12, y: 10 });
            expect(updated?.area_m2).toBe(110.0);
            expect(editor.canUndo()).toBe(true);

            // Perform Undo:
            const undoSuccess = editor.undo();
            expect(undoSuccess).toBe(true);

            // Vertex should be restored to (10, 10) and area to 100.0 m^2
            const restored = editor.getFeature("bldg_1");
            expect(restored?.polygon[2]).toEqual({ x: 10, y: 10 });
            expect(restored?.area_m2).toBe(100.0);
            expect(editor.canRedo()).toBe(true);

            // Perform Redo:
            const redoSuccess = editor.redo();
            expect(redoSuccess).toBe(true);
            const redone = editor.getFeature("bldg_1");
            expect(redone?.polygon[2]).toEqual({ x: 12, y: 10 });
            expect(redone?.area_m2).toBe(110.0);
        });

        test("supports creating road, power line (with clearance), and no-go zone features", () => {
            // Road feature
            const roadRes = createSiteFeature({
                id: "road_south",
                kind: "road",
                label: "Main Access Road",
                polygon: [
                    { x: -10, y: -18 },
                    { x: 100, y: -18 },
                    { x: 100, y: 0 },
                    { x: -10, y: 0 },
                ],
            });
            expect(roadRes.isOk).toBe(true);
            if (roadRes.isOk) {
                expect(roadRes.value.kind).toBe("road");
                expect(roadRes.value.area_m2).toBe(110 * 18); // 1980 m^2
            }

            // Power line feature with 6.0 m clearance
            const powerRes = createSiteFeature({
                id: "power_22kv",
                kind: "power_line",
                label: "22kV Transmission Corridor",
                polygon: [
                    { x: -12, y: -20 },
                    { x: -6, y: -20 },
                    { x: -6, y: 80 },
                    { x: -12, y: 80 },
                ],
                clearance_m: 6.0,
            });
            expect(powerRes.isOk).toBe(true);
            if (powerRes.isOk) {
                expect(powerRes.value.kind).toBe("power_line");
                expect(powerRes.value.clearance_m).toBe(6.0);
            }

            // No-go zone feature
            const noGoRes = createSiteFeature({
                id: "nogo_well",
                kind: "no_go",
                label: "Heritage Well Zone",
                polygon: [
                    { x: 20, y: 20 },
                    { x: 26, y: 20 },
                    { x: 26, y: 26 },
                    { x: 20, y: 26 },
                ],
            });
            expect(noGoRes.isOk).toBe(true);
            if (noGoRes.isOk) {
                expect(noGoRes.value.kind).toBe("no_go");
                expect(noGoRes.value.area_m2).toBe(36.0); // 6 x 6 m
            }
        });

        test("insert and remove polygon vertices updates area and geometry correctly", () => {
            const baseFeature = createSiteFeature({
                id: "poly_test",
                kind: "building",
                label: "Test Shape",
                polygon: [
                    { x: 0, y: 0 },
                    { x: 10, y: 0 },
                    { x: 10, y: 10 },
                    { x: 0, y: 10 },
                ],
            }).value;

            // Insert vertex at (5, 15) between index 2 and index 3 (pentagon with roof peak):
            const insertedRes = insertPolygonVertex(baseFeature, 2, { x: 5, y: 15 });
            expect(insertedRes.isOk).toBe(true);
            if (insertedRes.isOk) {
                // Rectangle 10x10 (100) + Triangle roof (base 10, height 5 -> 0.5*10*5 = 25) = 125 m^2
                expect(insertedRes.value.polygon.length).toBe(5);
                expect(insertedRes.value.area_m2).toBe(125.0);

                // Remove vertex at index 3 (the inserted peak):
                const removedRes = removePolygonVertex(insertedRes.value, 3);
                expect(removedRes.isOk).toBe(true);
                if (removedRes.isOk) {
                    expect(removedRes.value.polygon.length).toBe(4);
                    expect(removedRes.value.area_m2).toBe(100.0);
                }
            }

            // Cannot remove vertex if only 3 remain:
            const triangle = createSiteFeature({
                id: "tri",
                kind: "building",
                label: "Triangle",
                polygon: [
                    { x: 0, y: 0 },
                    { x: 10, y: 0 },
                    { x: 0, y: 10 },
                ],
            }).value;
            const failRemove = removePolygonVertex(triangle, 0);
            expect(failRemove.isOk).toBe(false);
        });

        test("feature addition and removal can be undone and redone in editor", () => {
            const editor = new SitePolygonEditor();
            const feature = createSiteFeature({
                id: "feat_1",
                kind: "no_go",
                label: "No-go Area",
                polygon: [
                    { x: 0, y: 0 },
                    { x: 5, y: 0 },
                    { x: 0, y: 5 },
                ],
            }).value;

            editor.addFeature(feature);
            expect(editor.features.length).toBe(1);

            editor.undo();
            expect(editor.features.length).toBe(0);

            editor.redo();
            expect(editor.features.length).toBe(1);

            editor.removeFeature("feat_1");
            expect(editor.features.length).toBe(0);

            editor.undo();
            expect(editor.features.length).toBe(1);
        });
    });
});
