// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type Deletable, gc, type IDisposable, isDeletable } from "../src";

describe("isDeletable", () => {
    test("should return true for object with delete method", () => {
        const obj = {
            delete() {},
        };
        expect(isDeletable(obj)).toBe(true);
    });

    test("should return false for null", () => {
        expect(isDeletable(null)).toBe(false);
    });

    test("should return false for undefined", () => {
        expect(isDeletable(undefined)).toBe(false);
    });

    test("should return false for object without delete method", () => {
        const obj = { foo: "bar" };
        expect(isDeletable(obj)).toBe(false);
    });

    test("should return false for object with delete property that is not a function", () => {
        const obj = { delete: "not a function" };
        expect(isDeletable(obj)).toBe(false);
    });

    test("should return false for object with delete method that has parameters", () => {
        const obj = {
            delete(arg: string) {},
        };
        expect(isDeletable(obj)).toBe(false);
    });
});

describe("gc function", () => {
    test("should call dispose on IDisposable resources", () => {
        let disposed = false;
        const resource: IDisposable = {
            dispose() {
                disposed = true;
            },
        };

        gc((collect) => {
            collect(resource);
            return "result";
        });

        expect(disposed).toBe(true);
    });

    test("should call delete on Deletable resources", () => {
        let deleted = false;
        const resource: Deletable = {
            delete() {
                deleted = true;
            },
        };

        gc((collect) => {
            collect(resource);
            return "result";
        });

        expect(deleted).toBe(true);
    });

    test("should return the result of the action", () => {
        const result = gc((collect) => {
            return "test result";
        });

        expect(result).toBe("test result");
    });

    test("should clean up resources even if action throws", () => {
        let disposed = false;
        const resource: IDisposable = {
            dispose() {
                disposed = true;
            },
        };

        expect(() => {
            gc((collect) => {
                collect(resource);
                throw new Error("test error");
            });
        }).toThrow("test error");

        expect(disposed).toBe(true);
    });

    test("should clean up multiple resources", () => {
        let disposeCount = 0;
        const resources: IDisposable[] = Array.from({ length: 5 }, () => ({
            dispose() {
                disposeCount++;
            },
        }));

        gc((collect) => {
            resources.forEach((r) => collect(r));
            return "result";
        });

        expect(disposeCount).toBe(5);
    });

    test("should prioritize Deletable over IDisposable when resource implements both", () => {
        let deleted = false;
        let disposed = false;

        const resource = {
            delete() {
                deleted = true;
            },
            dispose() {
                disposed = true;
            },
        };

        gc((collect) => {
            collect(resource as Deletable & IDisposable);
            return "result";
        });

        expect(deleted).toBe(true);
        expect(disposed).toBe(false);
    });
});
