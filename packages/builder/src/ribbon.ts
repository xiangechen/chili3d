// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { RibbonTabProfile } from "@chili3d/core";

export const DefaultRibbon: RibbonTabProfile[] = [
    {
        tabName: "ribbon.tab.model",
        groups: [
            {
                groupName: "ribbon.group.draw",
                items: [
                    "create.line",
                    {
                        type: "split",
                        items: ["create.rect", "create.circle", "create.ellipse", "create.regularPolygon"],
                    },
                    {
                        type: "split",
                        items: ["create.arc", "create.arc2point", "create.arc3point"],
                    },
                    {
                        type: "split",
                        items: [
                            "create.box",
                            "create.sphere",
                            "create.cylinder",
                            "create.cone",
                            "create.pyramid",
                        ],
                    },
                    "create.extrude",
                    ["create.loft", "create.sweep", "create.revol"],
                ],
                collapsedItems: ["create.point", "create.polygon", "create.bezier", "create.pipe"],
            },
            {
                groupName: "ribbon.group.modify",
                items: [
                    ["modify.move", "modify.rotate", "modify.mirror"],
                    ["modify.array", "modify.trim", "modify.sew"],
                    ["modify.split", "modify.break", "modify.simplifyShape"],
                    ["modify.fillet", "modify.chamfer", "modify.explode"],
                    ["modify.deleteNode", "modify.removeShapes", "modify.removeFeature"]
                ],
                collapsedItems: [
                    "modify.brushAdd", "modify.brushRemove", "modify.brushClear"
                ]
            },
            {
                groupName: "ribbon.group.converter",
                items: ["convert.toWire", ["convert.toFace", "convert.toShell", "convert.toSolid"]],
            },
            {
                groupName: "ribbon.group.boolean",
                items: [["boolean.common", "boolean.cut", "boolean.join"]],
            },
            {
                groupName: "ribbon.group.workingPlane",
                items: [
                    "workingPlane.toggleDynamic",
                    ["workingPlane.set", "workingPlane.alignToPlane", "workingPlane.fromSection"],
                ],
            },
            {
                groupName: "ribbon.group.tools",
                items: [
                    "convert.curveProjection",
                    "create.group",
                    ["create.section", "create.offset", "create.copyShape"],
                ],
            },
            {
                groupName: "ribbon.group.measure",
                items: [["measure.length", "measure.angle", "measure.select"]],
            },
            {
                groupName: "ribbon.group.act",
                items: ["act.alignCamera"],
            },
            {
                groupName: "ribbon.group.importExport",
                items: ["file.import", "file.export"],
            },
            {
                groupName: "ribbon.group.other",
                items: ["wechat.group"],
            },
        ],
    },
    {
        tabName: "ribbon.tab.manager",
        groups: [
            {
                groupName: "ribbon.group.other",
                items: ["test.performance"],
            },
        ],
    },
];
