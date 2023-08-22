import { RibbonData } from "../ribbon/ribbonData";

export const DefaultRibbon: RibbonData = [
    {
        tabName: "ribbon.tab.startup",
        groups: [
            {
                groupName: "ribbon.group.draw",
                items: [
                    "doc.create.line",
                    "doc.create.rect",
                    "doc.create.circle",
                    "doc.create.box",
                    ["doc.create.rect", "doc.create.circle"],
                ],
            },
            {
                groupName: "ribbon.group.modify",
                items: ["doc.modify.move", "doc.modify.rotate", "doc.modify.mirror", "doc.modify.delete"],
            },
        ],
    },
    {
        tabName: "ribbon.tab.draw",
        groups: [
            {
                groupName: "ribbon.group.draw",
                items: ["doc.create.line", "doc.create.rect", "doc.create.circle", "doc.create.box"],
            },
            {
                groupName: "ribbon.group.draw",
                items: ["doc.create.line", "doc.create.rect", "doc.create.circle", "doc.create.box"],
            },
        ],
    },
];
