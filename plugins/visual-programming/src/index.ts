// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { CommandKeys, Plugin, RibbonGroupKeys, RibbonTabKeys } from "@chili3d/core";
import { OpenVisualProgrammingEditorCommand } from "./command";
import { cn } from "./i18n/cn";
import { en } from "./i18n/en";

const VisualProgrammingPlugin: Plugin = {
    commands: [OpenVisualProgrammingEditorCommand],
    ribbons: [
        {
            tabName: "ribbon.tab.plugin" as RibbonTabKeys,
            groups: [
                {
                    groupName: "ribbon.group.plugin" as RibbonGroupKeys,
                    items: ["vp.open" as CommandKeys],
                },
            ],
        },
    ],
    i18nResources: [en, cn],
};

export default VisualProgrammingPlugin;
