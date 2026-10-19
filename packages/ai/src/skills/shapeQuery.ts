// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { queryApiDoc } from "../tools/capabilities.generated";
import type { Skill } from "./types";

/**
 * The topology half of the generated query catalog — see modelingApi for the creation half, and
 * curve-query / surface-query for the geometry behind edges and faces. Kept to one family because
 * the combined document is ~19k characters, most of which a given turn does not need.
 */
export const shapeQuery: Skill = {
    name: "shape-query",
    description:
        "Solids, faces, edges, wires and topology: volume/area/bounding box, distances, findSubShapes, containsPoint, sub-shape refs — start here for measurements on a body",
    content: queryApiDoc,
};
