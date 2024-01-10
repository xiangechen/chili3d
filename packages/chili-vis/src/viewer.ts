// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { CursorType, IView, IViewer, IVisual, Plane } from "chili-core";

export abstract class Viewer implements IViewer {
    private readonly _views: Set<IView>;

    private _activeView?: IView;
    get activeView(): IView | undefined {
        return this._activeView;
    }
    set activeView(value: IView) {
        if (this._activeView === value) return;
        this._activeView = value;
    }

    constructor(readonly visual: IVisual) {
        this._views = new Set<IView>();
    }

    createView(name: string, workplane: Plane): IView {
        let view = this.handleCreateView(name, workplane);
        this._views.add(view);
        if (this._activeView === undefined) this._activeView = view;
        return view;
    }

    protected abstract handleCreateView(name: string, workplane: Plane): IView;

    removeView(view: IView) {
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
        this._views.clear();
    }
}
