// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IView } from "chili-core";
import { Flyout } from "../components";
import { BindableElement } from "../controls";

export class Viewport extends BindableElement {
    #flyout?: Flyout;
    readonly #eventCaches: [keyof HTMLElementEventMap, (e: any) => void][] = [];

    constructor(readonly view: IView) {
        super();
        this.initEvent();
        view.onPropertyChanged(this.#onViewClosed);
        this.addEventListener("mousemove", this.#handleFlyoutMove);
    }

    setActive(actived: boolean) {
        this.#flyout?.remove();
        this.#flyout = undefined;

        if (actived) {
            this.#flyout = new Flyout();
            document.body.appendChild(this.#flyout);
        }
    }

    #handleFlyoutMove(e: MouseEvent) {
        if (this.#flyout) {
            this.#flyout.style.top = e.clientY + "px";
            this.#flyout.style.left = e.clientX + "px";
        }
    }

    #onViewClosed = (prop: keyof IView) => {
        if (prop === "isClosed") {
            this.remove();
            this.dispose();
        }
    };

    override dispose() {
        super.dispose();
        this.removeEvents();
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
        this.#eventCaches.push([type, listener]);
    }

    private removeEvents() {
        this.#eventCaches.forEach((x) => {
            this.removeEventListener(x[0], x[1]);
        });
        this.#eventCaches.length = 0;
    }

    private pointerMove = (view: IView, event: PointerEvent) => {
        view.viewer.visual.eventHandler.pointerMove(view, event);
        view.viewer.visual.viewHandler.pointerMove(view, event);
    };

    private pointerDown = (view: IView, event: PointerEvent) => {
        view.viewer.activeView = view;
        view.viewer.visual.eventHandler.pointerDown(view, event);
        view.viewer.visual.viewHandler.pointerDown(view, event);
    };

    private pointerUp = (view: IView, event: PointerEvent) => {
        view.viewer.visual.eventHandler.pointerUp(view, event);
        view.viewer.visual.viewHandler.pointerUp(view, event);
    };

    private pointerOut = (view: IView, event: PointerEvent) => {
        view.viewer.visual.eventHandler.pointerOut?.(view, event);
        view.viewer.visual.viewHandler.pointerOut?.(view, event);
    };

    private mouseWheel = (view: IView, event: WheelEvent) => {
        view.viewer.visual.eventHandler.mouseWheel?.(view, event);
        view.viewer.visual.viewHandler.mouseWheel?.(view, event);
    };
}

customElements.define("chili-uiview", Viewport);
