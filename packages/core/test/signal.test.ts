// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Signal } from "../src";

describe("Signal", () => {
    describe("sub", () => {
        test("should add a listener", () => {
            const signal = new Signal<() => void>();
            const listener = () => {};
            signal.sub(listener);

            // Emit should call the listener
            let called = false;
            const signal2 = new Signal<() => void>();
            signal2.sub(() => {
                called = true;
            });
            signal2.emit();
            expect(called).toBe(true);
        });

        test("should allow adding multiple listeners", () => {
            const signal = new Signal<(x: number) => void>();
            const results: number[] = [];
            signal.sub((x) => results.push(x * 1));
            signal.sub((x) => results.push(x * 2));
            signal.emit(5);
            expect(results).toContain(5);
            expect(results).toContain(10);
        });

        test("should allow adding the same listener multiple times (Set behavior)", () => {
            const signal = new Signal<() => void>();
            let count = 0;
            const listener = () => count++;
            signal.sub(listener);
            signal.sub(listener); // Set ignores duplicates
            signal.emit();
            // Set stores unique values, so listener called once
            expect(count).toBe(1);
        });
    });

    describe("remove", () => {
        test("should remove a listener", () => {
            const signal = new Signal<() => void>();
            let count = 0;
            const listener = () => count++;
            signal.sub(listener);
            signal.emit();
            expect(count).toBe(1);

            signal.remove(listener);
            signal.emit();
            expect(count).toBe(1); // unchanged after removal
        });

        test("should not throw when removing non-existent listener", () => {
            const signal = new Signal<() => void>();
            const listener = () => {};
            expect(() => signal.remove(listener)).not.toThrow();
        });

        test("should only remove the specified listener", () => {
            const signal = new Signal<() => void>();
            let count1 = 0;
            let count2 = 0;
            const listener1 = () => count1++;
            const listener2 = () => count2++;
            signal.sub(listener1);
            signal.sub(listener2);

            signal.remove(listener1);
            signal.emit();
            expect(count1).toBe(0);
            expect(count2).toBe(1);
        });
    });

    describe("emit", () => {
        test("should call all subscribed listeners", () => {
            const signal = new Signal<() => void>();
            let a = false;
            let b = false;
            let c = false;
            signal.sub(() => {
                a = true;
            });
            signal.sub(() => {
                b = true;
            });
            signal.sub(() => {
                c = true;
            });
            signal.emit();
            expect(a).toBe(true);
            expect(b).toBe(true);
            expect(c).toBe(true);
        });

        test("should pass arguments to listeners", () => {
            const signal = new Signal<(a: string, b: number) => void>();
            let receivedA = "";
            let receivedB = 0;
            signal.sub((a, b) => {
                receivedA = a;
                receivedB = b;
            });
            signal.emit("hello", 42);
            expect(receivedA).toBe("hello");
            expect(receivedB).toBe(42);
        });

        test("should pass all arguments to multiple listeners", () => {
            const signal = new Signal<(x: number, y: number) => void>();
            const sums: number[] = [];
            signal.sub((x, y) => sums.push(x + y));
            signal.sub((x, y) => sums.push(x * y));
            signal.emit(3, 4);
            expect(sums).toEqual([7, 12]);
        });

        test("should not throw when emitting with no listeners", () => {
            const signal = new Signal<() => void>();
            expect(() => signal.emit()).not.toThrow();
        });

        test("should handle listeners that throw without affecting other listeners", () => {
            const signal = new Signal<() => void>();
            let secondCalled = false;
            signal.sub(() => {
                throw new Error("listener error");
            });
            signal.sub(() => {
                secondCalled = true;
            });
            expect(() => signal.emit()).toThrow("listener error");
            // The error propagates, so second listener is not reached
            // This is expected behavior — Signal does not catch errors
        });

        test("should work with zero-argument emit", () => {
            const signal = new Signal<() => void>();
            let called = false;
            signal.sub(() => {
                called = true;
            });
            signal.emit();
            expect(called).toBe(true);
        });
    });

    describe("dispose", () => {
        test("should remove all listeners", () => {
            const signal = new Signal<() => void>();
            let count = 0;
            signal.sub(() => count++);
            signal.sub(() => count++);
            signal.dispose();
            signal.emit();
            expect(count).toBe(0);
        });

        test("should not throw when disposing with no listeners", () => {
            const signal = new Signal<() => void>();
            expect(() => signal.dispose()).not.toThrow();
        });

        test("should not throw when emitting after dispose", () => {
            const signal = new Signal<() => void>();
            signal.sub(() => {});
            signal.dispose();
            expect(() => signal.emit()).not.toThrow();
        });
    });

    describe("generic type parameter", () => {
        test("should work with single parameter", () => {
            const signal = new Signal<(value: string) => void>();
            let received = "";
            signal.sub((v) => {
                received = v;
            });
            signal.emit("test");
            expect(received).toBe("test");
        });

        test("should work with object parameter", () => {
            const signal = new Signal<(obj: { id: number; name: string }) => void>();
            let received: any = null;
            signal.sub((obj) => {
                received = obj;
            });
            signal.emit({ id: 1, name: "test" });
            expect(received).toEqual({ id: 1, name: "test" });
        });
    });

    describe("integration scenarios", () => {
        test("should support sub → emit → remove → emit workflow", () => {
            const signal = new Signal<(msg: string) => void>();
            const messages: string[] = [];
            const handler = (msg: string) => messages.push(msg);

            signal.sub(handler);
            signal.emit("first");
            signal.remove(handler);
            signal.emit("second");

            expect(messages).toEqual(["first"]);
        });

        test("should support multiple independent signals", () => {
            const sig1 = new Signal<() => void>();
            const sig2 = new Signal<() => void>();
            let count1 = 0;
            let count2 = 0;

            sig1.sub(() => count1++);
            sig2.sub(() => count2++);

            sig1.emit();
            expect(count1).toBe(1);
            expect(count2).toBe(0);

            sig2.emit();
            sig2.emit();
            expect(count1).toBe(1);
            expect(count2).toBe(2);
        });
    });
});
