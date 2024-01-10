// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { CommandKeys } from "chili-core";
import { div } from "./controls";
import style from "./editor.module.css";
import { ProjectView } from "./project";
import { PropertyView } from "./property";
import { Ribbon, RibbonDataContent } from "./ribbon";
import { Statusbar } from "./statusbar";
import { Viewport } from "./viewport";
import { RibbonTabData } from "./ribbon/ribbonData";
import { DefaultRibbon } from "./profile/ribbon";

let quickCommands: CommandKeys[] = ["doc.save", "doc.saveToFile", "edit.undo", "edit.redo"];
let ribbonTabs = DefaultRibbon.map((p) => RibbonTabData.fromProfile(p));
let content = new RibbonDataContent(quickCommands, ribbonTabs);

export const Editor = () => {
    let viewport = new Viewport();
    viewport.classList.add(style.viewport);
    return div(
        { className: style.root },
        new Ribbon(content),
        div(
            { className: style.content },
            div(
                { className: style.sidebar },
                new ProjectView().addClass(style.sidebarItem),
                new PropertyView().addClass(style.sidebarItem),
            ),
            viewport,
        ),
        new Statusbar().addClass(style.statusbar),
    );
};
