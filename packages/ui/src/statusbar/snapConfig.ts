// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    Config,
    type I18nKeys,
    Localize,
    type ObjectSnapType,
    ObjectSnapTypes,
    ObjectSnapTypeUtils,
} from "@chili3d/core";
import { div, input, label } from "@chili3d/element";
import style from "./snapConfig.module.css";

const SnapTypes: Array<{
    type: ObjectSnapType;
    display: I18nKeys;
}> = [
    {
        type: ObjectSnapTypes.endPoint,
        display: "snap.end",
    },
    {
        type: ObjectSnapTypes.midPoint,
        display: "snap.mid",
    },
    {
        type: ObjectSnapTypes.center,
        display: "snap.center",
    },
    {
        type: ObjectSnapTypes.perpendicular,
        display: "snap.perpendicular",
    },
    {
        type: ObjectSnapTypes.intersection,
        display: "snap.intersection",
    },
];

export class SnapConfig extends HTMLElement {
    constructor() {
        super();
        this.className = style.container;
        Config.instance.onPropertyChanged(this.snapTypeChanged);

        this.render();
    }

    private readonly snapTypeChanged = (property: keyof Config) => {
        if (property === "snapType" || property === "enableSnap" || property === "enableSnapTracking") {
            this.innerHTML = "";
            this.render();
        }
    };

    private handleSnapClick(snapType: ObjectSnapType) {
        if (ObjectSnapTypeUtils.hasType(Config.instance.snapType, snapType)) {
            Config.instance.snapType = ObjectSnapTypeUtils.removeType(Config.instance.snapType, snapType);
        } else {
            Config.instance.snapType = ObjectSnapTypeUtils.addType(Config.instance.snapType, snapType);
        }
    }

    private render() {
        this.append(
            ...SnapTypes.map((snapType) => {
                return div(
                    input({
                        type: "checkbox",
                        id: `snap-${snapType.type}`,
                        checked: ObjectSnapTypeUtils.hasType(Config.instance.snapType, snapType.type),
                        onclick: () => this.handleSnapClick(snapType.type),
                    }),
                    label({
                        htmlFor: `snap-${snapType.type}`,
                        textContent: new Localize(snapType.display),
                    }),
                );
            }),
            div(
                input({
                    type: "checkbox",
                    id: "snap-tracking",
                    checked: Config.instance.enableSnapTracking,
                    onclick: () => {
                        Config.instance.enableSnapTracking = !Config.instance.enableSnapTracking;
                    },
                }),
                label({
                    htmlFor: "snap-tracking",
                    textContent: new Localize("statusBar.tracking"),
                }),
            ),
        );
    }
}

customElements.define("chili-snap-config", SnapConfig);
