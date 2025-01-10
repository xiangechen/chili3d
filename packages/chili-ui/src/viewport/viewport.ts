// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { Binding, CameraType, IConverter, IView, Result } from "chili-core";
import { div, Flyout, svg } from "../components";
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

export class Viewport extends HTMLElement {
    private readonly _flyout: Flyout;
    private readonly _eventCaches: [keyof HTMLElementEventMap, (e: any) => void][] = [];

    constructor(readonly view: IView) {
        super();
        this.className = style.root;
        this.initEvent();
        this._flyout = new Flyout();
        this.render();
    }

    private render() {
        this.append(
            div(
                {
                    className: style.viewControls,
                    onpointerdown(ev) {
                        ev.stopPropagation();
                    },
                    onclick: (e) => {
                        e.stopPropagation();
                    },
                },
                div(
                    {
                        className: style.border,
                    },
                    div(
                        {
                            className: new Binding(
                                this.view,
                                "cameraType",
                                new CameraConverter(CameraType.orthographic),
                            ),
                        },
                        svg({
                            icon: "icon-orthographic",
                            onclick: (e) => {
                                e.stopPropagation();
                                this.view.cameraType = CameraType.orthographic;
                            },
                        }),
                    ),
                    div(
                        {
                            className: new Binding(
                                this.view,
                                "cameraType",
                                new CameraConverter(CameraType.perspective),
                            ),
                        },
                        svg({
                            icon: "icon-perspective",
                            onclick: (e) => {
                                e.stopPropagation();
                                this.view.cameraType = CameraType.perspective;
                            },
                        }),
                    ),
                ),
                div(
                    {
                        className: style.border,
                    },
                    svg({
                        icon: "icon-fitcontent",
                        onclick: async (e) => {
                            e.stopPropagation();
                            await this.view.fitContent();
                        },
                    }),
                    svg({
                        icon: "icon-zoomin",
                        onclick: () => {
                            this.view.zoomIn();
                        },
                    }),
                    svg({
                        icon: "icon-zoomout",
                        onclick: () => {
                            this.view.zoomOut();
                        },
                    }),
                ),
            ),
        );
    }

    connectedCallback() {
        this.appendChild(this._flyout);
        this.addEventListener("mousemove", this._handleFlyoutMove);
    }

    disconnectedCallback() {
        this._flyout.remove();
        this.removeEventListener("mousemove", this._handleFlyoutMove);
    }

    private _handleFlyoutMove(e: MouseEvent) {
        if (this._flyout) {
            this._flyout.style.top = e.offsetY + "px";
            this._flyout.style.left = e.offsetX + "px";
        }
    }

    dispose() {
        this.removeEvents();
        this.removeEventListener("mousemove", this._handleFlyoutMove);
    }

    private initEvent() {
        let events: [keyof HTMLElementEventMap, (view: IView, e: any) => any][] = [
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

    private addEventListenerHandler(type: keyof HTMLElementEventMap, handler: (view: IView, e: any) => any) {
        let listener = (e: any) => {
            e.preventDefault();
            handler(this.view, e);
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

    private readonly pointerMove = (view: IView, event: PointerEvent) => {
        view.document.visual.eventHandler.pointerMove(view, event);
    };

    private readonly pointerDown = (view: IView, event: PointerEvent) => {
        view.document.application.activeView = view;
        view.document.visual.eventHandler.pointerDown(view, event);
    };

    private readonly pointerUp = (view: IView, event: PointerEvent) => {
        view.document.visual.eventHandler.pointerUp(view, event);
    };

    private readonly pointerOut = (view: IView, event: PointerEvent) => {
        view.document.visual.eventHandler.pointerOut?.(view, event);
    };

    private readonly mouseWheel = (view: IView, event: WheelEvent) => {
        view.document.visual.eventHandler.mouseWheel?.(view, event);
    };
}

customElements.define("chili-uiview", Viewport);
