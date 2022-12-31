export type RibbonCommandData = string | string[];

export interface RibbonGroupData {
    groupName: string;
    items: RibbonCommandData[];
}

export interface RibbonTabData {
    tabName: string;
    groups: RibbonGroupData[];
}

export type RibbonData = RibbonTabData[];
