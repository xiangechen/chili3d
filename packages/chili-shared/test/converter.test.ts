// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import "reflect-metadata";
import { XYZ } from "../src";
import { XYZConverter } from "../src/converter";

describe("converter test", () => {
    test("test XYZConverter", () => {
        class Demo {
            location: XYZ;

            constructor() {
                this.location = XYZ.unitX;
            }
        }

        let demo: any = new Demo();
        let converter = new XYZConverter();
        console.log(typeof converter === typeof demo["location"]);
        console.log("location" in demo);

        let c = converter.convert(demo["location"]);
        expect(c).toStrictEqual("1,0,0");
        expect(converter.convertBack(c!)?.x).toBe(1);
    });
});
