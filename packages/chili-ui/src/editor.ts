// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Button, CommandKeys, I18nKeys, IApplication } from "chili-core";
import { div } from "./controls";
import style from "./editor.module.css";
import { DefaultRibbon } from "./profile/ribbon";
import { ProjectView } from "./project";
import { PropertyView } from "./property";
import { Ribbon, RibbonDataContent } from "./ribbon";
import { RibbonTabData } from "./ribbon/ribbonData";
import { Statusbar } from "./statusbar";
import { LayoutViewport } from "./viewport";

let quickCommands: CommandKeys[] = ["doc.save", "doc.saveToFile", "edit.undo", "edit.redo"];
let ribbonTabs = DefaultRibbon.map((p) => RibbonTabData.fromProfile(p));

export class Editor extends HTMLElement {
    readonly ribbonContent: RibbonDataContent;

    constructor(app: IApplication) {
        super();
        let viewport = new LayoutViewport(app);
        viewport.classList.add(style.viewport);
        this.ribbonContent = new RibbonDataContent(app, quickCommands, ribbonTabs);
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
                new Statusbar().addClass(style.statusbar),
            ),
        );
        document.body.appendChild(this);
    }

    registerRibbonCommand(tabName: I18nKeys, groupName: I18nKeys, command: CommandKeys | Button) {
        this.ribbonContent.ribbonTabs
            .find((p) => p.tabName === tabName)
            ?.groups.find((p) => p.groupName === groupName)
            ?.items.push(command);
    }
}

customElements.define("chili-editor", Editor);
