// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type ShapeType, ShapeTypes, ShapeTypeUtils } from "../src";

describe("test ShapeType", () => {
    test("test ShapeType values", () => {
        expect(ShapeTypes.shape).toBe(0b0);
        expect(ShapeTypes.compound).toBe(0b1);
        expect(ShapeTypes.compoundSolid).toBe(0b10);
        expect(ShapeTypes.solid).toBe(0b100);
        expect(ShapeTypes.shell).toBe(0b1000);
        expect(ShapeTypes.face).toBe(0b10000);
        expect(ShapeTypes.wire).toBe(0b100000);
        expect(ShapeTypes.edge).toBe(0b1000000);
        expect(ShapeTypes.vertex).toBe(0b10000000);
    });

    test("test isWhole method", () => {
        expect(ShapeTypeUtils.isWhole(ShapeTypes.shape)).toBeTruthy();
        expect(ShapeTypeUtils.isWhole(ShapeTypes.compound)).toBeTruthy();
        expect(ShapeTypeUtils.isWhole(ShapeTypes.compoundSolid)).toBeTruthy();
        expect(ShapeTypeUtils.isWhole(ShapeTypes.solid)).toBeTruthy();
        expect(ShapeTypeUtils.isWhole(ShapeTypes.shell)).toBeFalsy();
        expect(ShapeTypeUtils.isWhole(ShapeTypes.face)).toBeFalsy();
        expect(ShapeTypeUtils.isWhole(ShapeTypes.wire)).toBeFalsy();
        expect(ShapeTypeUtils.isWhole(ShapeTypes.edge)).toBeFalsy();
        expect(ShapeTypeUtils.isWhole(ShapeTypes.vertex)).toBeTruthy();
    });

    test("test stringValue method", () => {
        expect(ShapeTypeUtils.stringValue(ShapeTypes.shape)).toBe("Shape");
        expect(ShapeTypeUtils.stringValue(ShapeTypes.compound)).toBe("Compound");
        expect(ShapeTypeUtils.stringValue(ShapeTypes.compoundSolid)).toBe("CompoundSolid");
        expect(ShapeTypeUtils.stringValue(ShapeTypes.solid)).toBe("Solid");
        expect(ShapeTypeUtils.stringValue(ShapeTypes.shell)).toBe("Shell");
        expect(ShapeTypeUtils.stringValue(ShapeTypes.face)).toBe("Face");
        expect(ShapeTypeUtils.stringValue(ShapeTypes.wire)).toBe("Wire");
        expect(ShapeTypeUtils.stringValue(ShapeTypes.edge)).toBe("Edge");
        expect(ShapeTypeUtils.stringValue(ShapeTypes.vertex)).toBe("Vertex");
        expect(ShapeTypeUtils.stringValue(999 as ShapeType)).toBe("Unknown");
    });

    test("test hasCompound method", () => {
        expect(ShapeTypeUtils.hasCompound(ShapeTypes.compound)).toBeTruthy();
        expect(ShapeTypeUtils.hasCompound(ShapeTypes.compoundSolid)).toBeFalsy();
        expect(ShapeTypeUtils.hasCompound(ShapeTypes.shape)).toBeFalsy();
        expect(ShapeTypeUtils.hasCompound(ShapeTypes.solid)).toBeFalsy();
        expect(ShapeTypeUtils.hasCompound(ShapeTypes.shell)).toBeFalsy();
    });

    test("test hasCompoundSolid method", () => {
        expect(ShapeTypeUtils.hasCompoundSolid(ShapeTypes.compoundSolid)).toBeTruthy();
        expect(ShapeTypeUtils.hasCompoundSolid(ShapeTypes.compound)).toBeFalsy();
        expect(ShapeTypeUtils.hasCompoundSolid(ShapeTypes.shape)).toBeFalsy();
        expect(ShapeTypeUtils.hasCompoundSolid(ShapeTypes.solid)).toBeFalsy();
    });

    test("test hasSolid method", () => {
        expect(ShapeTypeUtils.hasSolid(ShapeTypes.solid)).toBeTruthy();
        expect(ShapeTypeUtils.hasSolid(ShapeTypes.compoundSolid)).toBeFalsy();
        expect(ShapeTypeUtils.hasSolid(ShapeTypes.shape)).toBeFalsy();
        expect(ShapeTypeUtils.hasSolid(ShapeTypes.compound)).toBeFalsy();
        expect(ShapeTypeUtils.hasSolid(ShapeTypes.shell)).toBeFalsy();
    });

    test("test hasShell method", () => {
        expect(ShapeTypeUtils.hasShell(ShapeTypes.shell)).toBeTruthy();
        expect(ShapeTypeUtils.hasShell(ShapeTypes.shape)).toBeFalsy();
        expect(ShapeTypeUtils.hasShell(ShapeTypes.compound)).toBeFalsy();
        expect(ShapeTypeUtils.hasShell(ShapeTypes.solid)).toBeFalsy();
    });

    test("test hasFace method", () => {
        expect(ShapeTypeUtils.hasFace(ShapeTypes.face)).toBeTruthy();
        expect(ShapeTypeUtils.hasFace(ShapeTypes.shape)).toBeFalsy();
        expect(ShapeTypeUtils.hasFace(ShapeTypes.shell)).toBeFalsy();
        expect(ShapeTypeUtils.hasFace(ShapeTypes.solid)).toBeFalsy();
    });

    test("test hasWire method", () => {
        expect(ShapeTypeUtils.hasWire(ShapeTypes.wire)).toBeTruthy();
        expect(ShapeTypeUtils.hasWire(ShapeTypes.shape)).toBeFalsy();
        expect(ShapeTypeUtils.hasWire(ShapeTypes.face)).toBeFalsy();
        expect(ShapeTypeUtils.hasWire(ShapeTypes.shell)).toBeFalsy();
    });

    test("test hasEdge method", () => {
        expect(ShapeTypeUtils.hasEdge(ShapeTypes.edge)).toBeTruthy();
        expect(ShapeTypeUtils.hasEdge(ShapeTypes.shape)).toBeFalsy();
        expect(ShapeTypeUtils.hasEdge(ShapeTypes.wire)).toBeFalsy();
        expect(ShapeTypeUtils.hasEdge(ShapeTypes.face)).toBeFalsy();
    });

    test("test hasVertex method", () => {
        expect(ShapeTypeUtils.hasVertex(ShapeTypes.vertex)).toBeTruthy();
        expect(ShapeTypeUtils.hasVertex(ShapeTypes.shape)).toBeFalsy();
        expect(ShapeTypeUtils.hasVertex(ShapeTypes.edge)).toBeFalsy();
        expect(ShapeTypeUtils.hasVertex(ShapeTypes.wire)).toBeFalsy();
    });

    test("test bitwise operations with combined types", () => {
        const combinedType = (ShapeTypes.compound | ShapeTypes.solid) as ShapeType;
        expect(ShapeTypeUtils.hasCompound(combinedType)).toBeTruthy();
        expect(ShapeTypeUtils.hasSolid(combinedType)).toBeTruthy();
        expect(ShapeTypeUtils.hasShell(combinedType)).toBeFalsy();
        expect(ShapeTypeUtils.hasFace(combinedType)).toBeFalsy();
        expect(ShapeTypeUtils.isWhole(combinedType)).toBeFalsy();
    });

    test("test CompoundSolid type properties", () => {
        expect(ShapeTypeUtils.hasCompound(ShapeTypes.compoundSolid)).toBeFalsy();
        expect(ShapeTypeUtils.hasSolid(ShapeTypes.compoundSolid)).toBeFalsy();
        expect(ShapeTypeUtils.hasCompoundSolid(ShapeTypes.compoundSolid)).toBeTruthy();
        expect(ShapeTypeUtils.isWhole(ShapeTypes.compoundSolid)).toBeTruthy();
    });
});
