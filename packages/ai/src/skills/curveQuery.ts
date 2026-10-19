// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { curveQueryApiDoc } from "../tools/capabilities.generated";
import type { Skill } from "./types";

/**
 * The curve half of the generated query catalog. Split from shape-query because the combined
 * document is ~19k characters and most turns need exactly one family; loading the other two is
 * what the model pays for a question it did not ask.
 */
export const curveQuery: Skill = {
    name: "curve-query",
    description:
        "Curves behind edges: curve type, length, endpoints and tangents, parameter evaluation, continuity, trim/reverse/offset, and the conic and spline subtype members",
    content: curveQueryApiDoc,
};
