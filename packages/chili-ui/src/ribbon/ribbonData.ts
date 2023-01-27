import { I18n } from "chili-core";

export type RibbonCommandData = string | string[];

export interface RibbonGroupData {
    groupName: keyof I18n;
    items: RibbonCommandData[];
}

export interface RibbonTabData {
    tabName: keyof I18n;
    groups: RibbonGroupData[];
}

export type RibbonData = RibbonTabData[];
