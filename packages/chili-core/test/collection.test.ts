// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { CollectionAction, CollectionChangedArgs, ObservableCollection } from "../src";

describe("ObservableCollection test", () => {
    test("test add", () => {
        let collection = new ObservableCollection<number>();
        collection.onCollectionChanged((arg: CollectionChangedArgs) => {
            if (arg.action === CollectionAction.add) {
                expect(arg.items.length).toBe(1);
            }
        });
        collection.push(1);
    });

    test("test remove", () => {
        let collection = new ObservableCollection<number>(1, 2, 3);
        collection.onCollectionChanged((arg: CollectionChangedArgs) => {
            if (arg.action === CollectionAction.remove) {
                expect(arg.items).toStrictEqual([1, 3]);
                expect(arg.items.length).toBe(2);
            }
        });
        collection.remove(1, 3);
    });

    test("test move", () => {
        let collection = new ObservableCollection<number>(1, 2, 3);
        collection.onCollectionChanged((arg: CollectionChangedArgs) => {
            if (arg.action === CollectionAction.move) {
                expect(collection.items).toStrictEqual([2, 1, 3]);
                expect(collection.items.length).toBe(3);
                expect(arg.from).toBe(0);
                expect(arg.to).toBe(2);
            }
        });
        collection.move(0, 2);
    });

    test("test replace", () => {
        let collection = new ObservableCollection<number>(1, 2, 3);
        collection.onCollectionChanged((arg: CollectionChangedArgs) => {
            if (arg.action === CollectionAction.replace) {
                expect(collection.items).toStrictEqual([1, 3, 2, 3]);
                expect(arg.items).toStrictEqual([3, 2]);
                expect(arg.items.length).toBe(2);
                expect(arg.item).toBe(2);
            }
        });
        collection.replace(1, 3, 2);
    });
});
