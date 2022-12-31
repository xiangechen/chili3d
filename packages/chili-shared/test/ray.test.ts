// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import "reflect-metadata";
import { Ray, XYZ } from "../src";

describe("test ray", () => {
    test("test", () => {
        let r1 = new Ray(XYZ.zero, XYZ.unitX);
        expect(r1.nearestToPoint(XYZ.zero)).toStrictEqual(XYZ.zero);
        expect(r1.nearestTo(new Ray(XYZ.unitZ, XYZ.unitX))).toStrictEqual(XYZ.zero);
        expect(r1.nearestTo(new Ray(XYZ.unitZ, XYZ.unitZ.reverse()))).toStrictEqual(XYZ.zero);
        expect(r1.nearestTo(new Ray(XYZ.unitZ, XYZ.unitX.add(XYZ.unitZ)))).toStrictEqual(new XYZ(-1, 0, 0));
        expect(r1.nearestTo(new Ray(XYZ.unitZ, XYZ.unitX.add(XYZ.unitZ.reverse())))).toStrictEqual(new XYZ(1, 0, 0));

        expect(r1.nearestTo(new Ray(new XYZ(0.5, -0.5, 0), XYZ.unitY))).toStrictEqual(new XYZ(0.5, 0, 0));
    });
});
