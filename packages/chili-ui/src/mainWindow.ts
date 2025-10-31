// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    Button,
    CommandKeys,
    I18nKeys,
    IApplication,
    IWindow,
    PubSub,
    RibbonTab,
    debounce,
} from "chili-core";
import { Dialog } from "./dialog";
import { Editor } from "./editor";
import { Home } from "./home";
import { Permanent } from "./permanent";
import { Toast } from "./toast";

export class MainWindow implements IWindow {
    private _inited: boolean = false;
    private _home?: Home;
    private _editor?: Editor;

    readonly dom: HTMLElement;

    constructor(
        readonly tabs: RibbonTab[],
        dom?: HTMLElement,
    ) {
        this.dom = this.ensureDom(dom);
    }

    protected ensureDom(dom?: HTMLElement) {
        if (!dom) {
            dom = document.createElement("div");
            dom.id = "chili3d-main-window";
            dom.style.cssText = `
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                tab-index: 0;
            `;
            document.body.appendChild(dom);
        }

        dom.oncontextmenu = (e) => {
            e.preventDefault();
            e.stopPropagation();
        };
        dom.addEventListener("scroll", (e) => {
            dom.scrollTop = 0;
        });
        return dom;
    }

    init(app: IApplication) {
        if (this._inited) {
            throw new Error("MainWindow is already inited");
        }
        this._inited = true;
        this._initHome(app);
        this._initEditor(app);
        this._initSubs(app);
    }

    private _initSubs(app: IApplication) {
        const displayHome = debounce(this.displayHome, 100);
        PubSub.default.sub("showToast", Toast.info);
        PubSub.default.sub("displayError", Toast.error);
        PubSub.default.sub("showDialog", Dialog.show);
        PubSub.default.sub("showPermanent", Permanent.show);
        PubSub.default.sub("activeViewChanged", (view) => displayHome(app, view === undefined));
        PubSub.default.sub("displayHome", (show) => displayHome(app, show));
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

    setTheme(theme: "light" | "dark") {
        document.documentElement.setAttribute("theme", theme);
    }
}
