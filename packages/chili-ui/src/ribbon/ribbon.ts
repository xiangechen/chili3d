// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { a, collection, div, label, span, svg } from "chili-controls";
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
    Localize,
    Logger,
    Observable,
    ObservableCollection,
    PubSub,
    Result,
} from "chili-core";
import { CommandContext } from "./commandContext";
import style from "./ribbon.module.css";
import { RibbonButton } from "./ribbonButton";
import { RibbonCommandData, RibbonGroupData, RibbonTabData } from "./ribbonData";
import { RibbonStack } from "./ribbonStack";

export class RibbonDataContent extends Observable {
    readonly quickCommands = new ObservableCollection<CommandKeys>();
    readonly ribbonTabs = new ObservableCollection<RibbonTabData>();
    private _activeTab: RibbonTabData;
    private _activeView: IView | undefined;

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

    get activeTab() {
        return this._activeTab;
    }
    set activeTab(value: RibbonTabData) {
        this.setProperty("activeTab", value);
    }

    get activeView() {
        return this._activeView;
    }
    set activeView(value: IView | undefined) {
        this.setProperty("activeView", value);
    }
}

export const QuickButton = (command: ICommand) => {
    const data = Command.getData(command);
    if (!data) {
        Logger.warn("commandData is undefined");
        return span({ textContent: "null" });
    }

    return svg({
        icon: data.icon,
        title: new Localize(`command.${data.key}`),
        onclick: () => PubSub.default.pub("executeCommand", data.key),
    });
};

class ViewActiveConverter implements IConverter<IView> {
    constructor(
        readonly target: IView,
        readonly style: string,
        readonly activeStyle: string,
    ) {}

    convert(value: IView): Result<string> {
        return Result.ok(this.target === value ? `${this.style} ${this.activeStyle}` : this.style);
    }
}

class ActivedRibbonTabConverter implements IConverter<RibbonTabData> {
    constructor(
        readonly tab: RibbonTabData,
        readonly style: string,
        readonly activeStyle: string,
    ) {}

    convert(value: RibbonTabData): Result<string> {
        return Result.ok(this.tab === value ? `${this.style} ${this.activeStyle}` : this.style);
    }
}

class DisplayConverter implements IConverter<RibbonTabData> {
    constructor(readonly tab: RibbonTabData) {}

    convert(value: RibbonTabData): Result<string> {
        return Result.ok(this.tab === value ? "" : "none");
    }
}

export class Ribbon extends HTMLElement {
    private readonly _commandContext = div({ className: style.commandContextPanel });
    private commandContext?: CommandContext;

    constructor(readonly dataContent: RibbonDataContent) {
        super();
        this.className = style.root;
        this.append(this.header(), this.ribbonTabs(), this._commandContext);
    }

    private header() {
        return div({ className: style.titleBar }, this.leftPanel(), this.centerPanel(), this.rightPanel());
    }

    private leftPanel() {
        return div(
            { className: style.left },
            div(
                { className: style.appIcon, onclick: () => PubSub.default.pub("displayHome", true) },
                svg({ className: style.icon, icon: "icon-chili" }),
                span({ id: "appName", textContent: `Chili3D - v${__APP_VERSION__}` }),
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
                    sources: this.dataContent.quickCommands,
                    template: (command: CommandKeys) => QuickButton(command as any),
                }),
                span({ className: style.split }),
                this.createRibbonHeader(),
            ),
        );
    }

    private createRibbonHeader() {
        return collection({
            sources: this.dataContent.ribbonTabs,
            template: (tab: RibbonTabData) => {
                const converter = new ActivedRibbonTabConverter(tab, style.tabHeader, style.activedTab);
                return label({
                    className: new Binding(this.dataContent, "activeTab", converter),
                    textContent: new Localize(tab.tabName),
                    onclick: () => (this.dataContent.activeTab = tab),
                });
            },
        });
    }

    private centerPanel() {
        return div(
            { className: style.center },
            collection({
                className: style.views,
                sources: this.dataContent.app.views,
                template: (view) => this.createViewItem(view),
            }),
            svg({
                className: style.new,
                icon: "icon-plus",
                title: I18n.translate("command.doc.new"),
                onclick: () => PubSub.default.pub("executeCommand", "doc.new"),
            }),
        );
    }

    private createViewItem(view: IView) {
        return div(
            {
                className: new Binding(
                    this.dataContent,
                    "activeView",
                    new ViewActiveConverter(view, style.tab, style.active),
                ),
                onclick: () => {
                    this.dataContent.app.activeView = view;
                },
            },
            div({ className: style.name }, span({ textContent: new Binding(view.document, "name") })),
            svg({
                className: style.close,
                icon: "icon-times",
                onclick: (e) => {
                    e.stopPropagation();
                    view.close();
                },
            }),
        );
    }

    private rightPanel() {
        return div(
            { className: style.right },
            a(
                { href: "https://github.com/xiangechen/chili3d", target: "_blank" },
                svg({ title: "Github", className: style.icon, icon: "icon-github" }),
            ),
        );
    }

    private ribbonTabs() {
        return collection({
            className: style.tabContentPanel,
            sources: this.dataContent.ribbonTabs,
            template: (tab: RibbonTabData) => this.ribbonTab(tab),
        });
    }

    private ribbonTab(tab: RibbonTabData) {
        return collection({
            className: style.groupPanel,
            sources: tab.groups,
            style: {
                display: new Binding(this.dataContent, "activeTab", new DisplayConverter(tab)),
            },
            template: (group: RibbonGroupData) => this.ribbonGroup(group),
        });
    }

    private ribbonGroup(group: RibbonGroupData) {
        return div(
            { className: style.ribbonGroup },
            collection({
                sources: group.items,
                className: style.content,
                template: (item) => this.ribbonButton(item),
            }),
            label({ className: style.header, textContent: new Localize(group.groupName) }),
        );
    }

    private ribbonButton(item: RibbonCommandData) {
        if (typeof item === "string") {
            return RibbonButton.fromCommandName(item, ButtonSize.large)!;
        } else if (item instanceof ObservableCollection) {
            const stack = new RibbonStack();
            item.forEach((b) => {
                const button = RibbonButton.fromCommandName(b, ButtonSize.small);
                if (button) stack.append(button);
            });
            return stack;
        } else {
            return new RibbonButton(item.display, item.icon, ButtonSize.large, item.onClick);
        }
    }

    connectedCallback(): void {
        PubSub.default.sub("openCommandContext", this.openContext);
        PubSub.default.sub("closeCommandContext", this.closeContext);
    }

    disconnectedCallback(): void {
        PubSub.default.remove("openCommandContext", this.openContext);
        PubSub.default.remove("closeCommandContext", this.closeContext);
    }

    private readonly openContext = (command: ICommand) => {
        if (this.commandContext) {
            this.closeContext();
        }
        this.commandContext = new CommandContext(command);
        this._commandContext.append(this.commandContext);
    };

    private readonly closeContext = () => {
        this.commandContext?.remove();
        this.commandContext?.dispose();
        this.commandContext = undefined;
        this._commandContext.innerHTML = "";
    };
}

customElements.define("chili-ribbon", Ribbon);
