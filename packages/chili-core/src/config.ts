// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ObjectStorage, Observable } from "./foundation";
import { I18n } from "./i18n";
import { SerializedProperties, Serializer } from "./serialize";
import { ObjectSnapType } from "./snapType";

export const VisualConfig = {
    defaultEdgeColor: 0x111111,
    defaultFaceColor: 0xdedede,
    highlightEdgeColor: 0x3333ff,
    highlightFaceColor: 0xff9900,
    selectedEdgeColor: 0x0000ff,
    selectedFaceColor: 0x0000ff,
    editVertexSize: 7,
    editVertexColor: 0x0000ff,
    hintVertexSize: 5,
    hintVertexColor: 0x0000ff,
    trackingVertexSize: 7,
    trackingVertexColor: 0x0000ff,
    temporaryVertexSize: 5,
    temporaryVertexColor: 0x0000ff,
    temporaryEdgeColor: 0x0000ff,
};

const CONFIG_STORAGE_KEY = "config";

export class Config extends Observable {
    static readonly #instance = new Config();

    static get instance() {
        return this.#instance;
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
        }
    }
}
