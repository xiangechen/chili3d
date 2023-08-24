// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    Constants,
    I18n,
    IApplication,
    Lazy,
    Observable,
    ObservableCollection,
    PubSub,
    RecentDocumentDTO,
    i18n,
} from "chili-core";
import { div, useState } from "./controls";
import { Editor } from "./editor";
import { Home } from "./home";
import style from "./mainWindow.module.css";

class MainWindowViewModel extends Observable {
    private _displayHome: boolean = true;
    get displayHome() {
        return this._displayHome;
    }
    set displayHome(value: boolean) {
        this.setProperty("displayHome", value);
    }

    constructor() {
        super();
        PubSub.default.sub("activeDocumentChanged", () => (this.displayHome = false));
        PubSub.default.sub("showHome", () => (this.displayHome = true));
    }
}

export class MainWindow {
    static readonly #lazy = new Lazy(() => new MainWindow());
    static get instance() {
        return this.#lazy.value;
    }

    #app?: IApplication;
    #home: HTMLElement;
    #editor: HTMLElement;
    #toastContainer: HTMLElement;
    #toastText = useState("");
    #toastTimeoutId: NodeJS.Timeout | undefined;
    readonly #vm: MainWindowViewModel = new MainWindowViewModel();
    readonly #documents = new ObservableCollection<RecentDocumentDTO>();

    private constructor() {
        this.#home = Home({ documents: this.#documents, onDocumentClick: this.onDocumentClick });
        this.#editor = Editor();
        this.#toastContainer = div(
            {
                className: style.toast,
                style: {
                    display: "none",
                },
            },
            div({
                className: style.toastText,
                textContent: this.#toastText[0],
            })
        );
    }

    async init(app: IApplication, root: HTMLElement) {
        this.#app = app;
        this.setTheme("light");
        root.append(this.#home, this.#editor, this.#toastContainer);

        this.#vm.onPropertyChanged(this.onPropertyChanged);
        this.setHomeDisplay();

        PubSub.default.sub("showToast", this.showToast);
    }

    private showToast = (message: keyof I18n) => {
        if (this.#toastTimeoutId) clearTimeout(this.#toastTimeoutId);
        this.#toastText[1](i18n[message]);
        this.#toastContainer.style.display = "";
        this.#toastTimeoutId = setTimeout(() => {
            this.#toastTimeoutId = undefined;
            this.#toastContainer.style.display = "none";
        }, 2000);
    };

    private onDocumentClick = (document: RecentDocumentDTO) => {
        this.#app?.openDocument(document.id);
    };

    private onPropertyChanged = (p: keyof MainWindowViewModel) => {
        if (p === "displayHome") {
            this.setHomeDisplay();
        }
    };

    private async setHomeDisplay() {
        this.#home.style.display = this.#vm.displayHome ? "" : "none";
        if (this.#vm.displayHome && this.#app) {
            this.#documents.clear();
            let datas = await this.#app.storage.page(Constants.DBName, Constants.RecentTable, 0);
            this.#documents.add(...datas);
        }
    }

    setTheme(theme: "light" | "dark") {
        let doc = document.documentElement;
        doc.setAttribute("theme", theme);
    }
}
