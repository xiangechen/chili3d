// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    CommandStore,
    Config,
    formatShortcutKey,
    I18n,
    type I18nKeys,
    Navigation3D,
    ObservableCollection,
    type Ribbon,
    type RibbonCommand,
    type RibbonGroup,
    type RibbonTab,
    ShortcutProfiles,
} from "@chili3d/core";
import type { Tool } from "../llm/types";

function getRibbon(): Ribbon | undefined {
    try {
        // globalThis.app is a core getter that throws before any Application exists, and a
        // headless run has no window to read a ribbon from.
        return globalThis.app?.mainWindow?.ribbon;
    } catch {
        return undefined;
    }
}

const translate = (key: I18nKeys) => I18n.translate(key);

/** The active profile's bindings, inverted to command -> display keys ("Ctrl+S"). */
function hotkeysOfCurrentProfile(): Map<string, string> {
    const profile = ShortcutProfiles[Config.instance.navigation3D] ?? {};
    const byCommand = new Map<string, string>();
    for (const [command, keyOrKeys] of Object.entries(profile)) {
        const keys = Array.isArray(keyOrKeys) ? keyOrKeys : [keyOrKeys];
        byCommand.set(command, keys.map(formatShortcutKey).join(" / "));
    }
    return byCommand;
}

type ItemSummary = { label: string; command?: string; hotkey?: string };

function summarizeItem(item: RibbonCommand, hotkeys: Map<string, string>): ItemSummary | object {
    if (typeof item === "string") {
        return { label: translate(`command.${item}`), command: item, hotkey: hotkeys.get(item) };
    }
    // A collection is a stack of small buttons in one column; its members show as separate items.
    if (item instanceof ObservableCollection) {
        return { stacked: item.map((command) => summarizeItem(command, hotkeys)) };
    }
    if (item.type === "push") {
        return {
            label: item.display ? translate(item.display) : translate(`command.${item.command}`),
            command: item.command,
            hotkey: hotkeys.get(item.command),
        };
    }
    if (item.type === "pulldown") {
        return {
            dropdown: translate(item.display),
            items: item.items.map((entry) => summarizeItem(entry as RibbonCommand, hotkeys)),
        };
    }
    return { split: item.items.map((entry) => summarizeItem(entry as RibbonCommand, hotkeys)) };
}

/** Every command a button on this ribbon runs, overflow and title bar included. */
function commandsOnRibbon(ribbon: Ribbon): Set<string> {
    const ids = new Set<string>();
    const add = (item: RibbonCommand): void => {
        if (typeof item === "string") {
            ids.add(item);
        } else if (item instanceof ObservableCollection) {
            item.forEach(add);
        } else if (item.type === "push") {
            ids.add(item.command);
        } else {
            item.items.forEach((entry) => add(entry));
        }
    };

    for (const tab of ribbon.tabs) {
        for (const group of tab.groups) {
            group.items.forEach(add);
            for (const command of group.collapsedItems) {
                ids.add(command);
            }
        }
    }
    for (const command of ribbon.quickCommands) {
        ids.add(command);
    }
    return ids;
}

/**
 * Registered commands with no button anywhere on the ribbon: they are run from a dialog, the
 * model tree, or a hotkey only, so "click the ribbon" is the wrong answer for them. Read from
 * the command registry rather than from the labels — this way it names the commands this build
 * actually has, not the ones the shipped translations happen to mention.
 */
function commandsWithoutRibbonButton(ribbon: Ribbon): string[] {
    const onRibbon = commandsOnRibbon(ribbon);
    return CommandStore.getAllCommands()
        .map((data) => data.key)
        .filter((key) => !onRibbon.has(key));
}

function summarizeGroup(group: RibbonGroup, hotkeys: Map<string, string>) {
    return {
        name: translate(group.groupName),
        items: group.items.map((item) => summarizeItem(item, hotkeys)),
        // Buttons hidden behind the group's expansion arrow.
        overflow: group.collapsedItems.map((command) => summarizeItem(command, hotkeys)),
    };
}

function summarizeTab(tab: RibbonTab, active: RibbonTab | undefined, hotkeys: Map<string, string>) {
    return {
        name: translate(tab.tabName),
        visible: tab.visible,
        contextual: tab.contextual,
        active: tab === active,
        groups: tab.groups.map((group) => summarizeGroup(group, hotkeys)),
    };
}

/**
 * The ribbon as it is in this session: the tabs, groups and buttons the user is looking at,
 * with the active profile's hotkeys and the labels in the user's language. Registered plugins
 * and any build-specific ribbon are included, because this reads the live UI rather than the
 * static profiles the guide is generated from.
 */
async function readRibbon(): Promise<string> {
    const ribbon = getRibbon();
    if (!ribbon) {
        return JSON.stringify({
            available: false,
            reason: "no window is open in this session",
        });
    }

    const hotkeys = hotkeysOfCurrentProfile();
    const { pan, rotate } = Navigation3D.navigationKeyMap();
    return JSON.stringify({
        available: true,
        language: I18n.currentLanguage(),
        navigationProfile: Config.instance.navigation3D,
        navigationControls: { pan, rotate },
        quickCommands: ribbon.quickCommands.map((command) => summarizeItem(command, hotkeys)),
        commandsWithoutRibbonButton: commandsWithoutRibbonButton(ribbon),
        activeTab: ribbon.activeTab ? translate(ribbon.activeTab.tabName) : undefined,
        tabs: ribbon.tabs.map((tab) => summarizeTab(tab, ribbon.activeTab, hotkeys)),
    });
}

export function buildRibbonTools(): Tool[] {
    return [
        {
            name: "get_ribbon",
            description:
                "Read the ribbon as it is right now: every tab, group and button the user can click (plugin contributions included), each with its label in the user's language, the command id behind it, and the hotkey of the active navigation profile. Also reports the pan/rotate mouse buttons of that profile, and the registered commands that have no ribbon button at all. Use it to answer where a command is before telling the user where to click.",
            parameters: { type: "object", properties: {} },
            handler: readRibbon,
        },
    ];
}
