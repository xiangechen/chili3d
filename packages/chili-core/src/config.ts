// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ObjectStorage, Observable } from "./foundation";
import { I18n } from "./i18n";
import type { Navigation3DType } from "./navigation";
import { type SerializedProperties, Serializer, serialze } from "./serialize";
import { ObjectSnapType } from "./snapType";

export const DefaultLightEdgeColor = 0x333333;
export const DefaultDarkEdgeColor = 0xeeeeee;

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
        return this.getPrivateValue("defaultEdgeColor", DefaultLightEdgeColor);
    }
    set defaultEdgeColor(value: number) {
        this.setProperty("defaultEdgeColor", value);
    }

    applyTheme(theme: "light" | "dark") {
        this.defaultEdgeColor = theme === "light" ? DefaultLightEdgeColor : DefaultDarkEdgeColor;
    }
}

export const VisualConfig = new VisualItemConfig();

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
                ObjectSnapType.nearest |
                ObjectSnapType.vertex,
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

    @serialze()
    get language() {
        return this.getPrivateValue("language", I18n.defaultLanguage());
    }
    set language(value: string) {
        this.setProperty("language", value);
    }

    @serialze()
    get navigation3D() {
        return this.getPrivateValue("navigation3D", "Chili3d");
    }
    set navigation3D(value: Navigation3DType) {
        this.setProperty("navigation3D", value);
    }

    @serialze()
    get themeMode() {
        return this.getPrivateValue("themeMode", "system");
    }
    set themeMode(value: "light" | "dark" | "system") {
        this.setProperty("themeMode", value, () => {
            if (value === "system") {
                VisualConfig.applyTheme(
                    window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light",
                );
            } else {
                VisualConfig.applyTheme(value);
            }
        });
    }

    #storageKey: string = "config";
    get storageKey() {
        return this.#storageKey;
    }

    private constructor() {
        super();
    }

    init(storageKey: string) {
        this.#storageKey = storageKey;
        this.readFromStorage();
    }

    readFromStorage() {
        const data = ObjectStorage.default.value<SerializedProperties<Config>>(this.storageKey);
        for (const key in data) {
            const thisKey = key as keyof Config;
            this.setPrivateValue(thisKey, (data as any)[key]);
        }
    }

    saveToStorage() {
        const json = Serializer.serializeProperties(this);
        ObjectStorage.default.setValue(this.storageKey, json);
    }
}
