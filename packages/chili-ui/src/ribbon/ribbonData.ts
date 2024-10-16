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

    private _groupName: I18nKeys;
    get groupName(): I18nKeys {
        return this._groupName;
    }
    set groupName(value: I18nKeys) {
        this.setProperty("groupName", value);
    }

    constructor(groupName: I18nKeys, ...items: RibbonCommandData[]) {
        super();
        this._groupName = groupName;
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

    private _tabName: I18nKeys;
    get tabName(): I18nKeys {
        return this._tabName;
    }
    set tabName(value: I18nKeys) {
        this.setProperty("tabName", value);
    }

    constructor(tabName: I18nKeys, ...groups: RibbonGroupData[]) {
        super();
        this._tabName = tabName;
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
