// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IApplication } from "../src";
import { getCurrentApplication, setCurrentApplication } from "../src";

const createMockApplication = (): IApplication => ({}) as any;

describe("Application", () => {
    beforeEach(() => {
        // Reset the current application before each test
        setCurrentApplication(undefined as any);
    });

    describe("getCurrentApplication", () => {
        test("should return undefined when no application is set", () => {
            const currentApp = getCurrentApplication();
            expect(currentApp).toBeUndefined();
        });

        test("should return the currently set application", () => {
            const mockApp = createMockApplication();
            setCurrentApplication(mockApp);

            const currentApp = getCurrentApplication();
            expect(currentApp).toBe(mockApp);
        });

        test("should return the same instance on multiple calls", () => {
            const mockApp = createMockApplication();
            setCurrentApplication(mockApp);

            const firstCall = getCurrentApplication();
            const secondCall = getCurrentApplication();

            expect(firstCall).toBe(secondCall);
            expect(firstCall).toBe(mockApp);
        });
    });

    describe("setCurrentApplication", () => {
        test("should set the current application", () => {
            const mockApp = createMockApplication();

            setCurrentApplication(mockApp);
            const currentApp = getCurrentApplication();

            expect(currentApp).toBe(mockApp);
        });

        test("should allow updating the current application", () => {
            const firstApp = createMockApplication();
            const secondApp = createMockApplication();

            setCurrentApplication(firstApp);
            expect(getCurrentApplication()).toBe(firstApp);

            setCurrentApplication(secondApp);
            expect(getCurrentApplication()).toBe(secondApp);
            expect(getCurrentApplication()).not.toBe(firstApp);
        });

        test("should allow setting to undefined", () => {
            const mockApp = createMockApplication();

            setCurrentApplication(mockApp);
            expect(getCurrentApplication()).toBe(mockApp);

            setCurrentApplication(undefined as any);
            expect(getCurrentApplication()).toBeUndefined();
        });

        test("should allow setting to null", () => {
            const mockApp = createMockApplication();

            setCurrentApplication(mockApp);
            expect(getCurrentApplication()).toBe(mockApp);

            setCurrentApplication(null as any);
            expect(getCurrentApplication()).toBeNull();
        });
    });

    describe("Edge cases", () => {
        test("should handle multiple calls to setCurrentApplication with same value", () => {
            const mockApp = createMockApplication();

            setCurrentApplication(mockApp);
            setCurrentApplication(mockApp);
            setCurrentApplication(mockApp);

            expect(getCurrentApplication()).toBe(mockApp);
        });

        test("should handle rapid switching of applications", () => {
            const app1 = createMockApplication();
            const app2 = createMockApplication();
            const app3 = createMockApplication();

            setCurrentApplication(app1);
            expect(getCurrentApplication()).toBe(app1);

            setCurrentApplication(app2);
            expect(getCurrentApplication()).toBe(app2);

            setCurrentApplication(app3);
            expect(getCurrentApplication()).toBe(app3);

            setCurrentApplication(app1);
            expect(getCurrentApplication()).toBe(app1);
        });
    });
});
