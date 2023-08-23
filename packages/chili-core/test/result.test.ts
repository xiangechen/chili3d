// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Result } from "../src";

test("test result", () => {
    let r1 = Result.success("11");
    expect(r1.status === "success").toBeTruthy;
    expect(r1.unwrap()).toBe("11");
    expect(r1.status === "error").toBeFalsy();

    let r2 = Result.error("err");
    expect(r2.status === "success").toBeFalsy();
    expect(() => r2.unwrap()).toThrow("err");
    expect(r2.status === "error").toBeTruthy();
    expect((r2 as { status: "error"; error: string }).error).toBe("err");

    let r3 = Result.success(true);
    expect(r3.status === "success").toBeTruthy();
    expect((r3 as { status: "success"; value: boolean }).value).toBeTruthy();

    let r4 = Result.success(undefined);
    expect(r4.status === "success").toBeTruthy();
    expect((r4 as { status: "success"; value: undefined }).value).toBeUndefined();
});
