// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { IConverter, XYZ } from "chili-core";
import { ColorConverter } from "../src/converters/colorConverter";
import { NumberConverter } from "../src/converters/numberConverter";
import { StringConverter } from "../src/converters/stringConverter";
import { XYZConverter } from "../src/converters/xyzConverter";

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
        expect(converter.convertBack(c.value).value.x).toBe(1);
        expect(converter.convertBack("1").isOk).toBe(false);
        expect(converter.convertBack("1, 1, 1, 1").isOk).toBe(false);
        expect(converter.convertBack("1, 1, 1").value).toStrictEqual(new XYZ(1, 1, 1));
    });

    test("test NumberConverter", () => {
        let converter = new NumberConverter();
        expect(converter.convert(Number.NaN).isOk).toBe(false);
        expect(converter.convert(-20).value).toBe("-20");
        expect(converter.convert(20).value).toBe("20");
        expect(converter.convert(1e3).value).toBe("1000");
        expect(converter.convertBack("NaN").isOk).toBeFalsy();
        expect(converter.convertBack("1a").isOk).toBeFalsy();
        expect(converter.convertBack("1E-3").value).toBe(0.001);
        expect(converter.convertBack("-3").value).toBe(-3);
    });

    test("test StringConverter", () => {
        let converter = new StringConverter();
        expect(converter.convert("").value).toBe("");
        expect(converter.convertBack("").value).toBe("");
    });

    test("test ColorConverter", () => {
        let converter = new ColorConverter();

        // Test normal number conversion
        expect(converter.convert(0xff0000).value).toBe("#ff0000");
        expect(converter.convert(255).value).toBe("#0000ff");
        expect(converter.convert(0).value).toBe("#000000");

        // Test string conversion
        expect(converter.convert("#ff0000").value).toBe("#ff0000");
        expect(converter.convert("ff0000").value).toBe("#ff0000");
        expect(converter.convert("#FF0000").value).toBe("#FF0000");

        // Test undefined and null handling (NEW)
        expect(converter.convert(undefined as any).value).toBe("#808080");
        expect(converter.convert(null as any).value).toBe("#808080");
        expect(converter.convert("" as any).value).toBe("#808080");
        expect(converter.convert("invalid" as any).value).toBe("#808080");
        expect(converter.convert(NaN as any).value).toBe("#808080");

        // Test convertBack
        expect(converter.convertBack("#ff0000").value).toBe(0xff0000);
        expect(converter.convertBack("ff0000").value).toBe(0xff0000);
        expect(converter.convertBack("invalid").isOk).toBe(false);
    });
});
