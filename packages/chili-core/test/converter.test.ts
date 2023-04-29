// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import "reflect-metadata";

import { XYZ } from "../src";
import { IConverter, NumberConverter, StringConverter, XYZConverter } from "../src/converter";

describe("converter test", () => {
    test("test type", () => {
        let converters = [new XYZConverter(), new NumberConverter()];
        expect(converters.every((x) => (x as IConverter).convert !== undefined)).toBeTruthy();
    });

    test("test XYZConverter", () => {
        let converter = new XYZConverter();
        let xyz = XYZ.unitX;
        let c = converter.convert(xyz);
        expect(c.value).toStrictEqual("1,0,0");
        expect(converter.convertBack(c.value!).value?.x).toBe(1);
        expect(converter.convertBack("1").value).toBeUndefined();
        expect(converter.convertBack("1, 1, 1, 1").value).toBeUndefined();
        expect(converter.convertBack("1, 1, 1").value).toStrictEqual(new XYZ(1, 1, 1));
    });

    test("test NumberConverter", () => {
        let converter = new NumberConverter();
        expect(converter.convert(Number.NaN).value).toBeUndefined();
        expect(converter.convert(-20).value).toBe("-20");
        expect(converter.convert(20).value).toBe("20");
        expect(converter.convert(1e3).value).toBe("1000");
        expect(converter.convertBack("NaN").value).toBeUndefined();
        expect(converter.convertBack("1a").value).toBeUndefined();
        expect(converter.convertBack("1E-3").value).toBe(0.001);
        expect(converter.convertBack("-3").value).toBe(-3);
    });

    test("test StringConverter", () => {
        let converter = new StringConverter();
        expect(converter.convert("").value).toBe("");
        expect(converter.convertBack("").value).toBe("");
    });
});
