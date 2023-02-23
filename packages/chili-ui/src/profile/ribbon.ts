import { RibbonData } from "../ribbon/ribbonData";

export const DefaultRibbon: RibbonData = [
    {
        tabName: "ribbon.tab.startup",
        groups: [
            {
                groupName: "ribbon.group.drawing",
                items: ["Line", "Rect", "Circle", "Box", ["PLine", "Circle"]],
            },
        ],
    },
];
