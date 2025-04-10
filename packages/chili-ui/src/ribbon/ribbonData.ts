// Copyright (c) 2022-2025 陈仙阁 (Chen Xiange)
// Chili3d is licensed under the AGPL-3.0 License.

import {
    Button,
    CommandKeys,
    I18nKeys,
    Observable,
    ObservableCollection,
    RibbonGroup,
    RibbonTab,
} from "chili-core";

export type RibbonCommandData = CommandKeys | ObservableCollection<CommandKeys> | Button;

export class RibbonGroupData extends Observable {
    readonly items: ObservableCollection<RibbonCommandData>;

    get groupName(): I18nKeys {
        return this.getPrivateValue("groupName");
    }
    set groupName(value: I18nKeys) {
        this.setProperty("groupName", value);
    }

    constructor(groupName: I18nKeys, ...items: RibbonCommandData[]) {
        super();
        this.setPrivateValue("groupName", groupName);
        this.items = new ObservableCollection<RibbonCommandData>(...items);
    }

    static fromProfile(profile: RibbonGroup) {
        return new RibbonGroupData(
            profile.groupName,
            ...profile.items.map((item) => {
                return Array.isArray(item) ? new ObservableCollection(...item) : item;
            }),
        );
    }
}

export class RibbonTabData extends Observable {
    readonly groups = new ObservableCollection<RibbonGroupData>();

    get tabName(): I18nKeys {
        return this.getPrivateValue("tabName");
    }
    set tabName(value: I18nKeys) {
        this.setProperty("tabName", value);
    }

    constructor(tabName: I18nKeys, ...groups: RibbonGroupData[]) {
        super();
        this.setPrivateValue("tabName", tabName);
        this.groups.push(...groups);
    }

    static fromProfile(profile: RibbonTab) {
        return new RibbonTabData(
            profile.tabName,
            ...profile.groups.map((group) => RibbonGroupData.fromProfile(group)),
        );
    }
}

export type RibbonData = RibbonTabData[];
