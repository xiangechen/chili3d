// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { Plugin } from "@chili3d/core";
import { REQUIRED_DISCLAIMER } from "./types";

export * from "./dxfParser";
export * from "./extrusion";
export * from "./schema";
export * from "./types";

const SiteModelPlugin: Plugin = {
    guide: [
        {
            name: "DGOC Site Model",
            content: `Shared site model plugin for DGOC Crane Planner. Parses DXF site plans, extrudes 3D buildings, and manages hazards. ${REQUIRED_DISCLAIMER}`,
        },
    ],
    i18nResources: [
        {
            language: "en",
            display: "English",
            translation: {
                "site.model.name": "Site Model",
                "site.model.disclaimer": REQUIRED_DISCLAIMER,
            },
        } as any,
    ],
};

export default SiteModelPlugin;
