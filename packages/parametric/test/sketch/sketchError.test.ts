// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { PubSub } from "@chili3d/core";
import { rs } from "@rstest/core";
import { displaySketchError, SketchSolveError } from "../../src/sketch/sketchError";

describe("sketch error reporting", () => {
    test("separates retryable rejections from solve failures", () => {
        const pub = rs.spyOn(PubSub.default, "pub").mockImplementation(() => {});
        try {
            displaySketchError("Pick a different entity");
            expect(pub).toHaveBeenCalledWith("displayValidation", "Pick a different entity");

            displaySketchError(new SketchSolveError("The sketch could not solve"));
            expect(pub).toHaveBeenCalledWith("displayError", "The sketch could not solve");
        } finally {
            pub.mockRestore();
        }
    });
});
