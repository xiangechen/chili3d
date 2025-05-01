// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { div, input, label } from "chili-controls";
import { Config, I18nKeys, Localize, ObjectSnapType } from "chili-core";
import style from "./snapConfig.module.css";

const SnapTypes: Array<{
    type: ObjectSnapType;
    display: I18nKeys;
}> = [
    {
        type: ObjectSnapType.endPoint,
        display: "snap.end",
    },
    {
        type: ObjectSnapType.midPoint,
        display: "snap.mid",
    },
    {
        type: ObjectSnapType.center,
        display: "snap.center",
    },
    {
        type: ObjectSnapType.perpendicular,
        display: "snap.perpendicular",
    },
    {
        type: ObjectSnapType.intersection,
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
        if (ObjectSnapType.has(Config.instance.snapType, snapType)) {
            Config.instance.snapType = ObjectSnapType.remove(Config.instance.snapType, snapType);
        } else {
            Config.instance.snapType = ObjectSnapType.add(Config.instance.snapType, snapType);
        }
    }

    private render() {
        this.append(
            ...SnapTypes.map((snapType) => {
                return div(
                    input({
                        type: "checkbox",
                        id: `snap-${snapType.type}`,
                        checked: ObjectSnapType.has(Config.instance.snapType, snapType.type),
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
                    onclick: () =>
                        (Config.instance.enableSnapTracking = !Config.instance.enableSnapTracking),
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
