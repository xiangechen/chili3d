// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    Binding,
    ButtonSize,
    Command,
    CommandKeys,
    I18n,
    IApplication,
    ICommand,
    IConverter,
    IView,
    Logger,
    Observable,
    ObservableCollection,
    PubSub,
    Result,
} from "chili-core";
import { a, collection, div, label, localize, span, svg } from "../components";
import { CommandContext } from "./commandContext";
import style from "./ribbon.module.css";
import { RibbonButton } from "./ribbonButton";
import { RibbonGroupData, RibbonTabData } from "./ribbonData";
import { RibbonStack } from "./ribbonStack";

export class RibbonDataContent extends Observable {
    readonly quickCommands = new ObservableCollection<CommandKeys>();
    readonly ribbonTabs = new ObservableCollection<RibbonTabData>();

    private _activeTab: RibbonTabData;
    get activeTab() {
        return this._activeTab;
    }
    set activeTab(value: RibbonTabData) {
        this.setProperty("activeTab", value);
    }

    private _activeView: IView | undefined;
    get activeView() {
        return this._activeView;
    }
    set activeView(value: IView | undefined) {
        this.setProperty("activeView", value);
    }

    constructor(
        readonly app: IApplication,
        quickCommands: CommandKeys[],
        ribbonTabs: RibbonTabData[],
    ) {
        super();
        this.quickCommands.push(...quickCommands);
        this.ribbonTabs.push(...ribbonTabs);
        this._activeTab = ribbonTabs[0];
        PubSub.default.sub("activeViewChanged", (v) => (this.activeView = v));
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
        title: I18n.translate(data.display),
        onclick: () => {
            PubSub.default.pub("executeCommand", command as any);
        },
    });
};

class ViewActiveConverter implements IConverter<IView> {
    constructor(
        readonly target: IView,
        readonly style: string,
        readonly activeStyle: string,
    ) {}

    convert(value: IView): Result<string> {
        if (this.target === value) {
            return Result.ok(`${this.style} ${this.activeStyle}`);
        } else {
            return Result.ok(this.style);
        }
    }
}

class ActivedRibbonTabConverter implements IConverter<RibbonTabData> {
    constructor(
        readonly tab: RibbonTabData,
        readonly style: string,
        readonly activeStyle: string,
    ) {}

    convert(value: RibbonTabData): Result<string> {
        if (this.tab === value) {
            return Result.ok(`${this.style} ${this.activeStyle}`);
        } else {
            return Result.ok(this.style);
        }
    }
}

class DisplayConverter implements IConverter<RibbonTabData> {
    constructor(readonly tab: RibbonTabData) {}

    convert(value: RibbonTabData): Result<string> {
        if (this.tab === value) {
            return Result.ok("");
        } else {
            return Result.ok("none");
        }
    }
}

export class Ribbon extends HTMLElement {
    private _commandContextContainer = div({ className: style.commandContextPanel });

    constructor(readonly dataContent: RibbonDataContent) {
        super();
        this.className = style.root;
        this.append(
            div(
                { className: style.titleBar },
                div(
                    { className: style.left },
                    div(
                        {
                            className: style.appIcon,
                            onclick: () => PubSub.default.pub("displayHome", true),
                        },
                        svg({
                            className: style.icon,
                            icon: "icon-chili",
                        }),
                        span({ id: "appName", textContent: `Chili3D - v${__APP_VERSION__}` }),
                    ),
                ),
                div(
                    { className: style.ribbonTitlePanel },
                    svg({
                        className: style.home,
                        icon: "icon-home",
                        onclick: () => PubSub.default.pub("displayHome", true),
                    }),
                    collection({
                        className: style.quickCommands,
                        sources: dataContent.quickCommands,
                        template: (command: CommandKeys) => QuickButton(command as any),
                    }),
                    span({ className: style.split }),
                    collection({
                        sources: dataContent.ribbonTabs,
                        template: (tab: RibbonTabData) => {
                            const converter = new ActivedRibbonTabConverter(
                                tab,
                                style.tabHeader,
                                style.activedTab,
                            );
                            return label({
                                className: new Binding(dataContent, "activeTab", converter),
                                textContent: localize(tab.tabName),
                                onclick: () => (dataContent.activeTab = tab),
                            });
                        },
                    }),
                ),
                div(
                    {
                        className: style.center,
                    },
                    collection({
                        className: style.views,
                        sources: this.dataContent.app.views,
                        template: (view) =>
                            div(
                                {
                                    className: new Binding(
                                        dataContent,
                                        "activeView",
                                        new ViewActiveConverter(
                                            view,
                                            style.tab,
                                            `${style.tab} ${style.active}`,
                                        ),
                                    ),
                                    onclick: () => {
                                        this.dataContent.app.activeView = view;
                                    },
                                },
                                div(
                                    {
                                        className: style.name,
                                    },
                                    // span({ textContent: new Binding(view, "name") }),
                                    // span({ textContent: "-", className: style.split }),
                                    span({ textContent: new Binding(view.document, "name") }),
                                ),
                                svg({
                                    className: style.close,
                                    icon: "icon-times",
                                    onclick: (e) => {
                                        e.stopPropagation();
                                        view.close();
                                    },
                                }),
                            ),
                    }),
                    svg({
                        className: style.new,
                        icon: "icon-plus",
                        title: I18n.translate("command.document.new"),
                        onclick: () => PubSub.default.pub("executeCommand", "doc.new"),
                    }),
                ),
                div(
                    { className: style.right },
                    a(
                        {
                            href: "https://github.com/xiangechen/chili3d",
                            target: "_blank",
                        },
                        svg({
                            title: "Github",
                            className: style.icon,
                            icon: "icon-github",
                        }),
                    ),
                ),
            ),
            collection({
                className: style.tabContentPanel,
                sources: dataContent.ribbonTabs,
                template: (tab: RibbonTabData) => {
                    return collection({
                        className: style.groupPanel,
                        sources: tab.groups,
                        style: {
                            display: new Binding(dataContent, "activeTab", new DisplayConverter(tab)),
                        },
                        template: (group: RibbonGroupData) =>
                            div(
                                { className: style.ribbonGroup },
                                collection({
                                    sources: group.items,
                                    className: style.content,
                                    template: (item) => {
                                        if (typeof item === "string") {
                                            return RibbonButton.fromCommandName(item, ButtonSize.large)!;
                                        } else if (item instanceof ObservableCollection) {
                                            let stack = new RibbonStack();
                                            item.forEach((b) => {
                                                let button = RibbonButton.fromCommandName(
                                                    b,
                                                    ButtonSize.small,
                                                );
                                                if (button) stack.append(button);
                                            });
                                            return stack;
                                        } else {
                                            return new RibbonButton(
                                                item.display,
                                                item.icon,
                                                ButtonSize.large,
                                                item.onClick,
                                            );
                                        }
                                    },
                                }),
                                label({
                                    className: style.header,
                                    textContent: localize(group.groupName),
                                }),
                            ),
                    });
                },
            }),
            this._commandContextContainer,
        );
    }

    connectedCallback(): void {
        PubSub.default.sub("openCommandContext", this.openContext);
        PubSub.default.sub("closeCommandContext", this.closeContext);
    }

    disconnectedCallback(): void {
        PubSub.default.remove("openCommandContext", this.openContext);
        PubSub.default.remove("closeCommandContext", this.closeContext);
    }

    private openContext = (command: ICommand) => {
        this._commandContextContainer.append(new CommandContext(command));
    };

    private closeContext = () => {
        this._commandContextContainer.innerHTML = "";
    };
}

customElements.define("chili-ribbon", Ribbon);
