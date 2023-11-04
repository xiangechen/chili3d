// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { CursorType, IView, IViewer, IVisual, Plane, debounce } from "chili-core";

interface EventData {
    container: HTMLElement | Window;
    type: string;
    callback: (e: any) => void;
}

export abstract class Viewer implements IViewer {
    #resizeObserver: ResizeObserver;
    private readonly _views: Set<IView>;
    private readonly _eventCaches: Map<IView, EventData[]>;

    private _activeView?: IView;
    get activeView(): IView | undefined {
        return this._activeView;
    }
    set acitveView(value: IView) {
        if (this._activeView === value) return;
        this._activeView = value;
    }

    constructor(readonly visual: IVisual) {
        this._views = new Set<IView>();
        this._eventCaches = new Map();
        let resizerObserverCallback = debounce(this.#resizerObserverCallback, 100);
        this.#resizeObserver = new ResizeObserver(resizerObserverCallback);
    }

    #resizerObserverCallback = (entries: ResizeObserverEntry[]) => {
        for (const entry of entries) {
            this._views.forEach((view) => {
                if (view.container === entry.target) {
                    view.resize(entry.contentRect.width, entry.contentRect.height);
                }
            });
        }
    };

    createView(name: string, workplane: Plane, dom: HTMLElement): IView {
        let view = this.handleCreateView(name, workplane, dom);
        this._views.add(view);
        this.#resizeObserver.observe(view.container);
        this.initEvent(view);
        if (this._activeView === undefined) this._activeView = view;
        return view;
    }

    protected abstract handleCreateView(name: string, workplane: Plane, dom: HTMLElement): IView;

    removeView(view: IView) {
        this.removeEvents(view);
        this._views.delete(view);
        if (this._activeView === view) {
            this._activeView = [...this._views].at(0);
        }
    }

    views(): readonly IView[] {
        return [...this._views];
    }

    setCursor(cursor: CursorType) {
        this._views.forEach((x) => x.setCursor(cursor));
    }

    update() {
        this._views.forEach((v) => {
            v.update();
        });
    }

    dispose() {
        this._activeView = undefined;
        this._views.forEach((v) => {
            this.removeEvents(v);
        });
        this._views.clear();
        this._eventCaches.clear();

        this.#resizeObserver.disconnect();
    }

    private initEvent(view: IView) {
        let events: [keyof HTMLElementEventMap, (view: IView, e: any) => any][] = [
            ["pointerdown", this.pointerDown],
            ["pointermove", this.pointerMove],
            ["pointerout", this.pointerOut],
            ["pointerup", this.pointerUp],
            ["wheel", this.mouseWheel],
        ];
        events.forEach((v) => {
            this.addEventListener(view.container, view, v[0], v[1]);
        });
    }

    private addEventListener(
        container: HTMLElement | Window,
        view: IView,
        type: keyof HTMLElementEventMap,
        handler: (view: IView, e: any) => any,
    ) {
        let listener = (e: any) => {
            e.preventDefault();
            handler(view, e);
        };
        container.addEventListener(type, listener);
        let cache = this._eventCaches.get(view);
        if (cache === undefined) {
            cache = [];
            this._eventCaches.set(view, cache);
        }
        cache.push({
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
        this.#resizeObserver.unobserve(view.container);
    }

    private pointerMove = (view: IView, event: PointerEvent) => {
        this.visual.eventHandler.pointerMove(view, event);
        this.visual.viewHandler.pointerMove(view, event);
    };

    private pointerDown = (view: IView, event: PointerEvent) => {
        this.acitveView = view;
        this.visual.eventHandler.pointerDown(view, event);
        this.visual.viewHandler.pointerDown(view, event);
    };

    private pointerUp = (view: IView, event: PointerEvent) => {
        this.visual.eventHandler.pointerUp(view, event);
        this.visual.viewHandler.pointerUp(view, event);
    };

    private pointerOut = (view: IView, event: PointerEvent) => {
        this.visual.eventHandler.pointerOut?.(view, event);
        this.visual.viewHandler.pointerOut?.(view, event);
    };

    private mouseWheel = (view: IView, event: WheelEvent) => {
        this.visual.eventHandler.mouseWheel?.(view, event);
        this.visual.viewHandler.mouseWheel?.(view, event);
    };
}
