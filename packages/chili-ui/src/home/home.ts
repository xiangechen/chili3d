// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Constants, IApplication, PubSub, RecentDocumentDTO } from "chili-core";
import { LanguageSelector } from "../components";
import { a, button, div, img, items, label, localize, span } from "../controls";
import style from "./home.module.css";

export const Home = async (app: IApplication) => {
    let documents = await app.storage.page(Constants.DBName, Constants.RecentTable, 0);

    return div(
        { className: style.root },
        div(
            { className: style.left },
            div(
                { className: style.top },
                button({
                    textContent: localize("command.document.new"),
                    onclick: () => PubSub.default.pub("executeCommand", "doc.new"),
                }),
                button({
                    textContent: localize("command.document.open"),
                    onclick: () => PubSub.default.pub("executeCommand", "doc.open"),
                }),
            ),
            div(
                { className: style.bottom },
                a({
                    textContent: "Github",
                    href: "https://github.com/xiangechen/chili3d",
                    target: "_blank",
                }),
                a({
                    textContent: "Gitee",
                    href: "https://gitee.com/chenxiange/chili3d",
                    target: "_blank",
                }),
            ),
        ),
        div(
            { className: style.right },
            label({ className: style.welcome, textContent: localize("home.welcome") }),
            div({ className: style.recent, textContent: localize("home.recent") }),
            items({
                className: style.documents,
                sources: documents,
                template: (item: RecentDocumentDTO) =>
                    div(
                        {
                            className: style.document,
                            onclick: () => app.openDocument(item.id),
                        },
                        img({ className: style.img, src: item.image }),
                        div(
                            { className: style.description },
                            span({ className: style.title, textContent: item.name }),
                            span({
                                className: style.date,
                                textContent: new Date(item.date).toLocaleDateString(),
                            }),
                        ),
                    ),
            }),
        ),
        LanguageSelector({ className: style.language }),
    );
};
