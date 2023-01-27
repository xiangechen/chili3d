// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import "reflect-metadata";

import { Plane, Ray, XYZ } from "../src";

describe("test plane", () => {
    test("test freeze", () => {
        Plane.XY.x.x = 4; // Frozen objects are modified ???
        console.log("Frozen objects are modified");
        expect(Plane.XY.x.x).toBe(4);
    });

    test("test constructor", () => {
        expect(() => new Plane(XYZ.zero, XYZ.unitX, XYZ.unitX)).toThrow();
        expect(() => new Plane(XYZ.zero, XYZ.zero, XYZ.unitY)).toThrow();
        expect(() => new Plane(XYZ.zero, XYZ.unitX, XYZ.zero)).toThrow();
    });

    test("test intersect", () => {
        let plane = new Plane(XYZ.zero, XYZ.unitZ, XYZ.unitX);
        expect(plane.intersect(new Ray(XYZ.unitZ, XYZ.unitX))).toBeUndefined();
        expect(plane.intersect(new Ray(XYZ.unitZ, XYZ.unitZ.reverse()))).toStrictEqual(XYZ.zero);
        expect(plane.intersect(new Ray(XYZ.unitX, XYZ.unitZ.add(XYZ.unitX)))).toStrictEqual(XYZ.unitX);
        expect(plane.intersect(new Ray(new XYZ(1, 1, 1), new XYZ(-1, 0, -1)))).toStrictEqual(new XYZ(0, 1, 0));
        expect(plane.intersect(new Ray(new XYZ(1, 1, 1), new XYZ(1, 0, 1)))).toStrictEqual(new XYZ(0, 1, 0));
        expect(plane.intersect(new Ray(new XYZ(1, 1, 1), new XYZ(1, 0, 1)), false)).toBeUndefined();
    });
});
