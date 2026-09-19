// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { queryApiDoc } from "../tools/capabilities.generated";
import type { Skill } from "./types";

/** The query half of the generated catalog — see modelingApi for the creation half. */
export const shapeQuery: Skill = {
    name: "shape-query",
    description:
        "Query and measure shapes, curves and surfaces: length/area/volume, bounding boxes, distances, parameter evaluation, sub-shape refs",
    content: queryApiDoc,
};
