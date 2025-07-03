// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { IEqualityComparer, ObjectStorage, Observable } from "./foundation";
import { I18n } from "./i18n";
import { Navigation3D } from "./navigation";
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
        return this.getPrivateValue("languageIndex", 0);
    }
    set languageIndex(value: number) {
        this.setProperty("languageIndex", value);
    }

    @Serializer.serialze()
    get navigation3DIndex() {
        return this.getPrivateValue("navigation3DIndex", 0);
    }
    set navigation3DIndex(value: number) {
        this.setProperty("navigation3DIndex", value);
    }

    protected override setProperty<K extends keyof this>(
        property: K,
        newValue: this[K],
        onPropertyChanged?: (property: K, oldValue: this[K]) => void,
        equals?: IEqualityComparer<this[K]>,
    ): boolean {
        if (super.setProperty(property, newValue, onPropertyChanged, equals)) {
            if (property === "languageIndex") {
                I18n.changeLanguage(newValue as number);
            } else if (property === "navigation3DIndex") {
                Navigation3D.changeType(newValue as number);
            }

            const json = Serializer.serializeProperties(this);
            ObjectStorage.default.setValue(CONFIG_STORAGE_KEY, json);
            return true;
        }

        return false;
    }

    private constructor() {
        super();
    }

    init() {
        const properties = ObjectStorage.default.value<SerializedProperties<Config>>(CONFIG_STORAGE_KEY);
        if (properties) {
            for (const key in properties) {
                const thisKey = key as keyof Config;
                this.setProperty(thisKey, properties[thisKey]);
            }
        } else {
            this.setPrivateValue("languageIndex", I18n.defaultLanguageIndex());
            this.setPrivateValue("navigation3DIndex", Navigation3D.currentIndex());
        }
    }
}
