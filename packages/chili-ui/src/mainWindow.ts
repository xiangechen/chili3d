// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type Button,
    type CommandKeys,
    Config,
    debounce,
    I18n,
    type I18nKeys,
    type IApplication,
    type IWindow,
    PubSub,
    type RibbonTab,
} from "chili-core";
import { Dialog } from "./dialog";
import { Editor } from "./editor";
import { Home } from "./home";
import { Permanent } from "./permanent";
import { Toast } from "./toast";

export class MainWindow extends HTMLElement implements IWindow {
    private _inited: boolean = false;
    private _home?: Home;
    private _editor?: Editor;

    constructor(
        readonly tabs: RibbonTab[],
        readonly iconFont: string,
        dom?: HTMLElement,
    ) {
        super();
        this.tabIndex = 0;
        this.ensureDom(dom);
    }

    protected ensureDom(dom?: HTMLElement) {
        if (dom) {
            dom.append(this);
        } else {
            document.body.appendChild(this);
        }

        this.oncontextmenu = (e) => {
            e.preventDefault();
            e.stopPropagation();
        };
        this.addEventListener("scroll", (e) => {
            this.scrollTop = 0;
        });
    }

    async init(app: IApplication): Promise<void> {
        if (this._inited) {
            throw new Error("MainWindow is already inited");
        }
        this._inited = true;

        I18n.changeLanguage(Config.instance.language);

        await this.loadCss();
        await this.fetchIconFont();

        this.applyTheme();
        await this._initHome(app);
        this._initEditor(app);
        this._initEventHandlers(app);
    }

    protected async loadCss() {
        await import("./mainWindow.module.css");
    }

    protected async fetchIconFont() {
        const response = await fetch(this.iconFont);
        const text = await response.text();

        new Function(text)();
    }

    private _initEventHandlers(app: IApplication) {
        const displayHome = debounce(this.displayHome, 100);
        PubSub.default.sub("showToast", Toast.info);
        PubSub.default.sub("displayError", Toast.error);
        PubSub.default.sub("showDialog", Dialog.show);
        PubSub.default.sub("showPermanent", Permanent.show);
        PubSub.default.sub("activeViewChanged", (view) => displayHome(app, view === undefined));
        PubSub.default.sub("displayHome", (show) => displayHome(app, show));

        Config.instance.onPropertyChanged(this.handleConfigChanged);
        window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener("change", () => {
            if (Config.instance.themeMode === "system") {
                this.applyTheme();
            }
        });
    }

    private readonly displayHome = (app: IApplication, displayHome: boolean) => {
        if (this._home) {
            this._home.remove();
            this._home = undefined;
        }
        if (displayHome) {
            this._initHome(app);
        }
    };

    private async _initHome(app: IApplication) {
        this._home = new Home(app);
        await this._home.render();
    }

    private async _initEditor(app: IApplication) {
        this._editor = new Editor(app, this.tabs);
    }

    registerHomeCommand(groupName: I18nKeys, command: CommandKeys | Button): void {
        throw new Error("Method not implemented.");
    }

    registerRibbonCommand(tabName: I18nKeys, groupName: I18nKeys, command: CommandKeys | Button) {
        this._editor?.registerRibbonCommand(tabName, groupName, command);
    }

    private applyTheme() {
        const themeMode = Config.instance.themeMode;
        let theme: "light" | "dark";

        if (themeMode === "system") {
            theme = window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
        } else {
            theme = themeMode;
        }

        document.documentElement.setAttribute("theme", theme);
    }

    private readonly handleConfigChanged = (prop: keyof Config) => {
        if (prop === "themeMode") {
            this.applyTheme();
        }

        if (prop === "language") {
            I18n.changeLanguage(Config.instance.language);
        }

        const shouldSaveProps: (keyof Config)[] = ["themeMode", "language", "navigation3D"];
        if (shouldSaveProps.includes(prop)) {
            Config.instance.saveToStorage();
        }
    };
}

customElements.define("chili3d-main-window", MainWindow);
