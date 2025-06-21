// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { LinkedList } from "../src";

describe("LinkedList", () => {
    let linkedList: LinkedList<number>;

    beforeEach(() => {
        linkedList = new LinkedList();
    });

    describe("push", () => {
        test("should add items to the end of the list", () => {
            linkedList.push(1, 2, 3);
            expect(linkedList.size).toBe(3);
            expect(linkedList.head).toBe(1);
            expect(linkedList.tail).toBe(3);
        });
    });

    describe("insert", () => {
        test("should insert an item at the specified index", () => {
            linkedList.push(1, 2, 3);
            linkedList.insert(1, 4);
            expect(linkedList.size).toBe(4);
            expect(linkedList.head).toBe(1);
            expect(linkedList.tail).toBe(3);
            expect([...linkedList]).toEqual([1, 4, 2, 3]);
        });

        test("should not insert an item if the index is out of range", () => {
            linkedList.push(1, 2, 3);
            linkedList.insert(5, 4);
            expect(linkedList.size).toBe(3);
            expect([...linkedList]).toEqual([1, 2, 3]);
        });
    });

    describe("remove", () => {
        test("should remove all occurrences of an item from the list", () => {
            linkedList.push(1, 2, 3, 2);
            linkedList.remove(2);
            expect(linkedList.size).toBe(3);
            expect([...linkedList]).toEqual([1, 3, 2]);
        });
    });

    describe("removeAt", () => {
        test("should remove an item at the specified index", () => {
            linkedList.push(1, 2, 3);
            linkedList.removeAt(1);
            expect(linkedList.size).toBe(2);
            expect([...linkedList]).toEqual([1, 3]);
        });

        test("should not remove an item if the index is out of range", () => {
            linkedList.push(1, 2, 3);
            linkedList.removeAt(5);
            expect(linkedList.size).toBe(3);
            expect([...linkedList]).toEqual([1, 2, 3]);
        });
    });

    describe("clear", () => {
        test("should remove all items from the list", () => {
            linkedList.push(1, 2, 3);
            linkedList.clear();
            expect(linkedList.size).toBe(0);
            expect(linkedList.head).toBeUndefined();
            expect(linkedList.tail).toBeUndefined();
        });
    });

    describe("reverse", () => {
        test("should reverse the order of items in the list", () => {
            linkedList.push(1, 2, 3);
            linkedList.reverse();
            expect([...linkedList]).toEqual([3, 2, 1]);
        });
    });
});
