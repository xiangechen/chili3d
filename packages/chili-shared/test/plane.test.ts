// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import "reflect-metadata";
import { Plane, Ray, XYZ } from "../src";

describe("test plane", () => {
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
