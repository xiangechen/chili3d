// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import "reflect-metadata";
import { XYZ } from "../src";
import { XYZConverter, NumberConverter, ConverterBase, StringConverter } from "../src/converter";

describe("converter test", () => {
    test("test type", () => {
        let converters = [new XYZConverter(), new NumberConverter()];
        expect(converters.every((x) => x instanceof ConverterBase)).toBeTruthy();
    });

    test("test XYZConverter", () => {
        let converter = new XYZConverter();
        let xyz = XYZ.unitX;
        let c = converter.convert(xyz);
        expect(c).toStrictEqual("1,0,0");
        expect(converter.convertBack(c!)?.x).toBe(1);
        expect(converter.convertBack("1")).toBeUndefined();
        expect(converter.convertBack("1, 1, 1, 1")).toBeUndefined();
        expect(converter.convertBack("1, 1, 1")).toStrictEqual(new XYZ(1, 1, 1));
    });

    test("test NumberConverter", () => {
        let converter = new NumberConverter();
        expect(converter.convert(Number.NaN)).toBeUndefined();
        expect(converter.convert(-20)).toBe("-20");
        expect(converter.convert(20)).toBe("20");
        expect(converter.convert(1e3)).toBe("1000");
        expect(converter.convertBack("NaN")).toBeUndefined();
        expect(converter.convertBack("1a")).toBeUndefined();
        expect(converter.convertBack("1E-3")).toBe(0.001);
        expect(converter.convertBack("-3")).toBe(-3);
    });

    test("test StringConverter", () => {
        let converter = new StringConverter();
        expect(converter.convert("")).toBe("");
        expect(converter.convertBack("")).toBe("");
    });
});
