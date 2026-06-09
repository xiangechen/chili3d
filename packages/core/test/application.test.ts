// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { IApplication } from "../src";
import { getCurrentApplication, setCurrentApplication } from "../src";

const createMockApplication = (): IApplication => ({}) as any;

describe("getCurrentApplication", () => {
    test("should return undefined when no application is set", () => {
        expect(() => getCurrentApplication()).toThrowError();
    });

    test("should return the currently set application", () => {
        const mockApp = createMockApplication();
        setCurrentApplication(mockApp);

        const firstCall = getCurrentApplication();
        const secondCall = getCurrentApplication();

        expect(firstCall).toBe(secondCall);
        expect(firstCall).toBe(mockApp);
    });
});
