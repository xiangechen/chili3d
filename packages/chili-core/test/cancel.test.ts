// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import "reflect-metadata";

import { CancellationToken } from "../src";

test("test CancellationToken", async () => {
    let token = new CancellationToken();
    expect(token.isCanceled).toBeFalsy();
    await new Promise((r, s) => {
        setTimeout(() => {
            token.cancel();
            r("resolved");
        }, 30);
    });
    expect(token.isCanceled).toBeTruthy();
});
