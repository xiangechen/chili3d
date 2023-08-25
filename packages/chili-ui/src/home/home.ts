// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { ObservableCollection, PubSub, RecentDocumentDTO } from "chili-core";
import { LanguageSelector } from "../components";
import { Items } from "../components/items";
import { a, button, div, img, label, localize, span } from "../controls";
import style from "./home.module.css";

export interface HomeOption {
    documents: ObservableCollection<RecentDocumentDTO>;
    onDocumentClick: (document: RecentDocumentDTO) => void;
}

export const Home = (options: HomeOption) => {
    return div(
        { className: style.root },
        div(
            { className: style.left },
            div(
                { className: style.top },
                button({
                    className: style.button,
                    textContent: localize("command.document.new"),
                    onclick: () => PubSub.default.pub("executeCommand", "doc.new"),
                }),
                button({
                    className: style.button,
                    textContent: localize("command.document.open"),
                    onclick: () => PubSub.default.pub("executeCommand", "doc.open"),
                })
            ),
            div(
                { className: style.bottom },
                a({
                    className: style.link,
                    textContent: "Github",
                    href: "https://github.com/xiangechen/chili3d",
                }),
                a({
                    className: style.link,
                    textContent: "Gitee",
                    href: "https://gitee.com/chenxiange/chili3d",
                })
            )
        ),
        div(
            { className: style.right },
            label({ className: style.welcome, textContent: localize("home.welcome") }),
            div({ className: style.recent, textContent: localize("home.recent") }),
            Items({
                className: style.documents,
                sources: options.documents,
                template: (item: RecentDocumentDTO) =>
                    div(
                        {
                            className: style.document,
                            onclick: () => options.onDocumentClick(item),
                        },
                        img({ className: style.img, src: item.image }),
                        div(
                            { className: style.description },
                            span({ className: style.title, textContent: item.name }),
                            span({
                                className: style.date,
                                textContent: new Date(item.date).toLocaleDateString(),
                            })
                        )
                    ),
            })
        ),
        LanguageSelector({ className: style.language })
    );
};
