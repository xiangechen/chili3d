// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import "reflect-metadata";

import { Result } from "../src";

test("test result", () => {
    let r1 = Result.ok("11");
    expect(r1.isOk()).toBeTruthy;
    expect(r1.value).toBe("11");
    expect(r1.hasError()).toBeFalsy();
    expect(r1.error).toBeUndefined();

    let r2 = Result.error("err");
    expect(r2.isOk()).toBeFalsy;
    expect(r2.value).toBeUndefined();
    expect(r2.hasError()).toBeTruthy();
    expect(r2.error).toBe("err");

    let r3 = Result.ok(true);
    expect(r3.isOk()).toBeTruthy();
    expect(r3.hasError()).toBeFalsy();
    expect(r3.value).toBeTruthy();
    expect(r3.error).toBeUndefined();

    let r4 = Result.ok(undefined);
    expect(r4.isOk()).toBeTruthy();
    expect(r4.hasError()).toBeFalsy();
    expect(r4.value).toBeUndefined();
    expect(r4.error).toBeUndefined();

    let r5 = Result.error(undefined);
    expect(r5.hasError()).toBeTruthy();
    expect(r5.isOk()).toBeFalsy();
    expect(r5.value).toBeUndefined();
    expect(r5.error).toBeUndefined();
});
