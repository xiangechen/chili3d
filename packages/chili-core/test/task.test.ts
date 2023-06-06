// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import "reflect-metadata";

import { TaskManager } from "../src";

test("test cancel", async () => {
    let token = new TaskManager();
    expect(token.isCancelled).toBeFalsy();
    await new Promise((r, s) => {
        setTimeout(() => {
            token.cancel();
            r("resolved");
        }, 30);
    });
    expect(token.isCancelled).toBeTruthy();
});

test("test complete", async () => {
    let token = new TaskManager();
    expect(token.isCompleted).toBeFalsy();
    await new Promise((r, s) => {
        setTimeout(() => {
            token.complete();
            r("resolved");
        }, 30);
    });
    expect(token.isCompleted).toBeTruthy();
});
