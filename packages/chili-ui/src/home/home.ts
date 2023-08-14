// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IStorage, PubSub } from "chili-core";
import { button, div, label, localize } from "../controls";
import style from "./home.module.css";

export const Home = (storage: IStorage) => {
    return div(
        { className: style.root },
        div(
            { className: style.left },
            div({ className: style.logo }, "Chili 3D"),
            button({
                className: style.button,
                textContent: localize("command.newFolder"),
                onclick: () => PubSub.default.pub("executeCommand", "NewDocument"),
            }),
            button({
                className: style.button,
                textContent: localize("command.open"),
                onclick: () => PubSub.default.pub("executeCommand", "OpenDocument"),
            })
        ),
        div(
            { className: style.right },
            label({ className: style.welcome, textContent: "Welcome to Chili 3D" }),
            div({ className: style.recent })
        )
    );
};
