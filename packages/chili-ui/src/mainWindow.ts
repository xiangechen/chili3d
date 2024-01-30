// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IApplication, PubSub, debounce } from "chili-core";
import { Dialog } from "./dialog";
import { Editor } from "./editor";
import { Home } from "./home";
import { Toast } from "./toast";

document.oncontextmenu = (e) => e.preventDefault();

export class MainWindow {
    private static readonly _instance = new MainWindow();
    static get instance() {
        return this._instance;
    }

    private _home?: HTMLElement;

    private constructor() {
        this.setTheme("light");
        document.body.append(Editor());
    }

    async init(app: IApplication) {
        this._initHome(app);
        const displayHome = debounce(this.displayHome, 100);
        PubSub.default.sub("showToast", Toast.show);
        PubSub.default.sub("showDialog", Dialog.show);
        PubSub.default.sub("activeDocumentChanged", (doc) => displayHome(app, doc === undefined));
        PubSub.default.sub("showHome", () => displayHome(app, true));
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
        this._home = await Home(app);
        document.body.append(this._home);
    }

    setTheme(theme: "light" | "dark") {
        document.documentElement.setAttribute("theme", theme);
    }
}
