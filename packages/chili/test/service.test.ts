// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import "reflect-metadata";
import { Container, Token } from "chili-core";

class TestClass {
    constructor() {}
}

test("test service", () => {
    let collection = Container.default;
    let t1 = new Token("t1");
    let t2 = new Token("t2");
    collection.register(t1, TestClass);
    collection.registerSingleton(t2, TestClass);
    let c11 = collection.resolve(t1);
    let c12 = collection.resolve(t1);
    expect(c11 === c12).toBeFalsy();
    let c21 = collection.resolve(t2);
    let c22 = collection.resolve(t2);
    expect(c21 === c22).toBeTruthy();
});
