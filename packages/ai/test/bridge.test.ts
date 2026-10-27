// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { bridgePortFromUrl, DEFAULT_BRIDGE_PORT } from "../src/bridge";

describe("bridgePortFromUrl", () => {
    test("is undefined when the page was not asked to connect", () => {
        expect(bridgePortFromUrl("")).toBeUndefined();
        expect(bridgePortFromUrl("?plugin=x")).toBeUndefined();
    });

    test("bare ?bridge means the default port", () => {
        expect(bridgePortFromUrl("?bridge")).toBe(DEFAULT_BRIDGE_PORT);
        expect(bridgePortFromUrl("?bridge=")).toBe(DEFAULT_BRIDGE_PORT);
    });

    test("names the port the URL carries", () => {
        expect(bridgePortFromUrl("?bridge=17374")).toBe(17374);
        expect(bridgePortFromUrl("?model=x&bridge=18000")).toBe(18000);
    });

    test.each([
        "?bridge=0",
        "?bridge=65536",
        "?bridge=abc",
        "?bridge=-1",
        "?bridge=1.5",
        "?bridge=0x10",
        "?bridge=1e3",
        "?bridge=+17373",
    ])("ignores %s", (search) => {
        expect(bridgePortFromUrl(search)).toBeUndefined();
    });
});
