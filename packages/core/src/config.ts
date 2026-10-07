// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ObjectStorage, Observable } from "./foundation";
import { I18n } from "./i18n";
import type { Navigation3DType } from "./navigation";
import { type SerializedData, Serializer, serialize } from "./serialize";
import { type ObjectSnapType, ObjectSnapTypes, ObjectSnapTypeUtils } from "./snapType";

export const DefaultLightEdgeColor = 0x333333;
export const DefaultDarkEdgeColor = 0xeeeeee;
/** `DefaultLightEdgeColor` mixed halfway into the light theme's viewport background (#888888). */
export const DefaultLightDrivenColor = 0x5e5e5e;
/** `DefaultDarkEdgeColor` mixed halfway into the dark theme's viewport background (#242424). */
export const DefaultDarkDrivenColor = 0x898989;
/**
 * A sketch entity that is not fully constrained, in the sketch editor — the SolidWorks
 * convention: an under-defined line reads blue until every one of its parameters is
 * pinned, at which point it falls back to `defaultEdgeColor`. One value for both themes,
 * unlike `drivenColor`: this blue stays legible on either backdrop (#888888 and #242424).
 */
export const DefaultSketchFreeColor = 0x1c4eff;

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

    /**
     * The colour a driven (reference) sketch dimension draws in: a reference reads as the sketch's
     * own line colour muted into whatever it is drawn over, and the two themes put that in
     * different places — their backdrops are #888888 and #242424, which straddle a mid grey, so one
     * value cannot be quiet on the one and visible on the other (`DefaultLightDrivenColor` and
     * `DefaultDarkDrivenColor` are each their own theme's mix). No other annotation tone needs the
     * split: the conflicts' red, the redundancy's amber and the selection's green all sit outside
     * the greys those backdrops swallow.
     */
    get drivenColor() {
        return this.getPrivateValue("drivenColor", DefaultLightDrivenColor);
    }
    set drivenColor(value: number) {
        this.setProperty("drivenColor", value);
    }

    /**
     * The colour an under-constrained sketch entity draws in while the sketch editor is
     * open. Baked into the mesh's vertex colours rather than read per frame, so a node
     * that is currently colouring listens for changes here and rebuilds (see
     * `SketchNode.syncConstraintColorWatch`). Not re-picked per theme — see the constant.
     */
    get sketchFreeColor() {
        return this.getPrivateValue("sketchFreeColor", DefaultSketchFreeColor);
    }
    set sketchFreeColor(value: number) {
        this.setProperty("sketchFreeColor", value);
    }

    applyTheme(theme: "light" | "dark") {
        this.defaultEdgeColor = theme === "light" ? DefaultLightEdgeColor : DefaultDarkEdgeColor;
        this.drivenColor = theme === "light" ? DefaultLightDrivenColor : DefaultDarkDrivenColor;
    }
}

export const VisualConfig = new VisualItemConfig();

export class Config extends Observable {
    static readonly #instance = new Config();

    static get instance() {
        return Config.#instance;
    }

    readonly SnapDistance: number = 10;

    get snapType() {
        return this.getPrivateValue(
            "snapType",
            ObjectSnapTypeUtils.combine(
                ObjectSnapTypes.midPoint,
                ObjectSnapTypes.endPoint,
                ObjectSnapTypes.center,
                ObjectSnapTypes.perpendicular,
                ObjectSnapTypes.intersection,
                ObjectSnapTypes.onCurve,
                ObjectSnapTypes.onSurface,
                ObjectSnapTypes.vertex,
                ObjectSnapTypes.tangent,
            ),
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

    @serialize()
    get language() {
        return this.getPrivateValue("language", I18n.defaultLanguage());
    }
    set language(value: string) {
        this.setProperty("language", value);
    }

    @serialize()
    get navigation3D() {
        return this.getPrivateValue("navigation3D", "Chili3d");
    }
    set navigation3D(value: Navigation3DType) {
        this.setProperty("navigation3D", value);
    }

    @serialize()
    get themeMode() {
        return this.getPrivateValue("themeMode", "system");
    }
    set themeMode(value: "light" | "dark" | "system") {
        this.setProperty("themeMode", value, () => this.applyTheme(value));
    }

    @serialize()
    get trustedDomains() {
        return this.getPrivateValue("trustedDomains", []);
    }
    set trustedDomains(value: string[]) {
        this.setProperty("trustedDomains", value);
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
        this.applyTheme(this.themeMode);
    }

    private readonly applyTheme = (value: "light" | "dark" | "system") => {
        if (value === "system") {
            VisualConfig.applyTheme(
                window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light",
            );
        } else {
            VisualConfig.applyTheme(value);
        }
    };

    readFromStorage() {
        const data = ObjectStorage.default.value<SerializedData>(this.storageKey);
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
