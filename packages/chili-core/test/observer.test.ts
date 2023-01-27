// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import "reflect-metadata";
import { Observable } from "../src";

class TestClass extends Observable {
    private _test: number = 1;
    get test() {
        return this._test;
    }
    set test(value: number) {
        this.setProperty("test", value);
    }
}

test("test observer", () => {
    let t = new TestClass();
    t.onPropertyChanged((s, p, o, n) => {
        expect(p).toBe("test");
        expect(n).toBe(2);
    });
    t.test = 2;
});
