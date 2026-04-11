// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type Act,
    Binding,
    type CameraType,
    I18n,
    type IConverter,
    IEventHandler,
    type IView,
    Localize,
    PubSub,
    Result,
    type ViewMode,
    ViewModeI18nKeys,
    ViewModes,
} from "@chili3d/core";
import { collection, div, input, label, span, svg } from "@chili3d/element";
import { Flyout } from "./flyout";
import style from "./viewport.module.css";

class CameraConverter implements IConverter<CameraType> {
    constructor(readonly type: CameraType) {}

    convert(value: CameraType): Result<string, string> {
        if (value === this.type) {
            return Result.ok(style.actived);
        }
        return Result.ok("");
    }
}

class ViewModeConverter implements IConverter<ViewMode> {
    constructor(readonly mode: ViewMode) {}

    convert(value: ViewMode): Result<string, string> {
        if (value === this.mode) {
            return Result.ok(style.actived);
        }
        return Result.ok("");
    }
}

export class Viewport extends HTMLElement {
    private readonly _flyout: Flyout;
    private readonly _eventCaches: [keyof HTMLElementEventMap, (e: any) => void][] = [];
    private readonly _acts: HTMLElement;

    constructor(
        readonly view: IView,
        readonly showViewControls: boolean,
    ) {
        super();
        this.className = style.root;
        this._flyout = new Flyout();
        this._acts = this.createActs();
        this.render();
        view.setDom(this);
    }

    private readonly onActCollectionChanged = () => {
        if (this.view.document.acts.length === 0) {
            this._acts.style.display = "none";
        } else {
            this._acts.style.display = "flex";
        }
    };

    private render() {
        this.append(
            this._acts,
            this.showViewControls
                ? div(
                      {
                          className: style.viewControls,
                          onpointerdown: (ev) => ev.stopPropagation(),
                          onclick: (e) => e.stopPropagation(),
                      },
                      this.createCameraControls(),
                      this.createActionControls(),
                  )
                : "",
            this.createViewModeControl(),
        );
    }

    private createCameraControls() {
        return div(
            { className: style.border },
            this.createCameraControl("orthographic", "icon-orthographic"),
            this.createCameraControl("perspective", "icon-perspective"),
        );
    }

    private createActionControls() {
        return div(
            { className: style.border },
            svg({
                icon: "icon-fitcontent",
                title: new Localize("viewport.fitContent"),
                onclick: async (e) => {
                    e.stopPropagation();
                    this.view.cameraController.fitContent();
                    this.view.update();
                },
            }),
            svg({
                icon: "icon-zoomin",
                title: new Localize("viewport.zoomIn"),
                onclick: () => {
                    this.view.cameraController.zoom(this.view.width / 2, this.view.height / 2, -5);
                    this.view.update();
                },
            }),
            svg({
                icon: "icon-zoomout",
                title: new Localize("viewport.zoomOut"),
                onclick: () => {
                    this.view.cameraController.zoom(this.view.width / 2, this.view.height / 2, 5);
                    this.view.update();
                },
            }),
        );
    }

    private createActs() {
        return div(
            { className: style.actsContainer },
            div(
                {
                    className: style.border,
                    onpointerdown: (ev) => ev.stopPropagation(),
                    onclick: (e) => e.stopPropagation(),
                },
                collection({
                    className: style.acts,
                    sources: this.view.document.acts,
                    template: (v) => {
                        return div(
                            {
                                onclick: () => {
                                    this.view.cameraController.lookAt(
                                        v.cameraPosition,
                                        v.cameraTarget,
                                        v.cameraUp,
                                    );
                                    this.view.update();
                                },
                            },
                            span({
                                textContent: new Binding(v, "name"),
                            }),
                            div(
                                {
                                    className: style.tools,
                                },
                                svg({
                                    icon: "icon-cog",
                                    onclick: () => this.setActName(v),
                                }),
                                svg({
                                    icon: "icon-times",
                                    onclick: () => {
                                        this.view.document.acts.remove(v);
                                    },
                                }),
                            ),
                        );
                    },
                    onwheel: (e) => {
                        e.preventDefault();
                        const container = e.currentTarget as HTMLElement;
                        container.scrollLeft += e.deltaY;
                    },
                }),
            ),
        );
    }

    private readonly setActName = (act: Act) => {
        const inputBox = input({
            value: act.name,
            onkeydown: (e) => {
                e.stopPropagation();
            },
        });
        PubSub.default.pub(
            "showDialog",
            "ribbon.group.act",
            div(label({ textContent: new Localize("common.name") }), ": ", inputBox),
            () => {
                act.name = inputBox.value;
            },
        );
    };

    private createCameraControl(cameraType: CameraType, icon: string) {
        return div(
            {
                className: new Binding(
                    this.view.cameraController,
                    "cameraType",
                    new CameraConverter(cameraType),
                ),
            },
            svg({
                icon: icon,
                title: new Localize(`viewport.${cameraType}`),
                onclick: (e) => {
                    e.stopPropagation();
                    this.view.cameraController.cameraType = cameraType;
                    this.view.update();
                },
            }),
        );
    }

    private createViewModeControl() {
        const label = span({
            textContent: new Localize(ViewModeI18nKeys[this.view.mode]),
        });
        return div(
            {
                className: style.viewModeControl,
            },
            div(
                {
                    className: style.viewModeDisplay,
                    onclick: (e) => {
                        e.stopPropagation();
                        const target = e.currentTarget as HTMLElement;
                        if (target.nextElementSibling instanceof HTMLElement) {
                            target.nextElementSibling.classList.toggle(style.visible);
                        }
                    },
                },
                "[ ",
                label,
                " ]",
            ),
            div(
                {
                    className: style.viewModeMenu,
                },
                ...ViewModes.map((m) =>
                    div({
                        className: new Binding(this.view, "mode", new ViewModeConverter(m)),
                        textContent: new Localize(ViewModeI18nKeys[m]),
                        onclick: (e) => {
                            e.stopPropagation();
                            I18n.set(label, "textContent", ViewModeI18nKeys[m]);
                            this.view.mode = m;
                            this.view.update();

                            const target = e.currentTarget as HTMLElement;
                            if (target.parentElement instanceof HTMLElement) {
                                target.parentElement.classList.remove(style.visible);
                            }
                        },
                    }),
                ),
            ),
        );
    }

    connectedCallback() {
        this.initEvent();
        this.appendChild(this._flyout);
        this.view.document.acts.onCollectionChanged(this.onActCollectionChanged);
        this.onActCollectionChanged();
    }

    disconnectedCallback() {
        this.removeEvents();
        this._flyout.remove();
        this.view.document.acts.removeCollectionChanged(this.onActCollectionChanged);
    }

    dispose() {
        this.removeEvents();
    }

    private initEvent() {
        const events: [keyof HTMLElementEventMap, (e: any) => any][] = [
            ["pointerdown", this.pointerDown],
            ["pointermove", this.pointerMove],
            ["pointerout", this.pointerOut],
            ["pointerup", this.pointerUp],
            ["wheel", this.mouseWheel],
        ];
        events.forEach((v) => {
            this.addEventListenerHandler(v[0], v[1]);
        });
    }

    private addEventListenerHandler(type: keyof HTMLElementEventMap, handler: (e: any) => any) {
        const listener = (e: any) => {
            e.preventDefault();
            handler(e);
        };
        this.addEventListener(type, listener);
        this._eventCaches.push([type, listener]);
    }

    private removeEvents() {
        this._eventCaches.forEach((x) => {
            this.removeEventListener(x[0], x[1]);
        });
        this._eventCaches.length = 0;
    }

    private readonly handleEvent = (eventName: Exclude<keyof IEventHandler, "isEnabled" | "dispose">, event: PointerEvent | WheelEvent) => {
        if (this.view.document.visual.eventHandler.isEnabled)
            this.view.document.visual.eventHandler[eventName]?.(this.view, event as any);
        if (this.view.document.visual.viewHandler.isEnabled)
            this.view.document.visual.viewHandler[eventName]?.(this.view, event as any);
    }

    private readonly pointerMove = (event: PointerEvent) => {
        if (this._flyout) {
            this._flyout.style.top = event.offsetY + "px";
            this._flyout.style.left = event.offsetX + "px";
        }

        this.handleEvent("pointerMove", event);
    };

    private readonly pointerDown = (event: PointerEvent) => {
        if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
        }

        if (this.view.document.application.activeView !== this.view) {
            this.view.document.application.activeView = this.view;
        }

        this.handleEvent("pointerDown", event);
    };

    private readonly pointerUp = (event: PointerEvent) => {
        this.handleEvent("pointerUp", event);
    };

    private readonly pointerOut = (event: PointerEvent) => {
        this.handleEvent("pointerOut", event);
    };

    private readonly mouseWheel = (event: WheelEvent) => {
        this.handleEvent("mouseWheel", event);
    };
}

customElements.define("chili-uiview", Viewport);
