// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { div } from "./controls";
import style from "./editor.module.css";
import { ProjectView } from "./project";
import { PropertyView } from "./property";
import { Ribbon } from "./ribbon";
import { Statusbar } from "./statusbar";
import { Viewport } from "./viewport";

export const Editor = () =>
    div(
        { className: style.panel },
        new Ribbon(),
        div(
            { className: style.content },
            div(
                { className: style.sidebar },
                new ProjectView().addClass(style.sidebarItem),
                new PropertyView().addClass(style.sidebarItem)
            ),
            new Viewport().addClass(style.viewport)
        ),
        new Statusbar().addClass(style.statusbar)
    );
