// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { capabilitiesSource } from "../tools/capabilities.generated";
import type { Skill } from "./types";

/**
 * The creation-op counterpart of shape-query, and by far the most-loaded skill — the
 * catalog is ~5k characters, which is a third of the resident prompt, so it lives here
 * and is pulled on demand instead.
 */
export const modelingApi: Skill = {
    name: "modeling-api",
    description:
        "The IShapeFactory catalog behind run_program creation ops: every method's signature, parameter kinds and return type — load it before composing run_program ops",
    content: capabilitiesSource,
};
