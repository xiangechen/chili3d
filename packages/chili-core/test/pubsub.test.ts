// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import "reflect-metadata";

import { PubSub } from "../src";

describe("test pubsub", () => {
    let testNum = 0;

    function callback2(source: any, args: any): void {
        testNum += args + 1;
    }
});
