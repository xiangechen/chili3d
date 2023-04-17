import { PubSub } from "chili-core";
import { Panel } from "./components";
import { Ribbon } from "./ribbon";
import { Sidebar } from "./sidebar";
import { Viewport } from "./viewport";
import { Statusbar } from "./statusbar";
import style from "./ui.module.css";

export class UI {
    readonly root: HTMLElement | null;
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
            new Statusbar().addClass(style.statusbar)
        );
    }

    setTheme(theme: "light" | "dark") {
        let doc = document.documentElement;
        doc.setAttribute("theme", theme);
    }
}
