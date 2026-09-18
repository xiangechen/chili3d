// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { Tool } from "../llm/types";
import { buildSkillTool } from "../skills";
import { buildCapabilityTools } from "./capabilityEngine";
import { buildFileTools } from "./fileTools";
import { buildNodeTools } from "./nodeTools";
import { buildPropertyTools } from "./propertyTools";
import { buildReadTools } from "./readTools";
import { buildRibbonTools } from "./ribbonTools";
import { buildSelectionTools } from "./selectionTools";
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
    ];
}
