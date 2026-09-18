// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type CommandKeys,
    CommandStore,
    Config,
    I18n,
    type Locale,
    ObservableCollection,
    Ribbon,
    RibbonGroup,
    type RibbonGroupKeys,
    RibbonTab,
    type RibbonTabKeys,
} from "@chili3d/core";
import { rs } from "@rstest/core";
import { buildRibbonTools } from "../src/tools/ribbonTools";

function getTool(name: string) {
    const tool = buildRibbonTools().find((t) => t.name === name);
    expect(tool).toBeDefined();
    return tool!;
}

/** A ribbon shaped like the app builds it: a tab with a group of buttons plus an overflow. */
function buildRibbon(): Ribbon {
    const draw = new RibbonGroup(
        "ribbon.group.draw" as RibbonGroupKeys,
        [
            "create.line" as CommandKeys,
            new ObservableCollection("create.rect", "create.circle" as CommandKeys),
        ],
        ["create.helix" as CommandKeys],
    );
    const modify = new RibbonGroup("ribbon.group.modify" as RibbonGroupKeys, [
        "modify.fillet" as CommandKeys,
    ]);
    const model = new RibbonTab("ribbon.tab.model" as RibbonTabKeys, draw, modify);
    const sketch = new RibbonTab("ribbon.tab.sketch" as RibbonTabKeys);
    sketch.contextual = true;
    sketch.visible = false;

    return new Ribbon(["doc.save" as CommandKeys], [model, sketch]);
}

function stubApp(ribbon: Ribbon | undefined) {
    rs.stubGlobal("app", { mainWindow: ribbon ? { ribbon } : {} });
}

afterEach(() => {
    rs.unstubAllGlobals();
    Config.instance.navigation3D = "Chili3d";
    CommandStore.unregisterCommand("modify.thickSolid");
});

describe("get_ribbon tool", () => {
    test("reports unavailable instead of failing when no window is open", async () => {
        stubApp(undefined);

        const result = JSON.parse((await getTool("get_ribbon").handler({})) as string);

        expect(result.available).toBe(false);
    });

    test("lists the live tabs, groups and buttons with their command ids and hotkeys", async () => {
        stubApp(buildRibbon());

        const result = JSON.parse((await getTool("get_ribbon").handler({})) as string);

        expect(result.available).toBe(true);
        expect(result.activeTab).toBe("ribbon.tab.model");
        expect(result.quickCommands).toEqual([
            { label: "command.doc.save", command: "doc.save", hotkey: "Ctrl+S" },
        ]);
        expect(result.tabs.map((tab: { name: string }) => tab.name)).toEqual([
            "ribbon.tab.model",
            "ribbon.tab.sketch",
        ]);

        const [model, sketch] = result.tabs;
        expect(model.groups.map((g: { name: string }) => g.name)).toEqual([
            "ribbon.group.draw",
            "ribbon.group.modify",
        ]);
        // A collection is a stack of small buttons: it keeps its shape instead of flattening.
        expect(model.groups[0].items).toEqual([
            { label: "command.create.line", command: "create.line", hotkey: "L" },
            {
                stacked: [
                    { label: "command.create.rect", command: "create.rect", hotkey: "R" },
                    { label: "command.create.circle", command: "create.circle", hotkey: "C" },
                ],
            },
        ]);
        // The overflow is reported apart from the buttons that are always visible, and a
        // button without a binding simply carries no hotkey.
        expect(model.groups[0].overflow).toEqual([
            { label: "command.create.helix", command: "create.helix" },
        ]);
        expect(sketch.visible).toBe(false);
        expect(sketch.contextual).toBe(true);
    });

    test("labels buttons in the language the app is currently showing", async () => {
        const original = I18n.currentLanguage();
        const testLocale = {
            display: "Test",
            language: "test-locale",
            translation: { "ribbon.tab.model": "MODELL", "command.create.line": "LINIE" },
        } as unknown as Locale;
        try {
            I18n.addLanguage(testLocale);
            I18n.changeLanguage("test-locale");
            stubApp(buildRibbon());

            const result = JSON.parse((await getTool("get_ribbon").handler({})) as string);

            expect(result.language).toBe("test-locale");
            expect(result.tabs[0].name).toBe("MODELL");
            expect(result.tabs[0].groups[0].items[0].label).toBe("LINIE");
        } finally {
            I18n.changeLanguage(original);
            I18n.removeLanguage("test-locale");
        }
    });

    test("reports the pan/rotate buttons and the commands with no ribbon button", async () => {
        stubApp(buildRibbon());
        class ThickSolidCommand {}
        CommandStore.registerCommand(ThickSolidCommand as never, {
            key: "modify.thickSolid" as CommandKeys,
            icon: "icon-thickSolid",
        });

        const result = JSON.parse((await getTool("get_ribbon").handler({})) as string);

        expect(result.navigationControls).toEqual({ pan: "Middle", rotate: "Shift+Middle" });
        // A command the user cannot reach from the ribbon is called out, so the answer for it
        // is not "click the ribbon" — while the ones that do have a button stay out of the list.
        expect(result.commandsWithoutRibbonButton).toContain("modify.thickSolid");
        expect(result.commandsWithoutRibbonButton).not.toContain("create.line");
    });

    test("uses the hotkeys of the active navigation profile", async () => {
        stubApp(buildRibbon());
        Config.instance.navigation3D = "Revit";

        const result = JSON.parse((await getTool("get_ribbon").handler({})) as string);

        // Revit rebinds create.line to "l+i" — a key sequence, not a modified key.
        expect(result.navigationProfile).toBe("Revit");
        expect(result.tabs[0].groups[0].items[0].hotkey).toBe("L then I");
        expect(result.quickCommands[0].hotkey).toBe("Ctrl+S");
    });
});
