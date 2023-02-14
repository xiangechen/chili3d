// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import "reflect-metadata";

import { Container, Token } from "../src";

test("test ioc", () => {
    class TestClass {
        constructor() {}
    }
    let container = new Container();
    container.register(new Token("t1"), TestClass);
    container.registerSingleton(new Token("t2"), TestClass);
    let t11 = container.resolve(new Token("t1"));
    let t12 = container.resolve(new Token("t1"));
    expect(t11 === t12).toBeFalsy();

    let t21 = container.resolve(new Token("t2"));
    let t22 = container.resolve(new Token("t2"));
    expect(t21 === t22).toBeTruthy();
});
