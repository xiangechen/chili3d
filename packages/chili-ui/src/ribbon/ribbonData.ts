import { CommandKeys, I18nKeys } from "chili-core";

export type RibbonCommandData = CommandKeys | CommandKeys[];

export interface RibbonGroupData {
    groupName: I18nKeys;
    items: RibbonCommandData[];
}

export interface RibbonTabData {
    tabName: I18nKeys;
    groups: RibbonGroupData[];
}

export type RibbonData = RibbonTabData[];
