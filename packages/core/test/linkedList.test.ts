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

        test("should reverse single element list (no-op)", () => {
            linkedList.push(42);
            linkedList.reverse();
            expect(linkedList.head).toBe(42);
            expect(linkedList.tail).toBe(42);
            expect([...linkedList]).toEqual([42]);
        });

        test("should reverse two element list", () => {
            linkedList.push(1, 2);
            linkedList.reverse();
            expect(linkedList.head).toBe(2);
            expect(linkedList.tail).toBe(1);
            expect([...linkedList]).toEqual([2, 1]);
        });

        test("should reverse empty list (no-op)", () => {
            linkedList.reverse();
            expect(linkedList.size).toBe(0);
            expect(linkedList.head).toBeUndefined();
            expect(linkedList.tail).toBeUndefined();
        });

        test("double reverse should restore original order", () => {
            linkedList.push(1, 2, 3, 4, 5);
            linkedList.reverse();
            linkedList.reverse();
            expect([...linkedList]).toEqual([1, 2, 3, 4, 5]);
        });
    });

    describe("insert edge cases", () => {
        test("should not insert at index 0 in empty list", () => {
            linkedList.insert(0, 1);
            expect(linkedList.size).toBe(0);
            expect(linkedList.head).toBeUndefined();
            expect(linkedList.tail).toBeUndefined();
        });

        test("should insert at index 0 in non-empty list", () => {
            linkedList.push(2, 3, 4);
            linkedList.insert(0, 1);
            expect(linkedList.size).toBe(4);
            expect(linkedList.head).toBe(1);
            expect([...linkedList]).toEqual([1, 2, 3, 4]);
        });

        test("should insert at middle index (front half)", () => {
            linkedList.push(1, 2, 4, 5);
            linkedList.insert(2, 3);
            expect([...linkedList]).toEqual([1, 2, 3, 4, 5]);
        });

        test("should insert at middle index (back half)", () => {
            linkedList.push(1, 2, 3, 5);
            linkedList.insert(3, 4);
            expect([...linkedList]).toEqual([1, 2, 3, 4, 5]);
        });

        test("should not insert at negative index", () => {
            linkedList.push(1, 2);
            linkedList.insert(-1, 0);
            expect(linkedList.size).toBe(2);
        });

        test("should not insert at index equal to size (past end)", () => {
            linkedList.push(1, 2);
            linkedList.insert(2, 3);
            expect(linkedList.size).toBe(2);
        });

        test("should not insert at index greater than size", () => {
            linkedList.push(1, 2, 3);
            linkedList.insert(10, 99);
            expect(linkedList.size).toBe(3);
        });

        test("should insert at last index (before tail)", () => {
            linkedList.push(1, 2, 4);
            linkedList.insert(2, 3);
            expect([...linkedList]).toEqual([1, 2, 3, 4]);
            expect(linkedList.tail).toBe(4);
        });

        test("should update head when inserting at 0 in single item list", () => {
            linkedList.push(5);
            linkedList.insert(0, 1);
            expect(linkedList.head).toBe(1);
            expect(linkedList.tail).toBe(5);
            expect([...linkedList]).toEqual([1, 5]);
        });
    });

    describe("remove edge cases", () => {
        test("should remove head element", () => {
            linkedList.push(1, 2, 3);
            linkedList.remove(1);
            expect(linkedList.head).toBe(2);
            expect(linkedList.size).toBe(2);
            expect([...linkedList]).toEqual([2, 3]);
        });

        test("should remove tail element", () => {
            linkedList.push(1, 2, 3);
            linkedList.remove(3);
            expect(linkedList.tail).toBe(2);
            expect(linkedList.size).toBe(2);
            expect([...linkedList]).toEqual([1, 2]);
        });

        test("should remove only element (head and tail become undefined)", () => {
            linkedList.push(42);
            linkedList.remove(42);
            expect(linkedList.size).toBe(0);
            expect(linkedList.head).toBeUndefined();
            expect(linkedList.tail).toBeUndefined();
        });

        test("should not modify list when removing non-existent item", () => {
            linkedList.push(1, 2, 3);
            linkedList.remove(99);
            expect(linkedList.size).toBe(3);
            expect([...linkedList]).toEqual([1, 2, 3]);
        });

        test("should only remove first occurrence", () => {
            linkedList.push(1, 2, 2, 3);
            linkedList.remove(2);
            expect(linkedList.size).toBe(3);
            expect([...linkedList]).toEqual([1, 2, 3]);
        });
    });

    describe("removeAt edge cases", () => {
        test("should remove head via removeAt(0)", () => {
            linkedList.push(1, 2, 3);
            linkedList.removeAt(0);
            expect(linkedList.head).toBe(2);
            expect(linkedList.size).toBe(2);
        });

        test("should remove tail via removeAt(size-1)", () => {
            linkedList.push(1, 2, 3);
            linkedList.removeAt(2);
            expect(linkedList.tail).toBe(2);
            expect(linkedList.size).toBe(2);
        });

        test("should remove only element via removeAt(0)", () => {
            linkedList.push(42);
            linkedList.removeAt(0);
            expect(linkedList.size).toBe(0);
            expect(linkedList.head).toBeUndefined();
            expect(linkedList.tail).toBeUndefined();
        });

        test("should not throw on negative index", () => {
            linkedList.push(1, 2);
            linkedList.removeAt(-1);
            expect(linkedList.size).toBe(2);
        });

        test("should not throw on out of bounds index", () => {
            linkedList.push(1, 2);
            linkedList.removeAt(10);
            expect(linkedList.size).toBe(2);
        });
    });

    describe("clear edge cases", () => {
        test("should clear empty list (no-op)", () => {
            linkedList.clear();
            expect(linkedList.size).toBe(0);
            expect(linkedList.head).toBeUndefined();
            expect(linkedList.tail).toBeUndefined();
        });

        test("should allow push after clear", () => {
            linkedList.push(1, 2, 3);
            linkedList.clear();
            linkedList.push(4, 5);
            expect(linkedList.size).toBe(2);
            expect(linkedList.head).toBe(4);
            expect(linkedList.tail).toBe(5);
            expect([...linkedList]).toEqual([4, 5]);
        });
    });

    describe("iteration", () => {
        test("should iterate over empty list", () => {
            const values: number[] = [];
            for (const v of linkedList) {
                values.push(v);
            }
            expect(values).toEqual([]);
        });

        test("should iterate over single item", () => {
            linkedList.push(42);
            expect([...linkedList]).toEqual([42]);
        });

        test("should iterate correctly after mixed operations", () => {
            linkedList.push(1, 2, 3);
            linkedList.remove(2);
            linkedList.push(4);
            linkedList.insert(0, 0);
            expect([...linkedList]).toEqual([0, 1, 3, 4]);
        });
    });

    describe("push edge cases", () => {
        test("should push single item to empty list", () => {
            linkedList.push(42);
            expect(linkedList.head).toBe(42);
            expect(linkedList.tail).toBe(42);
            expect(linkedList.size).toBe(1);
        });

        test("should push multiple items at once", () => {
            linkedList.push(1, 2, 3, 4, 5);
            expect(linkedList.size).toBe(5);
        });

        test("should push to existing list", () => {
            linkedList.push(1);
            linkedList.push(2, 3);
            expect(linkedList.size).toBe(3);
            expect(linkedList.tail).toBe(3);
        });
    });

    describe("nodeAt traversal optimization", () => {
        test("should traverse from head for front-half insert", () => {
            for (let i = 0; i < 20; i++) {
                linkedList.push(i);
            }
            linkedList.insert(5, 999);
            expect([...linkedList][5]).toBe(999);
        });

        test("should traverse from tail for back-half insert", () => {
            for (let i = 0; i < 20; i++) {
                linkedList.push(i);
            }
            linkedList.insert(15, 999);
            expect([...linkedList][15]).toBe(999);
        });

        test("should traverse from tail for back-half removeAt", () => {
            for (let i = 0; i < 20; i++) {
                linkedList.push(i);
            }
            linkedList.removeAt(15);
            expect(linkedList.size).toBe(19);
            expect([...linkedList][14]).toBe(14);
            expect([...linkedList][15]).toBe(16);
        });
    });

    describe("operation sequences", () => {
        test("push -> remove head -> push -> reverse", () => {
            linkedList.push(1, 2, 3);
            linkedList.remove(1);
            linkedList.push(4);
            linkedList.reverse();
            expect([...linkedList]).toEqual([4, 3, 2]);
        });

        test("insert -> removeAt -> clear", () => {
            linkedList.push(1, 2);
            linkedList.insert(1, 99);
            linkedList.removeAt(0);
            linkedList.clear();
            expect(linkedList.size).toBe(0);
            expect([...linkedList]).toEqual([]);
        });
    });
});
