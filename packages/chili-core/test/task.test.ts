// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import "reflect-metadata";

import { AsyncState } from "../src";

test("test cancel", async () => {
    let token = new AsyncState();
    expect(token.state?.status === "cancel").toBeFalsy();
    await new Promise((r, s) => {
        setTimeout(() => {
            token.cancel();
            r("resolved");
        }, 30);
    });
    expect(token.state?.status === "cancel").toBeTruthy();
});

test("test fail", async () => {
    let token = new AsyncState();
    expect(token.state?.status === "fail").toBeFalsy();
    await new Promise((r, s) => {
        setTimeout(() => {
            token.fail("fail msg");
            r("resolved");
        }, 30);
    });
    expect(token.state?.status === "fail").toBeTruthy();
    expect(token.state?.prompt).toBe("fail msg");
});

test("test complete", async () => {
    let token = new AsyncState();
    expect(token.state?.status === "success").toBeFalsy();
    await new Promise((r, s) => {
        setTimeout(() => {
            token.success();
            r("resolved");
        }, 30);
    });
    expect(token.state?.status === "success").toBeTruthy();
});
