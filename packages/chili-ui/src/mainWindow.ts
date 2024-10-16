// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

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

document.oncontextmenu = (e) => e.preventDefault();

export class MainWindow implements IWindow {
    private _inited: boolean = false;
    private _home?: Home;
    private _editor?: Editor;

    constructor(readonly tabs: RibbonTab[]) {
        this.setTheme("light");
    }

    async init(app: IApplication) {
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

    private displayHome = (app: IApplication, displayHome: boolean) => {
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
