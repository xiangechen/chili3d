// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ShapeTypes, XYZ } from "@chili3d/core";
import type { OccShapeConverter } from "../src/converter";
import type { ShapeFactory } from "../src/factory";
import type { OccSolid } from "../src/shape";
import { createBox, createTestConverter, createTestFactory, unwrapOk } from "./helpers";
import "./setup";

let factory: ShapeFactory;
let converter: OccShapeConverter;

beforeEach(() => {
    factory = createTestFactory();
    converter = createTestConverter();
});

// ============================================================================
// BREP conversion — string round-trip
// ============================================================================

describe("BREP conversion", () => {
    test("box → BREP → box round-trip preserves shape type", () => {
        const box = createBox(factory, 10, 20, 30);

        const brepResult = converter.convertToBrep(box);
        expect(brepResult.isOk).toBe(true);
        const brep = brepResult.value;
        expect(typeof brep).toBe("string");
        expect(brep.length).toBeGreaterThan(0);

        const restoredResult = converter.convertFromBrep(brep);
        expect(restoredResult.isOk).toBe(true);
        const restored = restoredResult.value;
        expect(restored.shapeType).toBe(ShapeTypes.solid);
    });

    test("box → BREP → box round-trip preserves volume", () => {
        const box = createBox(factory, 10, 20, 30);
        const originalVolume = (box as OccSolid).volume();

        const brep = converter.convertToBrep(box).value;
        const restored = converter.convertFromBrep(brep).value as OccSolid;
        expect(restored.volume()).toBeCloseTo(originalVolume);
    });

    test("box → BREP → box round-trip preserves edge count", () => {
        const box = createBox(factory, 10, 10, 10);
        const originalEdges = box.findSubShapes(ShapeTypes.edge).length;

        const brep = converter.convertToBrep(box).value;
        const restored = converter.convertFromBrep(brep).value;
        const restoredEdges = restored.findSubShapes(ShapeTypes.edge).length;
        expect(restoredEdges).toBe(originalEdges);
    });

    test("sphere → BREP → sphere round-trip", () => {
        const sphere = unwrapOk(factory.sphere(XYZ.zero, 10));
        const brep = unwrapOk(converter.convertToBrep(sphere));
        const restored = unwrapOk(converter.convertFromBrep(brep));
        expect(restored.shapeType).toBe(ShapeTypes.solid);
        expect(restored.isNull()).toBe(false);
    });

    test("cylinder → BREP → cylinder round-trip", () => {
        const cyl = unwrapOk(factory.cylinder(XYZ.unitZ, XYZ.zero, 5, 20));
        const brep = unwrapOk(converter.convertToBrep(cyl));
        const restored = unwrapOk(converter.convertFromBrep(brep));
        expect(restored.shapeType).toBe(ShapeTypes.solid);
    });

    test("multiple shapes → single BREP → restores first", () => {
        const box = createBox(factory, 10, 10, 10);
        const brep = converter.convertToBrep(box).value;
        const restored = converter.convertFromBrep(brep);
        expect(restored.isOk).toBe(true);
    });

    test("convertFromBrep with invalid string returns error", () => {
        const result = converter.convertFromBrep("not a valid brep");
        expect(result.isOk).toBe(false);
        expect(result.error).toBe("can not convert");
    });

    test("convertToBrep with non-OccShape returns error", () => {
        const fake = { shapeType: "solid" } as any;
        const result = converter.convertToBrep(fake);
        expect(result.isOk).toBe(false);
        expect(result.error).toBe("Shape is not an OccShape");
    });
});

// ============================================================================
// STEP conversion
// ============================================================================

describe("STEP conversion", () => {
    test("box → STEP produces valid STEP content", () => {
        const box = createBox(factory, 10, 10, 10);
        const result = converter.convertToSTEP(box);
        expect(result.isOk).toBe(true);
        const step = result.value;
        expect(typeof step).toBe("string");
        expect(step.length).toBeGreaterThan(0);
        // STEP files start with ISO-10303
        expect(step).toContain("ISO-10303-21");
        expect(step).toContain("END-ISO-10303-21");
    });

    test("multiple shapes to STEP", () => {
        const box = createBox(factory, 10, 10, 10);
        const sphere = unwrapOk(factory.sphere(XYZ.zero, 5));
        const result = converter.convertToSTEP(box, sphere);
        expect(result.isOk).toBe(true);
        expect(result.value.length).toBeGreaterThan(0);
    });

    test("convertToSTEP with non-OccShape throws", () => {
        const fake = { shapeType: "solid" } as any;
        expect(() => converter.convertToSTEP(fake)).toThrow("Shape is not an OccShape");
    });
});

// ============================================================================
// IGES conversion
// ============================================================================

describe("IGES conversion", () => {
    test("box → IGES produces valid IGES content", () => {
        const box = createBox(factory, 10, 10, 10);
        const result = converter.convertToIGES(box);
        expect(result.isOk).toBe(true);
        const iges = result.value;
        expect(typeof iges).toBe("string");
        expect(iges.length).toBeGreaterThan(0);
        // IGES files have sections marked with S/G/D/P/T
        expect(iges).toContain("S      1");
    });

    test("multiple shapes to IGES", () => {
        const box = createBox(factory, 10, 10, 10);
        const sphere = unwrapOk(factory.sphere(XYZ.zero, 5));
        const result = converter.convertToIGES(box, sphere);
        expect(result.isOk).toBe(true);
        expect(result.value.length).toBeGreaterThan(0);
    });

    test("convertToIGES with non-OccShape throws", () => {
        const fake = { shapeType: "solid" } as any;
        expect(() => converter.convertToIGES(fake)).toThrow("Shape is not an OccShape");
    });
});

// ============================================================================
// STL conversion (extended from stl.test.ts)
// ============================================================================

describe("STL conversion", () => {
    test("binary STL of a box has correct byte structure", () => {
        const box = createBox(factory, 10, 20, 30);
        const result = converter.convertToSTL([box], { binary: true });
        expect(result.isOk).toBe(true);
        const bytes = result.value;
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        const tris = view.getUint32(80, true);
        expect(tris).toBeGreaterThanOrEqual(12);
        expect(bytes.length).toBeGreaterThanOrEqual(84 + 50 * tris);
    });

    test("ASCII STL is well-formed", () => {
        const box = createBox(factory, 10, 20, 30);
        const result = converter.convertToSTL([box], { binary: false });
        expect(result.isOk).toBe(true);
        const text = new TextDecoder().decode(result.value);
        expect(text.startsWith("solid")).toBe(true);
        expect(text).toContain("facet normal");
        expect(text.trimEnd().endsWith("endsolid chili3d")).toBe(true);
    });

    test("STL with empty shapes array", () => {
        const result = converter.convertToSTL([], { binary: true });
        expect(result.isOk).toBe(true);
        expect(result.value.length).toBe(84); // header + zero triangle count
        const view = new DataView(result.value.buffer, result.value.byteOffset, result.value.byteLength);
        expect(view.getUint32(80, true)).toBe(0);
    });
});
