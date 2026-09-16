// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { rs } from "@rstest/core";
import { DeepObserver, type IPropertyChanged, Observable } from "../src";

afterEach(() => {
    rs.restoreAllMocks();
});

class TestClassA extends Observable {
    get propA() {
        return this.getPrivateValue("propA", 1);
    }
    set propA(value: number) {
        this.setProperty("propA", value);
    }
}

class TestClassB extends Observable {
    get propBV() {
        return this.getPrivateValue("propBV", 1);
    }
    set propBV(value: number) {
        this.setProperty("propBV", value);
    }

    get propB() {
        return this.getPrivateValue("propB", new TestClassA());
    }
    set propB(value: TestClassA | undefined) {
        this.setProperty("propB", value);
    }
}

class TestClassC extends Observable {
    get propCV() {
        return this.getPrivateValue("propCV", 1);
    }
    set propCV(value: number) {
        this.setProperty("propCV", value);
    }

    get propC() {
        return this.getPrivateValue("propC", new TestClassB());
    }
    set propC(value: TestClassB | undefined) {
        this.setProperty("propC", value);
    }
}

test("should notify when a property changes", () => {
    const t = new TestClassA();
    let callCount = 0;
    let changedProperty: string | undefined;
    let changedSource: IPropertyChanged | undefined;
    t.onPropertyChanged((p, s, o) => {
        callCount++;
        changedProperty = p;
        changedSource = s;
    });
    t.propA = 2;
    expect(callCount).toBe(1);
    expect(changedProperty).toBe("propA");
    expect((changedSource as any)[changedProperty!]).toBe(2);
});

test("deep observer", () => {
    const c = new TestClassC();
    let targetProperty: string | undefined;
    const onPropertyChanged = (p: string, s: IPropertyChanged, o: any) => {
        targetProperty = p;
    };
    const a = new TestClassA();
    DeepObserver.addDeepPropertyChangedHandler(c, onPropertyChanged);
    c.propC!.propB = a;
    expect(targetProperty).toBe("propC.propB");
    a.propA = 2;
    expect(targetProperty).toBe("propC.propB.propA");

    c.propC = undefined;
    expect(targetProperty).toBe("propC");
    a.propA = 3;
    expect(targetProperty).toBe("propC");

    const b = new TestClassB();
    c.propC = b;
    expect(targetProperty).toBe("propC");
    b.propB = a;
    expect(targetProperty).toBe("propC.propB");
    a.propA = 2;
    expect(targetProperty).toBe("propC.propB.propA");

    b.propB = undefined;
    expect(targetProperty).toBe("propC.propB");
    a.propA = 3;
    expect(targetProperty).toBe("propC.propB");

    b.propB = a;
    expect(targetProperty).toBe("propC.propB");
    a.propA = 2;
    expect(targetProperty).toBe("propC.propB.propA");
});

describe("observer exception isolation", () => {
    test("a throwing observer does not skip later observers of the same property", () => {
        const consoleError = rs.spyOn(console, "error").mockImplementation(() => {});
        const error = new Error("observer exploded");
        const t = new TestClassA();
        t.onPropertyChanged(() => {
            throw error;
        });
        const later = rs.fn((_property: string, _source: unknown, _oldValue: unknown) => {});
        t.onPropertyChanged(later);

        t.propA = 2;

        expect(later).toHaveBeenCalledTimes(1);
        expect(later).toHaveBeenCalledWith("propA", t, 1);
        expect(consoleError).toHaveBeenCalledWith('TestClassA: an observer of property "propA" threw', error);
    });

    test("the set completes when an observer throws", () => {
        const consoleError = rs.spyOn(console, "error").mockImplementation(() => {});
        const t = new TestClassA();
        t.onPropertyChanged(() => {
            throw new Error("observer exploded");
        });

        let reachedAfterSet = false;
        t.propA = 2;
        reachedAfterSet = true;

        expect(reachedAfterSet).toBe(true);
        expect(t.propA).toBe(2);
        expect(consoleError).toHaveBeenCalledTimes(1);
    });

    test("a throwing observer does not affect later property changes", () => {
        const consoleError = rs.spyOn(console, "error").mockImplementation(() => {});
        const t = new TestClassA();
        const observed: string[] = [];
        t.onPropertyChanged(() => {
            throw new Error("observer exploded");
        });
        t.onPropertyChanged((property) => observed.push(property));

        t.propA = 2;
        t.propA = 3;

        expect(observed).toEqual(["propA", "propA"]);
        expect(t.propA).toBe(3);
        expect(consoleError).toHaveBeenCalledTimes(2);
    });
});
