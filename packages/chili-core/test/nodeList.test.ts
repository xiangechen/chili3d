// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import "reflect-metadata";

import { IDocument, NodeLinkedList } from "../src";
import { TestHistory } from "./common";

describe("test NodeLinkedList", () => {
    let doc: IDocument = { history: new TestHistory() } as any;

    test("test add and remove", () => {
        let l1 = new NodeLinkedList(doc, "l1");
        let l2 = new NodeLinkedList(doc, "l2");
        let l3 = new NodeLinkedList(doc, "l3");
        let l4 = new NodeLinkedList(doc, "l4");

        l1.add(l2);
        expect(l1.firstChild()).toEqual(l2);
        expect(l1.lastChild()).toEqual(l2);
        expect(l1.size()).toBe(1);

        l1.remove(l2);
        expect(l1.firstChild()).toBeUndefined();
        expect(l1.lastChild()).toBeUndefined();
        expect(l1.size()).toBe(0);

        l1.add(l2);
        l1.add(l3);
        expect(l1.firstChild()).toEqual(l2);
        expect(l1.lastChild()).toBe(l3);
        expect(l2.nextSibling).toBe(l3);
        expect(l3.previousSibling).toBe(l2);
        expect(l1.size()).toBe(2);

        l1.remove(l2);
        expect(l1.firstChild()).toBe(l3);
        expect(l1.lastChild()).toBe(l3);
        expect(l1.size()).toBe(1);

        l1.add(l2);
        expect(l1.firstChild()).toBe(l3);
        expect(l1.lastChild()).toBe(l2);
        l1.add(l4);
        expect(l1.size()).toBe(3);
        expect(l1.lastChild()).toBe(l4);
        l1.remove(l2);
        expect(l3.nextSibling).toBe(l4);
        expect(l4.previousSibling).toBe(l3);
        expect(l1.size()).toBe(2);
    });

    test("test insert before", () => {
        let l1 = new NodeLinkedList(doc, "l1");
        let l2 = new NodeLinkedList(doc, "l2");
        let l3 = new NodeLinkedList(doc, "l3");
        let l4 = new NodeLinkedList(doc, "l4");

        l1.insertBefore(undefined, l2);
        expect(l1.firstChild()).toBe(l2);
        expect(l1.lastChild()).toBe(l2);
        expect(l1.size()).toBe(1);

        l1.insertBefore(l2, l3);
        expect(l1.firstChild()).toBe(l3);
        expect(l3.nextSibling).toBe(l2);
        expect(l2.previousSibling).toBe(l3);
        expect(l1.size()).toBe(2);

        l1.insertBefore(l3, l4);
        expect(l3.previousSibling).toBe(l4);
        expect(l4.nextSibling).toBe(l3);
        expect(l1.size()).toBe(3);
    });

    test("test insert after", () => {
        let l1 = new NodeLinkedList(doc, "l1");
        let l2 = new NodeLinkedList(doc, "l2");
        let l3 = new NodeLinkedList(doc, "l3");
        let l4 = new NodeLinkedList(doc, "l4");

        l1.insertAfter(undefined, l2);
        expect(l1.firstChild()).toEqual(l2);
        expect(l1.lastChild()).toEqual(l2);
        expect(l1.size()).toBe(1);

        l1.insertAfter(l2, l3);
        expect(l1.firstChild()).toEqual(l2);
        expect(l1.lastChild()).toEqual(l3);
        expect(l2.nextSibling).toBe(l3);
        expect(l2.previousSibling).toBeUndefined();
        expect(l3.previousSibling).toBe(l2);
        expect(l1.size()).toBe(2);

        l1.insertAfter(l2, l4);
        expect(l4.previousSibling).toBe(l2);
        expect(l4.nextSibling).toBe(l3);
        expect(l2.nextSibling).toBe(l4);
        expect(l1.size()).toBe(3);
    });

    test("test moveTo", () => {
        let l1 = new NodeLinkedList(doc, "l1");
        let l2 = new NodeLinkedList(doc, "l2");
        let l3 = new NodeLinkedList(doc, "l3");
        let l4 = new NodeLinkedList(doc, "l4");
        let l5 = new NodeLinkedList(doc, "l5");
        let l6 = new NodeLinkedList(doc, "l6");

        l1.add(l2);
        l2.add(l3);
        l1.add(l4);
        l1.moveToAfter(l2, l5, undefined);
        expect(l1.firstChild()).toBe(l4);
        expect(l2.firstChild()).toBe(l3);
        expect(l5.firstChild()).toBe(l2);

        l5.add(l6);
        l1.moveToAfter(l4, l5, l6);
        expect(l4.previousSibling).toBe(l6);
    });
});
