// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    Constants,
    IApplication,
    Lazy,
    Observable,
    ObservableCollection,
    PubSub,
    RecentDocumentDTO,
} from "chili-core";
import { Editor } from "./editor";
import { Home } from "./home";

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
    readonly #vm: MainWindowViewModel = new MainWindowViewModel();
    readonly #documents = new ObservableCollection<RecentDocumentDTO>();

    private constructor() {
        this.#home = Home({ documents: this.#documents, onDocumentClick: this.onDocumentClick });
        this.#editor = new Editor();
    }

    async init(app: IApplication, root: HTMLElement) {
        this.#app = app;
        this.setTheme("light");
        root.append(this.#home, this.#editor);

        this.#vm.onPropertyChanged(this.onPropertyChanged);
        this.setHomeDisplay();
    }

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
