// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IShape, Plane, XYZ } from "@chili3d/core";
import { ShapeFactory } from "../src/factory";
import "./setup";

let factory: ShapeFactory;

beforeEach(() => {
    factory = new ShapeFactory();
});

describe("ShapeFactory — error handling", () => {
    const plane = Plane.XY;
    const shiftedPlane = new Plane({
        origin: new XYZ({ x: 5, y: 0, z: 0 }),
        normal: XYZ.unitZ,
        xvec: XYZ.unitX,
    });

    describe("box", () => {
        test("should create a box successfully", () => {
            const result = factory.box(plane, 10, 20, 30);
            expect(result.isOk).toBe(true);
            expect(result.value).toBeDefined();
        });
    });

    describe("sphere", () => {
        test("should create a sphere successfully", () => {
            const result = factory.sphere(XYZ.zero, 10);
            expect(result.isOk).toBe(true);
        });
    });

    describe("line", () => {
        test("should create a line successfully", () => {
            const result = factory.line(XYZ.zero, XYZ.unitX);
            expect(result.isOk).toBe(true);
        });

        test("should return error when start and end are too close", () => {
            const result = factory.line(XYZ.zero, XYZ.zero);
            expect(result.isOk).toBe(false);
            expect(result.error).toBe("The start and end points are too close.");
        });
    });

    describe("fillet", () => {
        test("should return error when radius is too small", () => {
            const boxValue = factory.box(plane, 10, 10, 10).value;
            const result = factory.fillet(boxValue, [0], 0);
            expect(result.isOk).toBe(false);
            expect(result.error).toBe("The radius is too small.");
        });

        test("should return error when edges is empty", () => {
            const boxValue = factory.box(plane, 10, 10, 10).value;
            const result = factory.fillet(boxValue, [], 5);
            expect(result.isOk).toBe(false);
            expect(result.error).toBe("The edges is empty.");
        });

        test("should return error when shape is not OccShape", () => {
            const fakeShape = { shapeType: "edge" } as unknown as IShape;
            const result = factory.fillet(fakeShape, [0], 5);
            expect(result.isOk).toBe(false);
            expect(result.error).toBe("Not OccShape");
        });

        test("should catch WASM error on invalid edge index", () => {
            const boxValue = factory.box(plane, 10, 10, 10).value;
            const result = factory.fillet(boxValue, [999], 5);
            expect(result.isOk).toBe(false);
            expect(result.error).toContain("Fillet Error");
        });
    });

    describe("prism", () => {
        test("should return error when vector length is zero", () => {
            const boxValue = factory.box(plane, 10, 10, 10).value;
            const result = factory.prism(boxValue, XYZ.zero);
            expect(result.isOk).toBe(false);
            expect(result.error).toBe("The vector length is 0, the prism cannot be created.");
        });
    });

    describe("face", () => {
        test("should return error when wire is empty", () => {
            const result = factory.face([]);
            expect(result.isOk).toBe(false);
            expect(result.error).toBe("The wire is empty.");
        });
    });

    describe("boolean operations", () => {
        test("booleanCommon should handle the happy path", () => {
            const box1 = factory.box(plane, 10, 10, 10).value;
            const box2 = factory.box(shiftedPlane, 10, 10, 10).value;
            const result = factory.booleanCommon([box1], [box2]);
            expect(result.isOk).toBe(true);
        });

        test("booleanFuse should handle the happy path without simplify", () => {
            const box1 = factory.box(plane, 10, 10, 10).value;
            const box2 = factory.box(shiftedPlane, 10, 10, 10).value;
            const result = factory.booleanFuse([box1], [box2], false);
            expect(result.isOk).toBe(true);
        });
    });

    describe("convertShapeResult catch", () => {
        test("should return error when WASM throws (fillet with invalid edge)", () => {
            const boxValue = factory.box(plane, 10, 10, 10).value;
            const result = factory.fillet(boxValue, [999], 5);
            expect(result.isOk).toBe(false);
            expect(result.error).toContain("Fillet Error");
        });

        test("should return error when chamfer with invalid edge", () => {
            const boxValue = factory.box(plane, 10, 10, 10).value;
            const result = factory.chamfer(boxValue, [999], 5);
            expect(result.isOk).toBe(false);
            expect(result.error).toContain("Chamfer Error");
        });
    });
});
