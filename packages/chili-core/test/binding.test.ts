// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Observable, PathBinding } from "../src";

class TestObjectValue extends Observable {
    get value(): string | undefined {
        return this.getPrivateValue("value", "value");
    }
    set value(value: string | undefined) {
        this.setProperty("value", value);
    }
}

class TestObjectA extends Observable {
    get propA(): TestObjectValue | undefined {
        return this.getPrivateValue("propA");
    }
    set propA(value: TestObjectValue | undefined) {
        this.setProperty("propA", value);
    }
}

class TestObjectB extends Observable {
    get propB(): TestObjectA | undefined {
        return this.getPrivateValue("propB");
    }
    set propB(value: TestObjectA | undefined) {
        this.setProperty("propB", value);
    }

    get propC(): string | undefined {
        return this.getPrivateValue("propC", "propC");
    }
    set propC(value: string | undefined) {
        this.setProperty("propC", value);
    }
}

describe("PathBinding test", () => {
    test("test PathBinding1", () => {
        let obj2 = new TestObjectB();
        const binding = new PathBinding(obj2, "propB.propA.value");
        let target = { value: "v1" };
        binding.setBinding(target, "value");
        expect(target.value).toBe("v1");
        obj2.propB = new TestObjectA();
        expect(target.value).toBe("v1");

        let obj3 = new TestObjectValue();
        obj2.propB.propA = obj3;
        expect(target.value).toBe("value");
        obj2.propB.propA.value = "value2";
        expect(target.value).toBe("value2");

        obj2.propB = undefined;
        expect(target.value).toBe("value2");
        obj3.value = "value3";
        expect(target.value).toBe("value2");

        obj2.propB = new TestObjectA();
        expect(target.value).toBe("value2");
        obj2.propB.propA = new TestObjectValue();
        expect(target.value).toBe("value");
        obj2.propB.propA = obj3;
        expect(target.value).toBe("value3");

        obj2.propB = undefined;
        expect(target.value).toBe("value3");
        obj3.value = "value";
        expect(target.value).toBe("value3");

        obj2.propB = new TestObjectA();
        obj2.propB.propA = obj3;
        expect(target.value).toBe("value");
        obj3.value = "value4";
        expect(target.value).toBe("value4");
    });

    test("test PathBinding2", () => {
        let obj = new TestObjectB();
        obj.propB = new TestObjectA();
        obj.propB.propA = new TestObjectValue();
        let target = { value1: "v1", value2: "v2" };
        const binding1 = new PathBinding(obj, "propB.propA.value");
        binding1.setBinding(target, "value1");
        expect(target.value1).toBe("value");

        const binding2 = new PathBinding(obj, "propC");
        binding2.setBinding(target, "value2");
        expect(target.value2).toBe("propC");
        obj.propC = "propC2";
        expect(target.value2).toBe("propC2");
    });
});
