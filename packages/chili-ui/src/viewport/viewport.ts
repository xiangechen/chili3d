// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IView } from "chili-core";
import { Flyout } from "../components";
import style from "./viewport.module.css";

export class Viewport extends HTMLElement {
    private _flyout: Flyout;
    private readonly _eventCaches: [keyof HTMLElementEventMap, (e: any) => void][] = [];

    constructor(readonly view: IView) {
        super();
        this.className = style.root;
        this.initEvent();
        this._flyout = new Flyout();
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

    private pointerMove = (view: IView, event: PointerEvent) => {
        view.document.visual.eventHandler.pointerMove(view, event);
        view.document.visual.viewHandler.pointerMove(view, event);
    };

    private pointerDown = (view: IView, event: PointerEvent) => {
        view.document.application.activeView = view;
        view.document.visual.eventHandler.pointerDown(view, event);
        view.document.visual.viewHandler.pointerDown(view, event);
    };

    private pointerUp = (view: IView, event: PointerEvent) => {
        view.document.visual.eventHandler.pointerUp(view, event);
        view.document.visual.viewHandler.pointerUp(view, event);
    };

    private pointerOut = (view: IView, event: PointerEvent) => {
        view.document.visual.eventHandler.pointerOut?.(view, event);
        view.document.visual.viewHandler.pointerOut?.(view, event);
    };

    private mouseWheel = (view: IView, event: WheelEvent) => {
        view.document.visual.eventHandler.mouseWheel?.(view, event);
        view.document.visual.viewHandler.mouseWheel?.(view, event);
    };
}

customElements.define("chili-uiview", Viewport);
