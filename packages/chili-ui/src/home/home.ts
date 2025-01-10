// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    Constants,
    I18n,
    I18nKeys,
    IApplication,
    ObservableCollection,
    PubSub,
    RecentDocumentDTO,
} from "chili-core";
import {
    LanguageSelector,
    a,
    button,
    collection,
    div,
    img,
    label,
    localize,
    span,
    svg,
} from "../components";
import style from "./home.module.css";

interface ApplicationCommand {
    display: I18nKeys;
    icon?: string;
    onclick: () => void;
}

const applicationCommands = new ObservableCollection<ApplicationCommand>(
    {
        display: "command.document.new",
        onclick: () => PubSub.default.pub("executeCommand", "doc.new"),
    },
    {
        display: "command.document.open",
        onclick: () => PubSub.default.pub("executeCommand", "doc.open"),
    },
);

export class Home extends HTMLElement {
    constructor(readonly app: IApplication) {
        super();
        this.className = style.root;
    }

    private hasOpen(documentId: string) {
        for (const document of this.app.documents) {
            if (document.id === documentId) return true;
        }
        return false;
    }

    private async getDocuments() {
        let documentArray: RecentDocumentDTO[] = await this.app.storage.page(
            Constants.DBName,
            Constants.RecentTable,
            0,
        );
        return new ObservableCollection(...documentArray);
    }

    async render() {
        let documents = await this.getDocuments();
        this.append(
            div(
                { className: style.left },
                div(
                    { className: style.top },
                    div(
                        { className: style.logo },
                        svg({ icon: "icon-chili" }),
                        span({
                            textContent: "CHILI3D",
                        }),
                        span({
                            className: style.version,
                            textContent: __APP_VERSION__,
                        }),
                    ),
                    collection({
                        className: style.buttons,
                        sources: applicationCommands,
                        template: (item) =>
                            button({
                                className: style.button,
                                textContent: localize(item.display),
                                onclick: item.onclick,
                            }),
                    }),
                    this.app.activeView?.document
                        ? button({
                              className: `${style.button} ${style.back}`,
                              textContent: localize("common.back"),
                              onclick: () => {
                                  PubSub.default.pub("displayHome", false);
                              },
                          })
                        : "",
                ),
                div(
                    { className: style.bottom },
                    a({
                        textContent: "Github",
                        href: "https://github.com/xiangechen/chili3d",
                        target: "_blank",
                    }),
                ),
            ),
            div(
                { className: style.right },
                label({ className: style.welcome, textContent: localize("home.welcome") }),
                div({ className: style.recent, textContent: localize("home.recent") }),
                collection({
                    className: style.documents,
                    sources: documents,
                    template: (item) =>
                        div(
                            {
                                className: style.document,
                                onclick: () => {
                                    if (this.hasOpen(item.id)) {
                                        PubSub.default.pub("displayHome", false);
                                    } else {
                                        PubSub.default.pub(
                                            "showPermanent",
                                            async () => {
                                                let document = await this.app.openDocument(item.id);
                                                await document?.application.activeView?.fitContent();
                                            },
                                            "toast.excuting{0}",
                                            I18n.translate("command.document.open"),
                                        );
                                    }
                                },
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
                            svg({
                                className: style.delete,
                                icon: "icon-times",
                                onclick: async (e) => {
                                    e.stopPropagation();
                                    if (
                                        window.confirm(I18n.translate("prompt.deleteDocument{0}", item.name))
                                    ) {
                                        await this.app.storage.delete(
                                            Constants.DBName,
                                            Constants.DocumentTable,
                                            item.id,
                                        );
                                        await this.app.storage.delete(
                                            Constants.DBName,
                                            Constants.RecentTable,
                                            item.id,
                                        );
                                        documents.remove(item);
                                    }
                                },
                            }),
                        ),
                }),
            ),
            LanguageSelector({ className: style.language }),
        );
        document.body.appendChild(this);
    }
}

customElements.define("chili-home", Home);
