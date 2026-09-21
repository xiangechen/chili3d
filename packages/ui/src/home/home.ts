// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    CAMERA_FLY_DURATION,
    Constants,
    I18n,
    type I18nKeys,
    type IApplication,
    Localize,
    ObservableCollection,
    PubSub,
    type RecentDocumentDTO,
} from "@chili3d/core";
import { a, button, collection, div, img, label, span, svg } from "@chili3d/element";
import style from "./home.module.css";
import { LanguageSelector } from "./languageSelector";
import { Navigation3DSelector } from "./navigation3DSelector";
import { ThemeSelector } from "./themeSelector";

interface ApplicationCommand {
    display: I18nKeys;
    icon: string;
    onclick: () => void;
}

interface VideoItem {
    title: string;
    thumbnail: string;
    url: string;
    date: string;
}

interface VideoSectionData {
    items: VideoItem[];
    moreUrl?: string;
}

interface VideoData {
    recent: VideoSectionData;
    cases: VideoSectionData;
}

let videoDataCache: VideoData | null = null;

const applicationCommands = new ObservableCollection<ApplicationCommand>(
    {
        display: "command.doc.new",
        icon: "icon-plus",
        onclick: () => PubSub.default.pub("executeCommand", "doc.new"),
    },
    {
        display: "command.doc.open",
        icon: "icon-folder",
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

    private async getVideoData(): Promise<VideoData> {
        if (videoDataCache) return videoDataCache;
        try {
            const response = await fetch("/videos.json");
            videoDataCache = (await response.json()) as VideoData;
            return videoDataCache;
        } catch {
            return { recent: { items: [] }, cases: { items: [] } };
        }
    }

    private async getDocuments() {
        return new ObservableCollection(
            ...(await this.app.storage.page(Constants.DBName, Constants.RecentTable, 0)),
        );
    }

    async render() {
        const documents = await this.getDocuments();
        const videoData = await this.getVideoData();
        this.append(this.leftSection(), this.rightSection(documents, videoData));
        this.app.mainWindow?.appendChild(this);
    }

    private leftSection() {
        return div(
            { className: style.left },
            div(
                { className: style.top },
                this.logoSection(),
                this.applicationCommands(),
                this.currentDocument(),
            ),

            this.settings(),
            this.links(),
        );
    }

    private logoSection() {
        return div(
            { className: style.logo },
            svg({ icon: "icon-chili" }),
            div(
                { className: style.logoText },
                span({ className: style.wordmark, textContent: "CHILI3D" }),
                span({ className: style.version, textContent: `v${__APP_VERSION__}` }),
            ),
        );
    }

    private applicationCommands() {
        return collection({
            className: style.buttons,
            sources: applicationCommands,
            template: (item) =>
                button(
                    {
                        className: style.button,
                        onclick: item.onclick,
                    },
                    svg({ icon: item.icon }),
                    span({ textContent: new Localize(item.display) }),
                ),
        });
    }

    private currentDocument() {
        return this.app.activeView?.document
            ? button(
                  {
                      className: `${style.button} ${style.back}`,
                      onclick: () => {
                          PubSub.default.pub("displayHome", false);
                      },
                  },
                  svg({ icon: "icon-back" }),
                  span({ textContent: new Localize("common.back") }),
              )
            : "";
    }

    private settings() {
        return div(
            { className: style.settingsPanel },
            div(
                { className: style.settingItem },
                span({
                    className: style.settingLabel,
                    textContent: new Localize("common.language"),
                }),
                div({ className: style.settingControl }, LanguageSelector({})),
            ),
            div(
                { className: style.settingItem },
                span({
                    className: style.settingLabel,
                    textContent: new Localize("common.theme"),
                }),
                div({ className: style.settingControl }, ThemeSelector({})),
            ),
            div(
                { className: style.settingItem },
                span({
                    className: style.settingLabel,
                    textContent: new Localize("common.3DNavigation"),
                }),
                div({ className: style.settingControl }, Navigation3DSelector({})),
            ),
        );
    }

    private links() {
        return div(
            { className: style.socialPanel },
            a(
                {
                    className: style.socialItem,
                    href: "https://github.com/xiangechen/chili3d",
                    target: "_blank",
                    rel: "noopener noreferrer",
                },
                svg({ icon: "icon-github" }),
                label({ textContent: "GitHub" }),
            ),
            button(
                {
                    className: style.socialItem,
                    onclick: () => {
                        PubSub.default.pub("executeCommand", "wechat.group");
                    },
                },
                svg({
                    icon: "icon-wechatGroup",
                }),
                label({ textContent: new Localize("command.wechat.group") }),
            ),
        );
    }

    private rightSection(documents: ObservableCollection<RecentDocumentDTO>, videoData: VideoData) {
        return div(
            { className: style.right },
            div(
                { className: style.page },
                div(
                    { className: style.header },
                    div({ className: style.welcome, textContent: new Localize("home.welcome") }),
                    div({ className: style.subtitle, textContent: new Localize("home.welcome.subtitle") }),
                ),
                div(
                    { className: style.contentRow },
                    div(
                        { className: style.recentColumn },
                        div({ className: style.sectionTitle, textContent: new Localize("home.recent") }),
                        this.documentCollection(documents),
                    ),
                    this.videoColumn(videoData),
                ),
            ),
        );
    }

    private videoColumn(videoData: VideoData) {
        const sections = (
            [
                ["home.videos.recent", videoData.recent],
                ["home.videos.cases", videoData.cases],
            ] as [I18nKeys, VideoSectionData][]
        ).filter(([, data]) => data.items.length > 0);
        if (sections.length === 0) return "";

        return div(
            { className: style.videoColumn },
            div({ className: style.sectionTitle, textContent: new Localize("home.videos") }),
            div(
                { className: style.videoScroll },
                ...sections.map(([key, data]) => this.videoSection(key, data)),
            ),
        );
    }

    private videoSectionHeader(titleKey: I18nKeys, data: VideoSectionData) {
        return div(
            { className: style.videoSectionHeader },
            div({ className: style.sectionVideo, textContent: new Localize(titleKey) }),
            data.moreUrl
                ? a({
                      className: style.moreLink,
                      href: data.moreUrl,
                      target: "_blank",
                      rel: "noopener noreferrer",
                      textContent: new Localize("home.videos.more"),
                  })
                : "",
        );
    }

    private videoSection(titleKey: I18nKeys, data: VideoSectionData) {
        return div(
            { className: style.videoSection },
            this.videoSectionHeader(titleKey, data),
            div({ className: style.videos }, ...data.items.map((video) => this.videoCard(video))),
        );
    }

    private createThumbnail(src: string, alt: string): HTMLImageElement {
        const thumbnail = document.createElement("img");
        thumbnail.className = style.videoImg;
        thumbnail.alt = alt;
        thumbnail.setAttribute("referrerpolicy", "no-referrer");
        thumbnail.src = src;
        return thumbnail;
    }

    private videoCard(video: VideoItem) {
        return a(
            {
                className: style.video,
                href: video.url,
                target: "_blank",
                rel: "noopener noreferrer",
            },
            div(
                { className: style.videoThumbnail },
                this.createThumbnail(video.thumbnail, video.title),
                div({ className: style.playOverlay }),
                div({ className: style.playIcon }),
            ),
            div(
                { className: style.videoMeta },
                span({ className: style.videoItemTitle, textContent: video.title }),
                span({ className: style.videoDate, textContent: video.date }),
            ),
        );
    }

    private documentCollection(documents: ObservableCollection<RecentDocumentDTO>) {
        if (documents.length === 0) {
            return div({
                className: style.empty,
                textContent: new Localize("home.recent.empty"),
            });
        }
        return collection({
            className: style.documents,
            sources: documents,
            template: (item) => this.recentDocument(item, documents),
        });
    }

    private recentDocument(item: RecentDocumentDTO, documents: ObservableCollection<RecentDocumentDTO>) {
        return div(
            {
                className: style.document,
                onclick: () => this.handleDocumentClick(item),
            },
            img({ className: style.img, src: item.image }),
            this.documentDescription(item),
            this.deleteIcon(item, documents),
        );
    }

    private documentDescription(item: RecentDocumentDTO) {
        return div(
            { className: style.description },
            span({ className: style.title, textContent: item.name }),
            span({
                className: style.date,
                textContent: new Date(item.date).toLocaleDateString(),
            }),
        );
    }

    private deleteIcon(item: RecentDocumentDTO, documents: ObservableCollection<RecentDocumentDTO>) {
        return svg({
            className: style.delete,
            icon: "icon-times",
            onclick: async (e) => {
                e.stopPropagation();
                if (window.confirm(I18n.translate("prompt.deleteDocument{0}", item.name))) {
                    await Promise.all([
                        this.app.storage.delete(Constants.DBName, Constants.DocumentTable, item.id),
                        this.app.storage.delete(Constants.DBName, Constants.RecentTable, item.id),
                    ]);
                    documents.remove(item);
                }
            },
        });
    }

    private handleDocumentClick(item: RecentDocumentDTO) {
        if (this.hasOpen(item.id)) {
            PubSub.default.pub("displayHome", false);
        } else {
            PubSub.default.pub(
                "showPermanent",
                async () => {
                    const document = await this.app.openDocument(item.id);
                    document?.application.activeView?.cameraController.fitContent({
                        duration: CAMERA_FLY_DURATION,
                    });
                },
                "toast.excuting{0}",
                I18n.translate("command.doc.open"),
            );
        }
    }
}

customElements.define("chili-home", Home);
