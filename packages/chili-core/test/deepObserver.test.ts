// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { DeepObserver, Observable } from "../src";

class TestObservableA extends Observable {
    get value() {
        return this.getPrivateValue("value", 0);
    }
    set value(v: number) {
        this.setProperty("value", v);
    }
}

class TestObservableB extends Observable {
    private _nested: TestObservableA | undefined = new TestObservableA();

    get nested() {
        return this._nested;
    }
    set nested(v: TestObservableA | undefined) {
        this.setProperty("nested" as keyof this, v as any);
    }

    get name() {
        return this.getPrivateValue("name", "test");
    }
    set name(v: string) {
        this.setProperty("name", v);
    }
}

describe("DeepObserver", () => {
    describe("getPathValue", () => {
        test("should get simple property value", () => {
            const obj = new TestObservableA();
            obj.value = 42;
            const result = DeepObserver.getPathValue(obj, "value");
            expect(result.isOk).toBe(true);
            expect(result.value).toBe(42);
        });

        test("should get nested property value", () => {
            const obj = new TestObservableB();
            obj.nested!.value = 100;
            const result = DeepObserver.getPathValue(obj, "nested.value");
            expect(result.isOk).toBe(true);
            expect(result.value).toBe(100);
        });

        test("should return error for invalid path", () => {
            const obj = new TestObservableA();
            const result = DeepObserver.getPathValue(obj, "nonexistent.path");
            expect(result.isOk).toBe(false);
        });
    });

    describe("addDeepPropertyChangedHandler", () => {
        test("should notify on direct property change", () => {
            const obj = new TestObservableA();
            let changedPath: string | undefined;
            let oldValue: any;

            DeepObserver.addDeepPropertyChangedHandler(obj, (path, source, old) => {
                changedPath = path;
                oldValue = old;
            });

            obj.value = 10;
            expect(changedPath).toBe("value");
            expect(oldValue).toBe(0);
        });

        test("should notify on nested property change", () => {
            const obj = new TestObservableB();
            let changedPath: string | undefined;

            DeepObserver.addDeepPropertyChangedHandler(obj, (path) => {
                changedPath = path;
            });

            obj.nested!.value = 50;
            expect(changedPath).toBe("nested.value");
        });

        test("should track new nested objects", () => {
            const obj = new TestObservableB();
            let changedPath: string | undefined;

            DeepObserver.addDeepPropertyChangedHandler(obj, (path) => {
                changedPath = path;
            });

            const newNested = new TestObservableA();
            obj.nested = newNested;
            expect(changedPath).toBe("nested");

            newNested.value = 200;
            expect(changedPath).toBe("nested.value");
        });

        test("should handle undefined nested values", () => {
            const obj = new TestObservableB();
            const paths: string[] = [];

            DeepObserver.addDeepPropertyChangedHandler(obj, (path) => {
                paths.push(path);
            });

            obj.nested = undefined;
            expect(paths).toContain("nested");
        });
    });

    describe("removeDeepPropertyChangedHandler", () => {
        test("should stop notifications after removal", () => {
            const obj = new TestObservableA();
            let callCount = 0;

            const handler = () => {
                callCount++;
            };

            DeepObserver.addDeepPropertyChangedHandler(obj, handler);
            obj.value = 1;
            expect(callCount).toBe(1);

            DeepObserver.removeDeepPropertyChangedHandler(obj, handler);
            obj.value = 2;
            expect(callCount).toBe(1);
        });

        test("should stop nested notifications after removal", () => {
            const obj = new TestObservableB();
            let callCount = 0;

            const handler = () => {
                callCount++;
            };

            DeepObserver.addDeepPropertyChangedHandler(obj, handler);
            obj.nested!.value = 1;
            expect(callCount).toBe(1);

            DeepObserver.removeDeepPropertyChangedHandler(obj, handler);
            obj.nested!.value = 2;
            expect(callCount).toBe(1);
        });

        test("should handle removing non-existent handler", () => {
            const obj = new TestObservableA();
            const handler = () => {};

            expect(() => {
                DeepObserver.removeDeepPropertyChangedHandler(obj, handler);
            }).not.toThrow();
        });
    });

    describe("multiple handlers", () => {
        test("should support multiple handlers on same object", () => {
            const obj = new TestObservableA();
            let count1 = 0;
            let count2 = 0;

            const handler1 = () => count1++;
            const handler2 = () => count2++;

            DeepObserver.addDeepPropertyChangedHandler(obj, handler1);
            DeepObserver.addDeepPropertyChangedHandler(obj, handler2);

            obj.value = 10;
            expect(count1).toBe(1);
            expect(count2).toBe(1);
        });

        test("should allow removing one handler without affecting others", () => {
            const obj = new TestObservableA();
            let count1 = 0;
            let count2 = 0;

            const handler1 = () => count1++;
            const handler2 = () => count2++;

            DeepObserver.addDeepPropertyChangedHandler(obj, handler1);
            DeepObserver.addDeepPropertyChangedHandler(obj, handler2);

            DeepObserver.removeDeepPropertyChangedHandler(obj, handler1);
            obj.value = 10;

            expect(count1).toBe(0);
            expect(count2).toBe(1);
        });
    });
});
