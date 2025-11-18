// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ObjectStorage, Observable } from "./foundation";
import { I18n } from "./i18n";
import { type SerializedProperties, Serializer } from "./serialize";
import { ObjectSnapType } from "./snapType";

export class VisualItemConfig extends Observable {
    defaultFaceColor = 0xdedede;
    highlightEdgeColor = 0x33ff33;
    highlightFaceColor = 0x99ff00;
    selectedEdgeColor = 0x33ff33;
    selectedFaceColor = 0x33ff33;
    editVertexSize = 7;
    editVertexColor = 0x33ff33;
    hintVertexSize = 5;
    hintVertexColor = 0x33ff33;
    trackingVertexSize = 7;
    trackingVertexColor = 0x33ff33;
    temporaryVertexSize = 5;
    temporaryVertexColor = 0x33ff33;
    temporaryEdgeColor = 0x33ff33;

    get defaultEdgeColor() {
        return this.getPrivateValue("defaultEdgeColor", 0x333333);
    }
    set defaultEdgeColor(value: number) {
        this.setProperty("defaultEdgeColor", value);
    }

    setTheme(theme: "light" | "dark") {
        this.defaultEdgeColor = theme === "light" ? 0x333333 : 0xeeeeee;
    }
}

export const VisualConfig = new VisualItemConfig();

const CONFIG_STORAGE_KEY = "config";

export class Config extends Observable {
    static readonly #instance = new Config();

    static get instance() {
        return Config.#instance;
    }

    readonly SnapDistance: number = 5;

    get snapType() {
        return this.getPrivateValue(
            "snapType",
            ObjectSnapType.midPoint |
                ObjectSnapType.endPoint |
                ObjectSnapType.center |
                ObjectSnapType.perpendicular |
                ObjectSnapType.intersection |
                ObjectSnapType.nearest,
        );
    }
    set snapType(snapType: ObjectSnapType) {
        this.setProperty("snapType", snapType);
    }

    get enableSnapTracking() {
        return this.getPrivateValue("enableSnapTracking", true);
    }
    set enableSnapTracking(value: boolean) {
        this.setProperty("enableSnapTracking", value);
    }

    get enableSnap() {
        return this.getPrivateValue("enableSnap", true);
    }
    set enableSnap(value: boolean) {
        this.setProperty("enableSnap", value);
    }

    get dynamicWorkplane() {
        return this.getPrivateValue("dynamicWorkplane", true);
    }
    set dynamicWorkplane(value: boolean) {
        this.setProperty("dynamicWorkplane", value);
    }

    @Serializer.serialze()
    get languageIndex() {
        return this.getPrivateValue("languageIndex");
    }
    set languageIndex(value: number) {
        this.setProperty("languageIndex", value, () => {
            I18n.changeLanguage(value);
            this.saveToStorage();
        });
    }

    @Serializer.serialze()
    get navigation3DIndex() {
        return this.getPrivateValue("navigation3DIndex");
    }
    set navigation3DIndex(value: number) {
        this.setProperty("navigation3DIndex", value, () => {
            this.saveToStorage();
        });
    }

    @Serializer.serialze()
    get themeMode() {
        return this.getPrivateValue("themeMode", "system");
    }
    set themeMode(value: "light" | "dark" | "system") {
        this.setProperty("themeMode", value, () => {
            this.applyTheme();
            this.saveToStorage();
        });
    }

    private applyTheme() {
        const themeMode = this.themeMode;
        let theme: "light" | "dark";

        if (themeMode === "system") {
            theme = window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
        } else {
            theme = themeMode;
        }

        document.documentElement.setAttribute("theme", theme);
        VisualConfig.setTheme(theme);
    }

    private saveToStorage() {
        const json = Serializer.serializeProperties(this);
        ObjectStorage.default.setValue(CONFIG_STORAGE_KEY, json);
    }

    private constructor() {
        super();
        this.init();
    }

    private init() {
        const properties = ObjectStorage.default.value<SerializedProperties<Config>>(CONFIG_STORAGE_KEY);
        if (properties) {
            for (const key in properties) {
                const thisKey = key as keyof Config;
                this.setPrivateValue(thisKey, properties[thisKey]);
            }
        } else {
            this.setPrivateValue("languageIndex", I18n.defaultLanguageIndex());
            this.setPrivateValue("navigation3DIndex", 0);
            this.setPrivateValue("themeMode", "system");
        }

        // Apply theme on startup
        this.applyTheme();

        // Listen for system theme changes
        window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener("change", () => {
            if (this.themeMode === "system") {
                this.applyTheme();
            }
        });
    }
}
