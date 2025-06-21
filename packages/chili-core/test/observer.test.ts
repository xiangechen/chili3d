// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { DeepObserver, IPropertyChanged, Observable } from "../src";

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

test("test observer", () => {
    let t = new TestClassA();
    t.onPropertyChanged((p, s, o) => {
        expect(p).toBe("propA");
        expect(s[p]).toBe(2);
    });
    t.propA = 2;
});

test("deep observer", () => {
    let c = new TestClassC();
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

    let b = new TestClassB();
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
