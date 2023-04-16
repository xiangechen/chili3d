// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import "reflect-metadata";

import { PubSub } from "../src";

describe("test pubsub", () => {
    let testNum = 0;

    function callback2(source: any, args: any): void {
        testNum += args + 1;
    }

    test("test add and remove", () => {
        let pubsub = new PubSub();
        const addCallback = (s: any, a: any) => {
            testNum += a;
        };
        pubsub.sub("nodeAdded", callback2);
        pubsub.sub("nodeAdded", addCallback);
        pubsub.sub("nodeAdded", callback2);
        pubsub.pub("nodeAdded", this as any, 3 as any);
        expect(testNum).toEqual(7);
        pubsub.remove("nodeAdded", addCallback);
        pubsub.pub("nodeAdded", this as any, 1 as any);
        expect(testNum).toEqual(9);
        pubsub.remove("nodeAdded", callback2);
        pubsub.pub("nodeAdded", this as any, 4 as any);
        expect(testNum).toEqual(9);

        pubsub.sub("nodeAdded", (s: any, a: any) => {
            testNum -= 1;
        });
        pubsub.remove("nodeAdded", (s: any, a: any) => {
            testNum -= 1;
        });
        pubsub.pub("nodeAdded", this as any, 1 as any);
        expect(testNum).toEqual(8);
    });
});
