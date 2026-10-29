// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { Plugin } from "@chili3d/core";
import { CreateTowerCraneCommand } from "./commands/createTowerCrane";
import { TowerCraneBodyNode } from "./body/towerCraneBody";
import { MCT88 } from "./catalogue";
import { metresToMillimetres } from "./units";

const TowerPlannerPlugin: Plugin = {
    commands: [CreateTowerCraneCommand],
    ribbons: [
        {
            tabName: "ribbon.tab.manager",
            groups: [
                {
                    groupName: "ribbon.group.other",
                    items: ["towerplanner.createCrane" as any],
                },
            ],
        },
    ],
    guide: [
        {
            name: "Tower Crane Planner (T4)",
            content: "Parametric tower crane solid from catalogue data. Use 'Create Tower Crane' in Manager tab to add a crane. Jib length is parametric - change jibLengthM on TowerCraneBodyNode to regenerate geometry. Planning aid, not a certified lift plan.",
        },
    ],
    i18nResources: [
        {
            language: "en",
            display: "English",
            translation: {
                "towerplanner.createCrane": "Create Tower Crane",
                "towerplanner.createCrane.help": "Create a parametric tower crane from MCT 88 catalogue data. Planning aid, not a certified lift plan.",
                "towerplanner.craneCreated": "Tower crane created (MCT 88, 30 m jib). INDICATIVE dimensions: mast height 50m, jib cross-section 2.0x2.5m. Planning aid, not a certified lift plan.",
                "body.towerCrane": "Tower Crane",
                "towerplanner.jibLength": "Jib Length",
            },
        } as any,
    ],
};

export default TowerPlannerPlugin;

// Re-export for programmatic use
export { TowerCraneBodyNode, MCT88, metresToMillimetres };