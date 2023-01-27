// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import "reflect-metadata";

import { Result } from "../src";

test("test result", () => {
    let r1 = Result.ok("11");
    expect(r1.isOk()).toBeTruthy;
    expect(r1.value).toBe("11");
    expect(r1.isErr()).toBeFalsy();
    expect(r1.err).toBeUndefined();

    let r2 = Result.error("err");
    expect(r2.isOk()).toBeFalsy;
    expect(r2.value).toBeUndefined();
    expect(r2.isErr()).toBeTruthy();
    expect(r2.err).toBe("err");
});
