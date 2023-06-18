// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IStorage, Lazy } from "chili-core";
import { Editor } from "./editor";
import { Home } from "./home";
import style from "./ui.module.css";

export class UI {
    private static readonly _lazy = new Lazy(() => new UI());

    static get instance() {
        return this._lazy.value;
    }

    private constructor() {}

    init(storage: IStorage, root: HTMLElement) {
        this.setTheme("light");
        root.className = style.root;
        root.append(
            //new Home(storage),
            new Editor()
        );
    }

    setTheme(theme: "light" | "dark") {
        let doc = document.documentElement;
        doc.setAttribute("theme", theme);
    }
}
