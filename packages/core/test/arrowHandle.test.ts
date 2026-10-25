// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { describe, expect, test } from "@rstest/core";
import { nearestHandle } from "../src";

describe("nearestHandle", () => {
    const handles = [{ role: "first" as const }, { role: "second" as const }];

    test("ties go to the first handle in the list", () => {
        // two handles sharing an anchor sit at distance 0 together; the first is the one the
        // tool draws first, so the choice must not depend on iteration order drifting
        expect(nearestHandle(handles, () => 0)).toBe("first");
    });

    test("a strictly nearer handle wins", () => {
        expect(nearestHandle(handles, (handle) => (handle.role === "first" ? 8 : 2))).toBe("second");
    });

    test("the tolerance edge still counts, one pixel past it does not", () => {
        expect(nearestHandle(handles, () => 10)).toBe("first");
        expect(nearestHandle(handles, () => 10.001)).toBeUndefined();
    });
});
