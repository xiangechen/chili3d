// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Button, CommandKeys, I18nKeys, IApplication, RibbonTab } from "chili-core";
import { div } from "./components";
import style from "./editor.module.css";
import { ProjectView } from "./project";
import { PropertyView } from "./property";
import { Ribbon, RibbonDataContent } from "./ribbon";
import { RibbonTabData } from "./ribbon/ribbonData";
import { Statusbar } from "./statusbar";
import { LayoutViewport } from "./viewport";

let quickCommands: CommandKeys[] = ["doc.save", "doc.saveToFile", "edit.undo", "edit.redo"];

export class Editor extends HTMLElement {
    readonly ribbonContent: RibbonDataContent;

    constructor(app: IApplication, tabs: RibbonTab[]) {
        super();
        const viewport = new LayoutViewport(app);
        viewport.classList.add(style.viewport);

        this.ribbonContent = new RibbonDataContent(app, quickCommands, tabs.map(RibbonTabData.fromProfile));

        this.render(viewport);
        document.body.appendChild(this);
    }

    private render(viewport: LayoutViewport) {
        this.append(
            div(
                { className: style.root },
                new Ribbon(this.ribbonContent),
                div(
                    { className: style.content },
                    div(
                        { className: style.sidebar },
                        new ProjectView({ className: style.sidebarItem }),
                        new PropertyView({ className: style.sidebarItem }),
                    ),
                    viewport,
                ),
                new Statusbar(style.statusbar),
            ),
        );
    }

    registerRibbonCommand(tabName: I18nKeys, groupName: I18nKeys, command: CommandKeys | Button) {
        const tab = this.ribbonContent.ribbonTabs.find((p) => p.tabName === tabName);
        const group = tab?.groups.find((p) => p.groupName === groupName);
        group?.items.push(command);
    }
}

customElements.define("chili-editor", Editor);
