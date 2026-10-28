// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { PubSub, type Result } from "@chili3d/core";

/** An internal solve failure; string errors are retryable input or selection rejections. */
export class SketchSolveError extends Error {}

export type SketchOperationResult<T> = Result<T, string | SketchSolveError>;

export function displaySketchError(error: string | SketchSolveError): void {
    if (typeof error === "string") {
        PubSub.default.pub("displayValidation", error);
        return;
    }
    PubSub.default.pub("displayError", error.message);
}
