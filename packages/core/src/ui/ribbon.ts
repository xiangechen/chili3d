// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { CommandKeys } from "../command";
import { ObservableCollection } from "../foundation/collection";
import { Observable } from "../foundation/observer";
import type { I18nKeys } from "../i18n";
import type { PulldownButton, PushButton, SplitButton } from "./button";

export type RibbonTabKeys = {
    [P in I18nKeys]: P extends `ribbon.tab.${infer _}` ? P : never;
}[I18nKeys];

export type RibbonGroupKeys = {
    [P in I18nKeys]: P extends `ribbon.group.${infer _}` ? P : never;
}[I18nKeys];

export type RibbonCommand =
    | CommandKeys
    | ObservableCollection<CommandKeys>
    | PushButton
    | PulldownButton
    | SplitButton;

export type RibbonGroupProfile = {
    groupName: RibbonGroupKeys;
    items: (RibbonCommand | CommandKeys[])[];
    collapsedItems?: CommandKeys[];
};

export class RibbonGroup extends Observable {
    readonly items: ObservableCollection<RibbonCommand>;
    readonly collapsedItems: ObservableCollection<CommandKeys>;

    get groupName(): RibbonGroupKeys {
        return this.getPrivateValue("groupName");
    }
    set groupName(value: RibbonGroupKeys) {
        this.setProperty("groupName", value);
    }

    constructor(groupName: RibbonGroupKeys, items: RibbonCommand[], collapsedItems?: CommandKeys[]) {
        super();
        this.setPrivateValue("groupName", groupName);
        this.items = new ObservableCollection<RibbonCommand>(...items);
        this.collapsedItems = new ObservableCollection<CommandKeys>(...(collapsedItems ?? []));
    }

    static fromProfile(profile: RibbonGroupProfile) {
        const mapItems = (items: (RibbonCommand | CommandKeys[])[]) =>
            items.map((item) => (Array.isArray(item) ? new ObservableCollection(...item) : item));

        return new RibbonGroup(profile.groupName, mapItems(profile.items), profile.collapsedItems);
    }
}

export type RibbonTabProfile = {
    tabName: RibbonTabKeys;
    groups: RibbonGroupProfile[];
    /** Contextual tabs are hidden until opened with `Ribbon.openTab` (e.g. sketch mode). */
    contextual?: boolean;
};

export class RibbonTab extends Observable {
    readonly groups = new ObservableCollection<RibbonGroup>();

    contextual = false;

    get tabName(): RibbonTabKeys {
        return this.getPrivateValue("tabName");
    }
    set tabName(value: RibbonTabKeys) {
        this.setProperty("tabName", value);
    }

    get visible(): boolean {
        return this.getPrivateValue("visible", true);
    }
    set visible(value: boolean) {
        this.setProperty("visible", value);
    }

    constructor(tabName: RibbonTabKeys, ...groups: RibbonGroup[]) {
        super();
        this.setPrivateValue("tabName", tabName);
        this.groups.push(...groups);
    }

    static fromProfile(profile: RibbonTabProfile) {
        const tab = new RibbonTab(
            profile.tabName,
            ...profile.groups.map((group) => RibbonGroup.fromProfile(group)),
        );
        tab.contextual = profile.contextual === true;
        tab.setPrivateValue("visible", profile.contextual !== true);
        return tab;
    }
}

export class Ribbon extends Observable {
    readonly quickCommands = new ObservableCollection<CommandKeys>();
    readonly tabs = new ObservableCollection<RibbonTab>();
    private preTab?: RibbonTab;

    get activeTab() {
        return this.getPrivateValue("activeTab");
    }
    set activeTab(value: RibbonTab) {
        this.setProperty("activeTab", value);
    }

    constructor(quickCommands: CommandKeys[], tabs: RibbonTab[]) {
        super();
        this.quickCommands.push(...quickCommands);
        this.tabs.push(...tabs);
        this.setPrivateValue("activeTab", tabs.find((x) => x.visible)!);
    }

    combineRibbonTab(tabProfile: RibbonTabProfile) {
        const tab = this.tabs.find((p: RibbonTab) => p.tabName === tabProfile.tabName);
        if (!tab) {
            this.tabs.push(RibbonTab.fromProfile(tabProfile));
            return;
        }

        for (const groupProfile of tabProfile.groups) {
            const group = tab?.groups.find((p: RibbonGroup) => p.groupName === groupProfile.groupName);
            if (!group) {
                tab.groups.push(RibbonGroup.fromProfile(groupProfile));
            } else {
                for (const command of groupProfile.items) {
                    const ribbonCommand = Array.isArray(command)
                        ? new ObservableCollection(...command)
                        : command;
                    group.items.push(ribbonCommand);
                }
            }
        }
    }

    addRibbonCommand(tabName: RibbonTabKeys, groupName: RibbonGroupKeys, command: RibbonCommand) {
        const tab = this.tabs.find((p: RibbonTab) => p.tabName === tabName);
        const group = tab?.groups.find((p: RibbonGroup) => p.groupName === groupName);
        group?.items.push(command);
    }

    setActiveTab(tabName: RibbonTabKeys) {
        const tab = this.tabs.find((p: RibbonTab) => p.tabName === tabName);
        if (!tab) {
            console.error(`Can't find tab ${tabName}`);
            return;
        }

        this.activeTab = tab;
    }

    openTab(tabName: RibbonTabKeys) {
        const tab = this.tabs.find((x) => x.tabName === tabName);
        if (!tab) return;

        this.preTab = this.activeTab;
        if (!tab.visible) tab.visible = true;
        this.activeTab = tab;
    }

    closeTab(tabName: RibbonTabKeys) {
        const tab = this.tabs.find((x) => x.tabName === tabName);
        if (!tab) return;

        tab.visible = !tab.contextual;
        this.activeTab = this.preTab ?? this.tabs.find((x) => x.visible)!;
    }
}
