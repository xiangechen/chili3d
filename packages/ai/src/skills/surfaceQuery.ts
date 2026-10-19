// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { surfaceQueryApiDoc } from "../tools/capabilities.generated";
import type { Skill } from "./types";

/**
 * The surface half of the generated query catalog. See curve-query for why the family documents
 * are separate skills rather than one load.
 */
export const surfaceQuery: Skill = {
    name: "surface-query",
    description:
        "Surfaces behind faces: surface type, bounds, normals, parameter evaluation, projection, periodicity and the elementary/swept/revolution subtype members",
    content: surfaceQueryApiDoc,
};
