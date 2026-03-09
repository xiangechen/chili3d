// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type I18nKeys, type IApplication, Localize, PubSub } from "@chili3d/core";
import { button, div, li, span, ul } from "@chili3d/element";
import style from "./macro.module.css";
import { MacroEditor } from "./macroEditor";
import { runMacro } from "./macroRunner";
import { type MacroDefinition, MacroStorage } from "./macroStorage";

export class MacroManager {
    private readonly storage: MacroStorage;

    private macros: MacroDefinition[] = [];
    private macroListElement: HTMLElement | null = null;

    constructor(readonly app: IApplication) {
        this.storage = new MacroStorage(app);
    }

    async initialize(): Promise<void> {
        await this.storage.ensureStorage();
    }

    async show(): Promise<void> {
        this.macros = await this.storage.getAllMacros();

        this.macroListElement = ul({ className: style.macroList });
        this.refreshList();

        const content = div(
            { className: style.managerContainer },
            div(
                { className: style.toolbar },
                button({
                    textContent: new Localize("macro.manager.new" as I18nKeys),
                    className: style.toolbarButton,
                    onclick: () => this.createNewMacro(),
                }),
            ),
            this.macroListElement,
        );

        PubSub.default.pub("showFloatPanel", {
            title: "macro.manager.title" as I18nKeys,
            content,
            width: 500,
            height: 500,
        });
    }

    private createMacroItem(macro: MacroDefinition): HTMLElement {
        return li(
            { className: style.macroItem },
            span({ className: style.macroName }, macro.name),
            div(
                { className: style.actions },
                button({
                    textContent: new Localize("macro.manager.edit" as I18nKeys),
                    className: style.actionButton,
                    onclick: () => this.editMacro(macro),
                }),
                button({
                    textContent: new Localize("macro.manager.run" as I18nKeys),
                    className: style.actionButton,
                    onclick: () => runMacro(this.app, macro.code),
                }),
                button({
                    textContent: new Localize("macro.manager.delete" as I18nKeys),
                    className: `${style.actionButton} ${style.deleteButton}`,
                    onclick: () => this.deleteMacro(macro),
                }),
            ),
        );
    }

    private async createNewMacro(): Promise<void> {
        const editor = new MacroEditor(this.app, this.storage);
        editor.show(undefined, async () => {
            this.macros = await this.storage.getAllMacros();
            this.refreshList();
        });
    }

    private async editMacro(macro: MacroDefinition): Promise<void> {
        const editor = new MacroEditor(this.app, this.storage);
        editor.show(macro, async () => {
            this.macros = await this.storage.getAllMacros();
            this.refreshList();
        });
    }

    private async deleteMacro(macro: MacroDefinition): Promise<void> {
        await this.storage.deleteMacro(macro.id);
        this.macros = this.macros.filter((m) => m.id !== macro.id);
        this.refreshList();
    }

    private refreshList(): void {
        if (!this.macroListElement) return;

        this.macroListElement.innerHTML = "";

        if (this.macros.length === 0) {
            this.macroListElement.appendChild(
                li({
                    className: style.emptyMessage,
                    textContent: new Localize("macro.manager.empty" as I18nKeys),
                }),
            );
        } else {
            for (const macro of this.macros) {
                this.macroListElement.appendChild(this.createMacroItem(macro));
            }
        }
    }
}
