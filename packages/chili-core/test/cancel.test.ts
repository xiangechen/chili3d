// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import "reflect-metadata";

import { TaskToken } from "../src";

test("test CancellationToken", async () => {
    let token = new TaskToken();
    expect(token.isCanceled).toBeFalsy();
    await new Promise((r, s) => {
        setTimeout(() => {
            token.cancel();
            r("resolved");
        }, 30);
    });
    expect(token.isCanceled).toBeTruthy();
});
