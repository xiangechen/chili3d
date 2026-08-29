// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { RibbonTabKeys, RibbonTabProfile } from "@chili3d/core";

/** Extras may request insertion before an existing tab instead of appending. */
type RibbonProfileExtra = RibbonTabProfile & { before?: RibbonTabKeys };

/**
 * Ribbon contributions of the sketch module, applied by `AppBuilder.useParametric`.
 * Without it no sketch command is registered, so these stay out of the ribbon.
 */
export const SketchRibbonProfiles: RibbonProfileExtra[] = [
    {
        tabName: "ribbon.tab.parametric",
        before: "ribbon.tab.manager",
        groups: [
            {
                groupName: "ribbon.group.sketch",
                items: ["sketch.create", "sketch.enter"],
            },
        ],
    },
    {
        tabName: "ribbon.tab.sketch",
        contextual: true,
        groups: [
            {
                groupName: "ribbon.group.sketch",
                items: ["sketch.exit"],
            },
            {
                groupName: "ribbon.group.draw",
                items: ["sketch.line", "sketch.circle"],
            },
            {
                groupName: "ribbon.group.constraint",
                items: ["constraint.coincident", "constraint.horizontal", "constraint.vertical"],
            },
            {
                groupName: "ribbon.group.dimension",
                items: ["dimension.distance", "dimension.radius"],
            },
        ],
    },
];
