// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { CommandKeys, Locale, Plugin, RibbonGroupKeys, RibbonTabKeys } from "@chili3d/core";
import { ShowCraneCommand } from "./commands/showCrane";
import { KIT } from "./modules/craneModel";

export * from "./clearance/distance";

const MobilePlannerPlugin: Plugin = {
    commands: [ShowCraneCommand],
    ribbons: [
        {
            tabName: "ribbon.tab.plugin" as RibbonTabKeys,
            groups: [
                {
                    groupName: "ribbon.group.plugin" as RibbonGroupKeys,
                    items: ["mobile.crane.show" as CommandKeys],
                },
            ],
        },
    ],
    guide: [
        {
            name: "Mobile Crane Planner",
            content:
                `${KIT.name} load-chart capacity lookup. Source: ${KIT.source.document}, page ${KIT.source.page}; ` +
                `${KIT.source.status}. Planning aid, not a certified lift plan.`,
        },
    ],
    i18nResources: [
        {
            language: "en",
            display: "English",
            translation: {
                "command.mobile.crane.show": "Mobile Crane",
                "mobile.crane.show.description": "Show the mobile crane source and planning disclaimer",
                "mobile.crane.loaded": `${KIT.name} loaded. Planning aid, not a certified lift plan.`,
            },
        } as unknown as Locale,
    ],
};

export * from "./modules/craneModel";
export * from "./ui/liftSummary";
export { KIT };
export default MobilePlannerPlugin;
