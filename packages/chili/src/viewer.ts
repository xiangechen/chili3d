// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { CursorType, IDocument, IView, IViewer, PubSub, PubSubEventMap, ShapeType } from "chili-core";

interface EventData {
    container: HTMLElement | Window;
    type: string;
    callback: (e: any) => void;
}

interface SubCallbackData {
    view: IView;
    type: keyof PubSubEventMap;
    callback: (e: any) => void;
}

export class Viewer implements IViewer {
    private readonly _views: Set<IView>;
    private readonly _eventCaches: Map<IView, EventData[]>;
    private readonly _callbackCaches: Map<IView, SubCallbackData[]>;

    selectionType: ShapeType = ShapeType.Shape;

    constructor(readonly document: IDocument) {
        this._views = new Set<IView>();
        this._eventCaches = new Map();
        this._callbackCaches = new Map();
    }

    addView(view: IView) {
        if (this._views.has(view)) return;
        this._views.add(view);
        this.initEvent(view.container, view);
    }

    removeView(view: IView) {
        this.removeEvents(view);
        this._views.delete(view);
    }

    views(): readonly IView[] {
        return [...this._views];
    }

    setCursor(cursor: CursorType) {
        this._views.forEach((x) => x.setCursor(cursor));
    }

    redraw() {
        this._views.forEach((v) => {
            v.redraw();
        });
    }

    update(): void {
        this._views.forEach((v) => {
            v.update();
        });
    }

    dispose(): void {
        this._views.forEach((v) => {
            this.removeEvents(v);
        });
    }

    private initEvent(container: HTMLElement, view: IView) {
        const resizeObserver = new ResizeObserver((entries) => {
            view.resize(container.offsetWidth, container.offsetHeight);
        });
        resizeObserver.observe(container);

        this.addEventListener(container, view, "pointerdown", (e) => this.pointerDown(view, e));
        this.addEventListener(container, view, "pointermove", (e) => this.pointerMove(view, e));
        this.addEventListener(container, view, "pointerup", (e) => this.pointerUp(view, e));
        this.addEventListener(container, view, "wheel", (e) => this.mouseWheel(view, e));

        this.subEvents("keyDown", view, (e) => this.keyDown(view, e));
        this.subEvents("keyUp", view, (e) => this.keyUp(view, e));
    }

    private subEvents<K extends keyof PubSubEventMap>(
        type: K,
        view: IView,
        callback: (...args: any[]) => void
    ) {
        PubSub.default.sub(type, callback as any);
        if (this._callbackCaches.get(view) === undefined) {
            this._callbackCaches.set(view, []);
        }
        this._callbackCaches.get(view)?.push({
            view,
            callback,
            type,
        });
    }

    private addEventListener(
        container: HTMLElement | Window,
        view: IView,
        type: keyof HTMLElementEventMap,
        listener: (this: HTMLElement, e: any) => any
    ) {
        container.addEventListener(type, listener);
        if (this._eventCaches.get(view) === undefined) {
            this._eventCaches.set(view, []);
        }
        this._eventCaches.get(view)?.push({
            container,
            callback: listener,
            type,
        });
    }

    private removeEvents(view: IView) {
        let events = this._eventCaches.get(view);
        events?.forEach((x) => {
            x.container.removeEventListener(x.type, x.callback);
        });
        this._eventCaches.delete(view);

        let subs = this._callbackCaches.get(view);
        subs?.forEach((x) => {
            PubSub.default.remove(x.type, x.callback);
        });
        this._callbackCaches.delete(view);
    }

    private pointerMove(view: IView, event: PointerEvent): void {
        this.document.visualization.eventHandler.pointerMove(view, event);
        this.document.visualization.viewHandler.pointerMove(view, event);
    }

    private pointerDown(view: IView, event: PointerEvent): void {
        event.preventDefault();
        this.document.visualization.eventHandler.pointerDown(view, event);
        this.document.visualization.viewHandler.pointerDown(view, event);
    }

    private pointerUp(view: IView, event: PointerEvent): void {
        this.document.visualization.eventHandler.pointerUp(view, event);
        this.document.visualization.viewHandler.pointerUp(view, event);
    }

    private mouseWheel(view: IView, event: WheelEvent): void {
        this.document.visualization.eventHandler.mouseWheel(view, event);
        this.document.visualization.viewHandler.mouseWheel(view, event);
    }

    private keyDown(view: IView, event: KeyboardEvent): void {
        this.document.visualization.eventHandler.keyDown(view, event);
        this.document.visualization.viewHandler.keyDown(view, event);
    }

    private keyUp(view: IView, event: KeyboardEvent): void {
        this.document.visualization.eventHandler.keyUp(view, event);
        this.document.visualization.viewHandler.keyUp(view, event);
    }
}
