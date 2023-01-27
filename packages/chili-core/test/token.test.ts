// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import "reflect-metadata";
import { Token } from "../src";

test("test token", () => {
    class TestClass {
        constructor() {}
    }
    Token.set(new Token("t1"))(TestClass);
    expect(Token.get(TestClass)?.token === "t1").toBeTruthy();
});
