// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { CursorType, IDocument, IView, IViewer, Plane, PubSub, PubSubEventMap } from "chili-core";

interface EventData {
    container: HTMLElement | Window;
    type: string;
    callback: (e: any) => void;
}

interface SubData {
    view: IView;
    type: keyof PubSubEventMap;
    callback: (e: any) => void;
}

export class Viewer implements IViewer {
    private readonly _views: Set<IView>;
    private readonly _eventCaches: Map<IView, EventData[]>;
    private readonly _subCaches: Map<IView, SubData[]>;

    constructor(readonly document: IDocument) {
        this._views = new Set<IView>();
        this._eventCaches = new Map();
        this._subCaches = new Map();
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

    createView(container: HTMLElement, name: string, workplane: Plane): IView {
        let view = this.document.visualization.createView(name, container, workplane);
        this.addView(view);
        return view;
    }

    views(): IView[] {
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

        this.addEventListener(container, view, "mousedown", (e) => this.mouseDown(view, e));
        this.addEventListener(container, view, "mousemove", (e) => this.mouseMove(view, e));
        this.addEventListener(container, view, "mouseup", (e) => this.mouseUp(view, e));
        this.addEventListener(container, view, "mouseout", (e) => this.mouseOut(view, e));
        this.addEventListener(container, view, "wheel", (e) => this.mouseWheel(view, e));
        this.addEventListener(container, view, "touchstart", (e) => this.touchStart(view, e));
        this.addEventListener(container, view, "touchmove", (e) => this.touchMove(view, e));
        this.addEventListener(container, view, "touchend", (e) => this.touchEnd(view, e));

        this.subEvents("keyDown", view, (e) => this.keyDown(view, e));
        this.subEvents("keyUp", view, (e) => this.keyUp(view, e));
    }

    private subEvents<K extends keyof PubSubEventMap>(type: K, view: IView, callback: (...args: any[]) => void) {
        PubSub.default.sub(type, callback as any);
        if (this._subCaches.get(view) === undefined) {
            this._subCaches.set(view, []);
        }
        this._subCaches.get(view)?.push({
            view,
            callback,
            type,
        });
    }

    private addEventListener(container: HTMLElement | Window, view: IView, type: string, callback: (e: any) => void) {
        container.addEventListener(type, callback);
        if (this._eventCaches.get(view) === undefined) {
            this._eventCaches.set(view, []);
        }
        this._eventCaches.get(view)?.push({
            container,
            callback,
            type,
        });
    }

    private removeEvents(view: IView) {
        let events = this._eventCaches.get(view);
        events?.forEach((x) => {
            x.container.removeEventListener(x.type, x.callback);
        });
        this._eventCaches.delete(view);

        let subs = this._subCaches.get(view);
        subs?.forEach((x) => {
            PubSub.default.remove(x.type, x.callback);
        });
        this._subCaches.delete(view);
    }

    private mouseMove(view: IView, event: MouseEvent): void {
        this.document.visualization.eventHandler.mouseMove(view, event);
        this.document.visualization.viewHandler.mouseMove(view, event);
    }

    private mouseDown(view: IView, event: MouseEvent): void {
        event.preventDefault();
        this.document.visualization.eventHandler.mouseDown(view, event);
        this.document.visualization.viewHandler.mouseDown(view, event);
    }

    private mouseUp(view: IView, event: MouseEvent): void {
        this.document.visualization.eventHandler.mouseUp(view, event);
        this.document.visualization.viewHandler.mouseUp(view, event);
    }

    private mouseOut(view: IView, event: MouseEvent): void {
        this.document.visualization.eventHandler.mouseOut(view, event);
        this.document.visualization.viewHandler.mouseOut(view, event);
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
    }

    private touchStart(view: IView, event: TouchEvent): void {
        this.document.visualization.eventHandler.touchStart(view, event);
    }

    private touchMove(view: IView, event: TouchEvent): void {
        this.document.visualization.eventHandler.touchMove(view, event);
    }

    private touchEnd(view: IView, event: TouchEvent): void {
        this.document.visualization.eventHandler.touchEnd(view, event);
    }
}
