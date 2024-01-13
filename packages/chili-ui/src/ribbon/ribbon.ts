// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    AsyncController,
    Command,
    CommandKeys,
    ICommand,
    IConverter,
    IDocument,
    Logger,
    Observable,
    ObservableCollection,
    PubSub,
    Result,
} from "chili-core";
import { BindableElement, a, div, items, label, localize, span, svg } from "../controls";
import { CommandContext } from "./commandContext";
import style from "./ribbon.module.css";
import { RibbonButtonSize } from "./ribbonButtonSize";
import { RibbonGroupData, RibbonTabData } from "./ribbonData";
import { RibbonGroup } from "./ribbonGroup";

export class RibbonDataContent extends Observable {
    #document: IDocument | undefined;
    readonly quickCommands = new ObservableCollection<CommandKeys>();
    readonly ribbonTabs = new ObservableCollection<RibbonTabData>();

    private _documentName: string | undefined;
    get documentName() {
        return this._documentName;
    }
    set documentName(value: string | undefined) {
        this.setProperty("documentName", value);
    }

    private _activeTab: RibbonTabData;
    get activeTab() {
        return this._activeTab;
    }
    set activeTab(value: RibbonTabData) {
        this.setProperty("activeTab", value);
    }

    constructor(quickCommands: CommandKeys[], ribbonTabs: RibbonTabData[]) {
        super();
        this.quickCommands.add(...quickCommands);
        this.ribbonTabs.add(...ribbonTabs);
        this._activeTab = ribbonTabs[0];
        PubSub.default.sub("activeDocumentChanged", this.#documentChanged);
    }

    #documentChanged = (document: IDocument | undefined) => {
        if (this.#document === document) return;
        if (this.#document) {
            this.#document.removePropertyChanged(this.#onDocumentPropertyChanged);
        }
        this.#document = document;
        this.documentName = document?.name;
        this.#document?.onPropertyChanged(this.#onDocumentPropertyChanged);
    };

    #onDocumentPropertyChanged = (property: keyof IDocument) => {
        if (property === "name") {
            this.documentName = this.#document?.name ?? "undefined";
        }
    };

    override dispose(): void {
        super.dispose();
        PubSub.default.remove("activeDocumentChanged", this.#documentChanged);
        this.#document?.removePropertyChanged(this.#onDocumentPropertyChanged);
    }
}

export const QuickButton = (command: ICommand) => {
    let data = Command.getData(command);
    if (data === undefined) {
        Logger.warn("commandData is undefined");
        return span({ textContent: "null" });
    }
    return svg({
        icon: data.icon,
        onclick: () => {
            PubSub.default.pub("executeCommand", command as any);
        },
    });
};

class ActivedStyleConverter implements IConverter<RibbonTabData> {
    constructor(
        readonly tab: RibbonTabData,
        readonly style: string,
        readonly activeStyle: string,
    ) {}

    convert(value: RibbonTabData): Result<string> {
        if (this.tab === value) {
            return Result.success(`${this.style} ${this.activeStyle}`);
        } else {
            return Result.success(this.style);
        }
    }
}

class DisplayConverter implements IConverter<RibbonTabData> {
    constructor(readonly tab: RibbonTabData) {}

    convert(value: RibbonTabData): Result<string> {
        if (this.tab === value) {
            return Result.success("");
        } else {
            return Result.success("none");
        }
    }
}

export class Ribbon extends BindableElement {
    #commandContextContainer = div({ className: style.commandContextPanel });
    #selectionControl: RibbonGroupData | undefined;

    constructor(readonly dataContent: RibbonDataContent) {
        super();
        this.className = style.root;
        this.append(
            div(
                { className: style.titleBar },
                items({
                    className: style.quickCommands,
                    sources: dataContent.quickCommands,
                    template: (command: CommandKeys) => QuickButton(command as any),
                }),
                div(
                    { className: style.title },
                    span({
                        className: style.titleText,
                        textContent: this.bind(dataContent, "documentName"),
                    }),
                    span({ className: style.appName, textContent: "Chili3d 2023" }),
                ),
                div(
                    { className: style.right },
                    a(
                        {
                            href: "https://github.com/xiangechen/chili3d",
                            target: "_blank",
                        },
                        svg({
                            icon: "icon-github",
                        }),
                    ),
                ),
            ),
            div(
                { className: style.tabHeaderPanel },
                label({
                    textContent: localize("ribbon.tab.file"),
                    className: style.startup,
                    onclick: () => PubSub.default.pub("showHome"),
                }),
                items({
                    sources: dataContent.ribbonTabs,
                    template: (tab: RibbonTabData) => {
                        const converter = new ActivedStyleConverter(tab, style.tabHeader, style.activedTab);
                        return label({
                            className: this.bind(dataContent, "activeTab", converter),
                            textContent: localize(tab.tabName),
                            onclick: () => (dataContent.activeTab = tab),
                        });
                    },
                }),
            ),
            items({
                className: style.tabContentPanel,
                sources: dataContent.ribbonTabs,
                template: (tab: RibbonTabData) => {
                    return items({
                        className: style.groupPanel,
                        sources: tab.groups,
                        style: {
                            display: this.bind(dataContent, "activeTab", new DisplayConverter(tab)),
                        },
                        template: (group: RibbonGroupData) => RibbonGroup.from(group),
                    });
                },
            }),
            this.#commandContextContainer,
        );
    }

    override connectedCallback(): void {
        super.connectedCallback();
        PubSub.default.sub("openCommandContext", this.openContext);
        PubSub.default.sub("closeCommandContext", this.closeContext);
        PubSub.default.sub("showSelectionControl", this.showSelectionControl);
        PubSub.default.sub("clearSelectionControl", this.clearSelectionControl);
    }

    override disconnectedCallback(): void {
        super.disconnectedCallback();
        PubSub.default.remove("openCommandContext", this.openContext);
        PubSub.default.remove("closeCommandContext", this.closeContext);
        PubSub.default.remove("showSelectionControl", this.showSelectionControl);
        PubSub.default.remove("clearSelectionControl", this.clearSelectionControl);
    }

    private openContext = (command: ICommand) => {
        this.#commandContextContainer.append(new CommandContext(command));
    };

    private closeContext = () => {
        this.#commandContextContainer.innerHTML = "";
    };

    private showSelectionControl = (controller: AsyncController) => {
        this.#selectionControl = new RibbonGroupData(
            "ribbon.group.selection",
            {
                display: "common.confirm",
                icon: "icon-confirm",
                size: RibbonButtonSize.Normal,
                onClick: controller.success,
            },
            {
                display: "common.cancel",
                icon: "icon-cancel",
                size: RibbonButtonSize.Normal,
                onClick: controller.cancel,
            },
        );
        this.dataContent.activeTab.groups.add(this.#selectionControl);
    };

    private clearSelectionControl = () => {
        if (this.#selectionControl) {
            this.dataContent.activeTab.groups.remove(this.#selectionControl);
        }
    };
}

customElements.define("chili-ribbon", Ribbon);
