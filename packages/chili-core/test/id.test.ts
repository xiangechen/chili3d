// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Id } from "../src";

describe("Id class", () => {
    test("should generate ID with default length of 21", () => {
        const id = Id.generate();
        expect(typeof id).toBe("string");
        expect(id.length).toBe(21);
    });

    test("should generate ID with custom length", () => {
        const length = 10;
        const id = Id.generate(length);
        expect(id.length).toBe(length);
    });

    test("should generate ID with length 1", () => {
        const id = Id.generate(1);
        expect(id.length).toBe(1);
        expect(id.length).toBe(1);
    });

    test("should generate ID with large length", () => {
        const length = 100;
        const id = Id.generate(length);
        expect(id.length).toBe(length);
    });

    test("should generate ID with length 0", () => {
        const id = Id.generate(0);
        expect(id.length).toBe(0);
        expect(id).toBe("");
    });

    test("should generate ID using valid characters from alphabet", () => {
        const alphabet = "useandom-26T198340PX75pxJACKVERYMINDBUSHWOLF_GQZbfghjklqvwyzrict";
        const id = Id.generate(100);
        for (const char of id) {
            expect(alphabet.includes(char)).toBe(true);
        }
    });

    test("should generate unique IDs", () => {
        const ids = new Set<string>();
        for (let i = 0; i < 100; i++) {
            ids.add(Id.generate());
        }
        expect(ids.size).toBe(100);
    });

    test("should generate different IDs in same batch", () => {
        const id1 = Id.generate();
        const id2 = Id.generate();
        expect(id1).not.toBe(id2);
    });
});
