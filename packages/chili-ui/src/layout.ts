import { PubSub } from "chili-core";
import { Panel } from "./components";
import { Ribbon } from "./ribbon";
import { Sidebar } from "./sidebar";

import style from "./layout.module.css";
import { Viewport } from "./viewport";

export class Layout {
    readonly root: HTMLElement | null;
    ribbon: any;
    constructor() {
        this.setTheme("light");
        this.root = this.initRoot();
    }

    private initRoot() {
        const root = document.getElementById("root");
        if (root !== null) {
            root.focus();
            root.className = style.root;
            this.render();
            root.addEventListener("keydown", this.handleKeyDown);
            root.addEventListener("keyup", this.handleKeyUp);
        }
        return root;
    }

    private handleKeyDown = (e: KeyboardEvent) => {
        PubSub.default.pub("keyDown", e);
    };

    private handleKeyUp = (e: KeyboardEvent) => {
        PubSub.default.pub("keyUp", e);
    };

    render() {
        this.root?.append(
            new Ribbon(),
            new Panel()
                .addClass(style.content)
                .addItem(new Sidebar().addClass(style.sidebar), Viewport.current.addClass(style.viewport)),
            new Panel().addClass(style.statusbar)
        );
    }

    setTheme(theme: "light" | "dark") {
        let doc = document.documentElement;
        doc.setAttribute("theme", theme);
    }
}
