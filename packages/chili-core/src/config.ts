// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { appSettings } from "chili-core";
import { Observable } from "./foundation";
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

export class Config extends Observable {
    static readonly #instance = new Config();

    static get instance() {
        return this.#instance;
    }

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

    readonly SnapDistance: number = 5;

    private constructor() {
        super();
    }
}

export namespace Navigation3D {
    export enum Nav3DType {
        Chili3d = 0,
        Revit,
        Blender,
        Creo,
        Solidworks,
    }
    export const types: string[] = [Nav3DType[0], Nav3DType[1], Nav3DType[2], Nav3DType[3], Nav3DType[4]];

    const nav3DKey: string = "nav3D";
    let _currentIndex: number = 0;

    export function currentType() {
        return types[_currentIndex];
    }

    export function currentIndex() {
        return _currentIndex;
    }

    export function syncTypeFromSettings() {
        const index = appSettings().value<number>(nav3DKey, 0);
        if (index < 0 || index >= types.length) {
            return;
        }
        _currentIndex = index;
    }

    export function changeType(index: number) {
        if (index < 0 || index >= types.length) {
            return;
        }
        _currentIndex = index;
        appSettings().setValue(nav3DKey, _currentIndex);
    }
}
