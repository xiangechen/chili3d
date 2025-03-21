import { RibbonTab } from "chili-core";

export const DefaultRibbon: RibbonTab[] = [
    {
        tabName: "ribbon.tab.startup",
        groups: [
            {
                groupName: "ribbon.group.draw",
                items: [
                    "create.line",
                    "create.arc",
                    "create.rect",
                    "create.circle",
                    "create.ellipse",
                    "create.bezier",
                    "create.polygon",
                    "create.box",
                    "create.pyramid",
                    "create.cylinder",
                    "create.cone",
                    "create.sphere",
                    "create.ellipsoid",
                    "create.thickSolid",
                ],
            },
            {
                groupName: "ribbon.group.modify",
                items: [
                    "modify.move",
                    "modify.rotate",
                    "modify.mirror",
                    "create.offset",
                    "modify.delete",
                    "modify.break",
                    "modify.trim",
                    "modify.fillet",
                    "modify.chamfer",
                    "modify.removeFaces",
                ],
            },
            {
                groupName: "ribbon.group.converter",
                items: [
                    "convert.toWire",
                    "convert.toFace",
                    "convert.prism",
                    "convert.sweep",
                    "convert.revol",
                ],
            },
            {
                groupName: "ribbon.group.boolean",
                items: ["boolean.common", "boolean.cut", "boolean.fuse"],
            },
            {
                groupName: "ribbon.group.workingPlane",
                items: ["workingPlane.toggleDynamic", "workingPlane.set", "workingPlane.alignToPlane"],
            },
            {
                groupName: "ribbon.group.tools",
                items: ["create.section", "modify.split"],
            },
            {
                groupName: "ribbon.group.importExport",
                items: ["file.import", "file.export"],
            },
        ],
    },
    {
        tabName: "ribbon.tab.draw",
        groups: [
            {
                groupName: "ribbon.group.draw",
                items: ["create.line", "create.rect", "create.circle", "create.box"],
            },
            {
                groupName: "ribbon.group.draw",
                items: ["test.performace", "create.rect", ["create.circle", "create.box"]],
            },
        ],
    },
];
