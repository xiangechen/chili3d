// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { Tool } from "../llm/types";
import { buildSkillTool } from "../skills";
import { buildCapabilityTools } from "./capabilityEngine";
import { buildFileTools } from "./fileTools";
import { buildNodeTools } from "./nodeTools";
import { buildParametricTools } from "./parametricTools";
import { buildPropertyTools } from "./propertyTools";
import { buildReadTools } from "./readTools";
import { buildRibbonTools } from "./ribbonTools";
import { buildSelectionTools } from "./selectionTools";
import { buildVariableTools } from "./variableTools";
import { buildViewTools } from "./viewTools";

export function buildTools(): Tool[] {
    return [
        ...buildReadTools(),
        ...buildRibbonTools(),
        ...buildNodeTools(),
        ...buildPropertyTools(),
        ...buildViewTools(),
        ...buildSelectionTools(),
        ...buildFileTools(),
        ...buildCapabilityTools(),
        buildSkillTool(),
        // Everything below is appended, never inserted: the API matches the cached prompt
        // prefix in the order tools -> system -> messages, so putting a tool anywhere but
        // the end invalidates the tools prefix of every conversation already in flight.
        ...buildParametricTools(),
        ...buildVariableTools(),
    ];
}
