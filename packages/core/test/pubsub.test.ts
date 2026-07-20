// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { PubSub } from "../src";

describe("PubSub class", () => {
    let pubsub: PubSub;

    beforeEach(() => {
        pubsub = new PubSub();
    });

    afterEach(() => {
        pubsub.dispose();
    });

    describe("static default", () => {
        test("should have a default instance", () => {
            expect(PubSub.default).toBeDefined();
            expect(PubSub.default).toBeInstanceOf(PubSub);
        });
    });

    describe("sub and pub", () => {
        test("should subscribe to an event", () => {
            let called = false;
            pubsub.sub("displayError" as any, () => {
                called = true;
            });
            pubsub.pub("displayError" as any, "error message");
            expect(called).toBe(true);
        });

        test("should pass arguments to subscriber", () => {
            let receivedArgs: any[] = [];
            pubsub.sub("displayError" as any, (...args: any[]) => {
                receivedArgs = args;
            });
            pubsub.pub("displayError" as any, "test error", { detail: "info" });
            expect(receivedArgs).toEqual(["test error", { detail: "info" }]);
        });

        test("should call multiple subscribers", () => {
            let callCount = 0;
            pubsub.sub("displayError" as any, () => callCount++);
            pubsub.sub("displayError" as any, () => callCount++);
            pubsub.sub("displayError" as any, () => callCount++);
            pubsub.pub("displayError" as any, "error");
            expect(callCount).toBe(3);
        });

        test("should not call subscriber for different event", () => {
            let called = false;
            pubsub.sub("displayError" as any, () => {
                called = true;
            });
            pubsub.pub("showToast" as any, "test" as any);
            expect(called).toBe(false);
        });

        test("should handle events with no subscribers", () => {
            expect(() => {
                pubsub.pub("displayError" as any, "error");
            }).not.toThrow();
        });
    });

    describe("remove", () => {
        test("should remove a specific subscriber", () => {
            let callCount = 0;
            const callback = () => callCount++;
            const callback2 = () => callCount++;
            pubsub.sub("displayError" as any, callback);
            pubsub.sub("displayError" as any, callback2);

            pubsub.remove("displayError" as any, callback);
            pubsub.pub("displayError" as any, "error");

            expect(callCount).toBe(1);
        });

        test("should not affect other subscribers", () => {
            let callCount1 = 0;
            let callCount2 = 0;
            const callback1 = () => callCount1++;
            const callback2 = () => callCount2++;

            pubsub.sub("displayError" as any, callback1);
            pubsub.sub("displayError" as any, callback2);

            pubsub.remove("displayError" as any, callback1);
            pubsub.pub("displayError" as any, "error");

            expect(callCount1).toBe(0);
            expect(callCount2).toBe(1);
        });
    });

    describe("removeAll", () => {
        test("should remove all subscribers for an event", () => {
            let callCount = 0;
            pubsub.sub("displayError" as any, () => callCount++);
            pubsub.sub("displayError" as any, () => callCount++);
            pubsub.sub("displayError" as any, () => callCount++);

            pubsub.removeAll("displayError" as any);
            pubsub.pub("displayError" as any, "error");

            expect(callCount).toBe(0);
        });

        test("should not affect other events", () => {
            let errorCount = 0;
            let toastCount = 0;
            pubsub.sub("displayError" as any, () => errorCount++);
            pubsub.sub("displayError" as any, () => errorCount++);
            pubsub.sub("showToast" as any, () => toastCount++);

            pubsub.removeAll("displayError" as any);
            pubsub.pub("displayError" as any, "error");
            pubsub.pub("showToast" as any, "toast" as any);

            expect(errorCount).toBe(0);
            expect(toastCount).toBe(1);
        });
    });

    describe("dispose", () => {
        test("should clear all events", () => {
            let callCount = 0;
            pubsub.sub("displayError" as any, () => callCount++);
            pubsub.sub("showToast" as any, () => callCount++);

            pubsub.dispose();
            pubsub.pub("displayError" as any, "error");
            pubsub.pub("showToast" as any, "toast" as any);

            expect(callCount).toBe(0);
        });

        test("not allow creating new subscriptions after dispose", () => {
            let callCount = 0;
            pubsub.dispose();

            pubsub.sub("displayError" as any, () => callCount++);
            pubsub.pub("displayError" as any, "error");

            expect(callCount).toBe(0);
        });
    });

    describe("multiple events", () => {
        test("should handle multiple different events", () => {
            let errorCalls = 0;
            let toastCalls = 0;

            pubsub.sub("displayError" as any, () => errorCalls++);
            pubsub.sub("showToast" as any, () => toastCalls++);

            pubsub.pub("displayError" as any, "error");
            pubsub.pub("showToast" as any, "toast" as any);
            pubsub.pub("displayError" as any, "another error");
            pubsub.pub("showToast" as any, "another toast" as any);

            expect(errorCalls).toBe(2);
            expect(toastCalls).toBe(2);
        });

        test("should handle events with no arguments", () => {
            let called = false;
            pubsub.sub("clearFloatTip" as any, () => {
                called = true;
            });
            pubsub.pub("clearFloatTip" as any);
            expect(called).toBe(true);
        });
    });

    describe("disposed state edge cases", () => {
        test("should not throw when removing from disposed pubsub", () => {
            const callback = () => {};
            pubsub.sub("displayError" as any, callback);
            pubsub.dispose();
            expect(() => pubsub.remove("displayError" as any, callback)).not.toThrow();
        });

        test("should not throw when calling removeAll on disposed pubsub", () => {
            const callback = () => {};
            pubsub.sub("displayError" as any, callback);
            pubsub.dispose();
            expect(() => pubsub.removeAll("displayError" as any)).not.toThrow();
        });

        test("should not throw when publishing on disposed pubsub", () => {
            const callback = () => {};
            pubsub.sub("displayError" as any, callback);
            pubsub.dispose();
            expect(() => pubsub.pub("displayError" as any, "error")).not.toThrow();
        });
    });

    describe("remove edge cases", () => {
        test("should not throw when removing non-existent callback", () => {
            const cb1 = () => {};
            pubsub.sub("displayError" as any, cb1);
            expect(() => pubsub.remove("displayError" as any, () => {})).not.toThrow();
        });

        test("should not throw when removing from event with no subscribers", () => {
            expect(() => pubsub.remove("displayError" as any, () => {})).not.toThrow();
        });

        test("should not throw when removing callback from wrong event", () => {
            const callback = () => {};
            pubsub.sub("displayError" as any, callback);
            expect(() => pubsub.remove("showToast" as any, callback)).not.toThrow();
        });
    });

    describe("removeAll edge cases", () => {
        test("should not throw on event with no subscribers", () => {
            expect(() => pubsub.removeAll("displayError" as any)).not.toThrow();
        });

        test("should not throw on same event twice", () => {
            pubsub.removeAll("displayError" as any);
            expect(() => pubsub.removeAll("displayError" as any)).not.toThrow();
        });
    });

    describe("duplicate subscriptions", () => {
        test("same callback subscribed twice calls once (Set dedup)", () => {
            let callCount = 0;
            const cb = () => callCount++;
            pubsub.sub("displayError" as any, cb);
            pubsub.sub("displayError" as any, cb);
            pubsub.pub("displayError" as any, "error");
            expect(callCount).toBe(1);
        });

        test("removing callback removes all Set entries", () => {
            let callCount = 0;
            const cb = () => callCount++;
            pubsub.sub("displayError" as any, cb);
            pubsub.sub("displayError" as any, cb);
            pubsub.remove("displayError" as any, cb);
            pubsub.pub("displayError" as any, "error");
            expect(callCount).toBe(0);
        });
    });

    describe("default instance singleton", () => {
        test("should be the same reference", () => {
            expect(PubSub.default).toBe(PubSub.default);
        });

        test("should be usable independently", () => {
            let called = false;
            PubSub.default.sub("displayError" as any, () => {
                called = true;
            });
            PubSub.default.pub("displayError" as any, "test");
            PubSub.default.removeAll("displayError" as any);
            expect(called).toBe(true);
        });
    });
});
