// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ShapeType, ShapeTypeUtils } from "../src";

describe("test ShapeType", () => {
    test("test ShapeType enum values", () => {
        expect(ShapeType.Shape).toBe(0b0);
        expect(ShapeType.Compound).toBe(0b1);
        expect(ShapeType.CompoundSolid).toBe(0b10);
        expect(ShapeType.Solid).toBe(0b100);
        expect(ShapeType.Shell).toBe(0b1000);
        expect(ShapeType.Face).toBe(0b10000);
        expect(ShapeType.Wire).toBe(0b100000);
        expect(ShapeType.Edge).toBe(0b1000000);
        expect(ShapeType.Vertex).toBe(0b10000000);
    });

    test("test isWhole method", () => {
        expect(ShapeTypeUtils.isWhole(ShapeType.Shape)).toBeTruthy();
        expect(ShapeTypeUtils.isWhole(ShapeType.Compound)).toBeTruthy();
        expect(ShapeTypeUtils.isWhole(ShapeType.CompoundSolid)).toBeTruthy();
        expect(ShapeTypeUtils.isWhole(ShapeType.Solid)).toBeTruthy();
        expect(ShapeTypeUtils.isWhole(ShapeType.Shell)).toBeFalsy();
        expect(ShapeTypeUtils.isWhole(ShapeType.Face)).toBeFalsy();
        expect(ShapeTypeUtils.isWhole(ShapeType.Wire)).toBeFalsy();
        expect(ShapeTypeUtils.isWhole(ShapeType.Edge)).toBeFalsy();
        expect(ShapeTypeUtils.isWhole(ShapeType.Vertex)).toBeTruthy();
    });

    test("test stringValue method", () => {
        expect(ShapeTypeUtils.stringValue(ShapeType.Shape)).toBe("Shape");
        expect(ShapeTypeUtils.stringValue(ShapeType.Compound)).toBe("Compound");
        expect(ShapeTypeUtils.stringValue(ShapeType.CompoundSolid)).toBe("CompoundSolid");
        expect(ShapeTypeUtils.stringValue(ShapeType.Solid)).toBe("Solid");
        expect(ShapeTypeUtils.stringValue(ShapeType.Shell)).toBe("Shell");
        expect(ShapeTypeUtils.stringValue(ShapeType.Face)).toBe("Face");
        expect(ShapeTypeUtils.stringValue(ShapeType.Wire)).toBe("Wire");
        expect(ShapeTypeUtils.stringValue(ShapeType.Edge)).toBe("Edge");
        expect(ShapeTypeUtils.stringValue(ShapeType.Vertex)).toBe("Vertex");
        expect(ShapeTypeUtils.stringValue(999 as ShapeType)).toBe("Unknown");
    });

    test("test hasCompound method", () => {
        expect(ShapeTypeUtils.hasCompound(ShapeType.Compound)).toBeTruthy();
        expect(ShapeTypeUtils.hasCompound(ShapeType.CompoundSolid)).toBeFalsy();
        expect(ShapeTypeUtils.hasCompound(ShapeType.Shape)).toBeFalsy();
        expect(ShapeTypeUtils.hasCompound(ShapeType.Solid)).toBeFalsy();
        expect(ShapeTypeUtils.hasCompound(ShapeType.Shell)).toBeFalsy();
    });

    test("test hasCompoundSolid method", () => {
        expect(ShapeTypeUtils.hasCompoundSolid(ShapeType.CompoundSolid)).toBeTruthy();
        expect(ShapeTypeUtils.hasCompoundSolid(ShapeType.Compound)).toBeFalsy();
        expect(ShapeTypeUtils.hasCompoundSolid(ShapeType.Shape)).toBeFalsy();
        expect(ShapeTypeUtils.hasCompoundSolid(ShapeType.Solid)).toBeFalsy();
    });

    test("test hasSolid method", () => {
        expect(ShapeTypeUtils.hasSolid(ShapeType.Solid)).toBeTruthy();
        expect(ShapeTypeUtils.hasSolid(ShapeType.CompoundSolid)).toBeFalsy();
        expect(ShapeTypeUtils.hasSolid(ShapeType.Shape)).toBeFalsy();
        expect(ShapeTypeUtils.hasSolid(ShapeType.Compound)).toBeFalsy();
        expect(ShapeTypeUtils.hasSolid(ShapeType.Shell)).toBeFalsy();
    });

    test("test hasShell method", () => {
        expect(ShapeTypeUtils.hasShell(ShapeType.Shell)).toBeTruthy();
        expect(ShapeTypeUtils.hasShell(ShapeType.Shape)).toBeFalsy();
        expect(ShapeTypeUtils.hasShell(ShapeType.Compound)).toBeFalsy();
        expect(ShapeTypeUtils.hasShell(ShapeType.Solid)).toBeFalsy();
    });

    test("test hasFace method", () => {
        expect(ShapeTypeUtils.hasFace(ShapeType.Face)).toBeTruthy();
        expect(ShapeTypeUtils.hasFace(ShapeType.Shape)).toBeFalsy();
        expect(ShapeTypeUtils.hasFace(ShapeType.Shell)).toBeFalsy();
        expect(ShapeTypeUtils.hasFace(ShapeType.Solid)).toBeFalsy();
    });

    test("test hasWire method", () => {
        expect(ShapeTypeUtils.hasWire(ShapeType.Wire)).toBeTruthy();
        expect(ShapeTypeUtils.hasWire(ShapeType.Shape)).toBeFalsy();
        expect(ShapeTypeUtils.hasWire(ShapeType.Face)).toBeFalsy();
        expect(ShapeTypeUtils.hasWire(ShapeType.Shell)).toBeFalsy();
    });

    test("test hasEdge method", () => {
        expect(ShapeTypeUtils.hasEdge(ShapeType.Edge)).toBeTruthy();
        expect(ShapeTypeUtils.hasEdge(ShapeType.Shape)).toBeFalsy();
        expect(ShapeTypeUtils.hasEdge(ShapeType.Wire)).toBeFalsy();
        expect(ShapeTypeUtils.hasEdge(ShapeType.Face)).toBeFalsy();
    });

    test("test hasVertex method", () => {
        expect(ShapeTypeUtils.hasVertex(ShapeType.Vertex)).toBeTruthy();
        expect(ShapeTypeUtils.hasVertex(ShapeType.Shape)).toBeFalsy();
        expect(ShapeTypeUtils.hasVertex(ShapeType.Edge)).toBeFalsy();
        expect(ShapeTypeUtils.hasVertex(ShapeType.Wire)).toBeFalsy();
    });

    test("test bitwise operations with combined types", () => {
        const combinedType = ShapeType.Compound | ShapeType.Solid;
        expect(ShapeTypeUtils.hasCompound(combinedType)).toBeTruthy();
        expect(ShapeTypeUtils.hasSolid(combinedType)).toBeTruthy();
        expect(ShapeTypeUtils.hasShell(combinedType)).toBeFalsy();
        expect(ShapeTypeUtils.hasFace(combinedType)).toBeFalsy();
        expect(ShapeTypeUtils.isWhole(combinedType)).toBeFalsy();
    });

    test("test CompoundSolid type properties", () => {
        expect(ShapeTypeUtils.hasCompound(ShapeType.CompoundSolid)).toBeFalsy();
        expect(ShapeTypeUtils.hasSolid(ShapeType.CompoundSolid)).toBeFalsy();
        expect(ShapeTypeUtils.hasCompoundSolid(ShapeType.CompoundSolid)).toBeTruthy();
        expect(ShapeTypeUtils.isWhole(ShapeType.CompoundSolid)).toBeTruthy();
    });
});
