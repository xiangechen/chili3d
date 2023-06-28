import { RibbonData } from "../ribbon/ribbonData";

export const DefaultRibbon: RibbonData = [
    {
        tabName: "ribbon.tab.startup",
        groups: [
            {
                groupName: "ribbon.group.draw",
                items: ["Line", "Rect", "Circle", "Box", ["PLine", "Circle"]],
            },
            {
                groupName: "ribbon.group.modify",
                items: ["Move", "Copy", "Mirror", "Rotate", "Array"],
            },
        ],
    },
    {
        tabName: "ribbon.tab.draw",
        groups: [
            {
                groupName: "ribbon.group.draw",
                items: ["Line", "Rect", "Circle", "Box"],
            },
            {
                groupName: "ribbon.group.draw",
                items: ["Line", "Rect", "Circle", "Box"],
            },
        ],
    },
];
