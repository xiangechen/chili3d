import { CommandKeys, I18nKeys } from "chili-core";

export type RibbonGroupProfile = {
    groupName: I18nKeys;
    items: (CommandKeys | CommandKeys[])[];
};

export type RibbonTabProfile = {
    tabName: I18nKeys;
    groups: RibbonGroupProfile[];
};

export const DefaultRibbon: RibbonTabProfile[] = [
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
                    "create.bezier",
                    "create.polygon",
                    "create.box",
                    "create.thickSolid",
                ],
            },
            {
                groupName: "ribbon.group.modify",
                items: ["modify.move", "modify.rotate", "modify.mirror", "create.offset", "modify.delete"],
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
                items: ["workingPlane.set", "workingPlane.alignToPlane"],
            },
            {
                groupName: "ribbon.group.tools",
                items: ["create.section", "modify.split"],
            },
            {
                groupName: "ribbon.group.importExport",
                items: ["file.import", "file.export.iges", "file.export.stp"],
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
                items: ["create.line", "create.rect", ["create.circle", "create.box"]],
            },
        ],
    },
];
