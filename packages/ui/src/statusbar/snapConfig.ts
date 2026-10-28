// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    Config,
    I18n,
    type I18nKeys,
    Localize,
    type ObjectSnapType,
    ObjectSnapTypes,
    ObjectSnapTypeUtils,
} from "@chili3d/core";
import { button, div, input, label, span } from "@chili3d/element";
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
    {
        type: ObjectSnapTypes.tangent,
        display: "snap.tangent",
    },
    {
        type: ObjectSnapTypes.onCurve,
        display: "snap.nearCurve",
    },
    {
        type: ObjectSnapTypes.onSurface,
        display: "snap.onSurface",
    },
];

export class SnapConfig extends HTMLElement {
    private popup?: HTMLElement;
    private resizeObserver?: ResizeObserver;
    private readonly enabled = input({
        type: "checkbox",
        id: "snap-enabled",
        checked: Config.instance.enableSnap,
        onclick: () => {
            Config.instance.enableSnap = this.enabled.checked;
        },
    });
    private readonly summary = button({
        className: style.summary,
        type: "button",
        onclick: () => this.togglePopup(),
    });
    private readonly tracking = input({
        type: "checkbox",
        id: "snap-tracking",
        checked: Config.instance.enableSnapTracking,
        onclick: () => {
            Config.instance.enableSnapTracking = this.tracking.checked;
        },
    });

    constructor() {
        super();
        this.className = style.container;
        this.summary.setAttribute("aria-label", I18n.translate("statusBar.snap"));
        this.summary.setAttribute("aria-expanded", "false");
        this.summary.setAttribute("aria-haspopup", "true");
        this.append(
            div(
                { className: style.snapGroup },
                label(
                    { className: style.toggle, htmlFor: "snap-enabled" },
                    this.enabled,
                    span({ textContent: new Localize("statusBar.snap") }),
                ),
                this.summary,
            ),
            label(
                { className: style.toggle, htmlFor: "snap-tracking" },
                this.tracking,
                span({ textContent: new Localize("statusBar.tracking") }),
            ),
        );
    }

    private readonly snapTypeChanged = (property: keyof Config) => {
        if (
            property === "snapType" ||
            property === "enableSnap" ||
            property === "enableSnapTracking" ||
            property === "language"
        ) {
            this.refresh();
        }
    };

    private refresh() {
        for (const snapType of SnapTypes) {
            const checkbox = this.popup?.querySelector<HTMLInputElement>(`#snap-${snapType.type}`);
            if (checkbox) {
                checkbox.checked = ObjectSnapTypeUtils.hasType(Config.instance.snapType, snapType.type);
            }
        }
        this.summary.setAttribute("aria-label", I18n.translate("statusBar.snap"));
        this.enabled.checked = Config.instance.enableSnap;
        this.tracking.checked = Config.instance.enableSnapTracking;
    }

    private handleSnapClick(snapType: ObjectSnapType) {
        if (ObjectSnapTypeUtils.hasType(Config.instance.snapType, snapType)) {
            Config.instance.snapType = ObjectSnapTypeUtils.removeType(Config.instance.snapType, snapType);
        } else {
            Config.instance.snapType = ObjectSnapTypeUtils.addType(Config.instance.snapType, snapType);
        }
    }

    private togglePopup() {
        if (this.popup) this.close();
        else this.open();
    }

    private open() {
        this.popup = div({ className: style.popup }, ...this.rows());
        document.body.append(this.popup);
        this.summary.setAttribute("aria-expanded", "true");
        this.place();
        if (this.parentElement && typeof ResizeObserver !== "undefined") {
            this.resizeObserver = new ResizeObserver(this.place);
            this.resizeObserver.observe(this.parentElement);
        }
        window.addEventListener("pointerdown", this.onPointerDown, true);
        window.addEventListener("keydown", this.onKeyDown, true);
        window.addEventListener("resize", this.place);
    }

    private close() {
        this.resizeObserver?.disconnect();
        this.resizeObserver = undefined;
        if (!this.popup) return;
        window.removeEventListener("pointerdown", this.onPointerDown, true);
        window.removeEventListener("keydown", this.onKeyDown, true);
        window.removeEventListener("resize", this.place);
        this.popup.remove();
        this.popup = undefined;
        this.summary.setAttribute("aria-expanded", "false");
    }

    private readonly place = () => {
        if (!this.popup) return;
        const rect = this.summary.getBoundingClientRect();
        this.popup.style.right = `${window.innerWidth - rect.right}px`;
        this.popup.style.bottom = `${window.innerHeight - rect.top + 4}px`;
        this.popup.style.maxHeight = `${Math.max(0, rect.top - 8)}px`;
    };

    private readonly onPointerDown = (event: Event) => {
        const target = event.target as Node;
        if (!this.popup?.contains(target) && !this.contains(target)) this.close();
    };

    private readonly onKeyDown = (event: KeyboardEvent) => {
        if (event.key !== "Escape" || !this.popup) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        this.close();
    };

    private rows(): HTMLElement[] {
        return SnapTypes.map((snapType) =>
            div(
                { className: style.item },
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
            ),
        );
    }

    connectedCallback() {
        Config.instance.onPropertyChanged(this.snapTypeChanged);
        this.refresh();
    }

    disconnectedCallback() {
        this.close();
        Config.instance.removePropertyChanged(this.snapTypeChanged);
    }
}

customElements.define("chili-snap-config", SnapConfig);
