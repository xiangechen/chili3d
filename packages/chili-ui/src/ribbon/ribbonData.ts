import { Commands, I18n } from "chili-core";

export type RibbonCommandData = Commands | Commands[];

export interface RibbonGroupData {
    groupName: keyof I18n;
    items: RibbonCommandData[];
}

export interface RibbonTabData {
    tabName: keyof I18n;
    groups: RibbonGroupData[];
}

export type RibbonData = RibbonTabData[];
