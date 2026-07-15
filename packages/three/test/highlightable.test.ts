// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type IHighlightable, isHighlightable } from "../src/highlightable";

describe("isHighlightable", () => {
    test("returns true for object with highlight and unhighlight methods", () => {
        const obj: IHighlightable = {
            highlight() {},
            unhighlight() {},
        };
        expect(isHighlightable(obj)).toBe(true);
    });

    test("returns falsy for object missing highlight method", () => {
        const obj = {
            unhighlight() {},
        };
        expect(isHighlightable(obj)).toBeFalsy();
    });

    test("returns falsy for object missing unhighlight method", () => {
        const obj = {
            highlight() {},
        };
        expect(isHighlightable(obj)).toBeFalsy();
    });

    test("returns falsy for null", () => {
        expect(isHighlightable(null)).toBeFalsy();
    });

    test("returns falsy for undefined", () => {
        expect(isHighlightable(undefined)).toBeFalsy();
    });

    test("returns falsy for plain object", () => {
        expect(isHighlightable({})).toBeFalsy();
    });

    test("returns falsy for string", () => {
        expect(isHighlightable("hello")).toBeFalsy();
    });

    test("returns falsy for number", () => {
        expect(isHighlightable(42)).toBeFalsy();
    });

    test("class implementing IHighlightable passes the check", () => {
        class MyHighlightable implements IHighlightable {
            highlight(): void {}
            unhighlight(): void {}
        }
        expect(isHighlightable(new MyHighlightable())).toBe(true);
    });
});
