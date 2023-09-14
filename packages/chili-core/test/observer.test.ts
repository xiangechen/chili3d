// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

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
    t.onPropertyChanged((p, s, o) => {
        expect(p).toBe("test");
        expect(s[p]).toBe(2);
    });
    t.test = 2;
});
