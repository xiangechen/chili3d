// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { CommandKeys } from "../command";
import { PubSub } from "../foundation";
import { ObservableCollection } from "../foundation/collection";
import { Observable } from "../foundation/observer";
import type { I18nKeys } from "../i18n";
import type { IView } from "../visual/view";
import type { Button } from "./button";

export type RibbonCommand = CommandKeys | ObservableCollection<CommandKeys> | Button;

export type RibbonGroupProfile = {
    groupName: I18nKeys;
    items: (CommandKeys | CommandKeys[])[];
};

export class RibbonGroup extends Observable {
    readonly items: ObservableCollection<RibbonCommand>;

    get groupName(): I18nKeys {
        return this.getPrivateValue("groupName");
    }
    set groupName(value: I18nKeys) {
        this.setProperty("groupName", value);
    }

    constructor(groupName: I18nKeys, ...items: RibbonCommand[]) {
        super();
        this.setPrivateValue("groupName", groupName);
        this.items = new ObservableCollection<RibbonCommand>(...items);
    }

    static fromProfile(profile: RibbonGroupProfile) {
        return new RibbonGroup(
            profile.groupName,
            ...profile.items.map((item) => {
                return Array.isArray(item) ? new ObservableCollection(...item) : item;
            }),
        );
    }
}

export type RibbonTabProfile = {
    tabName: I18nKeys;
    groups: RibbonGroupProfile[];
};

export class RibbonTab extends Observable {
    readonly groups = new ObservableCollection<RibbonGroup>();

    get tabName(): I18nKeys {
        return this.getPrivateValue("tabName");
    }
    set tabName(value: I18nKeys) {
        this.setProperty("tabName", value);
    }

    constructor(tabName: I18nKeys, ...groups: RibbonGroup[]) {
        super();
        this.setPrivateValue("tabName", tabName);
        this.groups.push(...groups);
    }

    static fromProfile(profile: RibbonTabProfile) {
        return new RibbonTab(
            profile.tabName,
            ...profile.groups.map((group) => RibbonGroup.fromProfile(group)),
        );
    }
}

export class Ribbon extends Observable {
    readonly quickCommands = new ObservableCollection<CommandKeys>();
    readonly tabs = new ObservableCollection<RibbonTab>();
    private _activeTab: RibbonTab;
    private _activeView: IView | undefined;

    constructor(quickCommands: CommandKeys[], tabs: RibbonTab[]) {
        super();
        this.quickCommands.push(...quickCommands);
        this.tabs.push(...tabs);
        this._activeTab = tabs[0];
        PubSub.default.sub("activeViewChanged", (v) => {
            this.activeView = v;
        });
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

    addRibbonCommand(tabName: I18nKeys, groupName: I18nKeys, command: CommandKeys | Button) {
        const tab = this.tabs.find((p: RibbonTab) => p.tabName === tabName);
        const group = tab?.groups.find((p: RibbonGroup) => p.groupName === groupName);
        group?.items.push(command);
    }

    get activeTab() {
        return this._activeTab;
    }
    set activeTab(value: RibbonTab) {
        this.setProperty("activeTab", value);
    }

    get activeView() {
        return this._activeView;
    }
    set activeView(value: IView | undefined) {
        this.setProperty("activeView", value);
    }
}
