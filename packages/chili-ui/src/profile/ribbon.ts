import { RibbonData } from "../ribbon/ribbonData";

export const DefaultRibbon: RibbonData = [
    {
        tabName: "ribbon.tab.startup",
        groups: [
            {
                groupName: "ribbon.group.draw",
                items: [
                    "create.line",
                    "create.rect",
                    "create.circle",
                    "create.box",
                    ["create.polygon", "create.circle"],
                ],
            },
            {
                groupName: "ribbon.group.modify",
                items: ["modify.move", "modify.rotate", "modify.mirror", "modify.delete"],
            },
            {
                groupName: "ribbon.group.converter",
                items: ["convert.toPolygon", "convert.prism", "convert.sweep", "convert.revol"],
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
                items: ["create.line", "create.rect", "create.circle", "create.box"],
            },
        ],
    },
];
