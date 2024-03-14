// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IView, IViewer, IVisual, Plane, PubSub } from "chili-core";

export abstract class Viewer implements IViewer {
    private readonly _views: Set<IView>;

    private _activeView?: IView;
    get activeView(): IView | undefined {
        return this._activeView;
    }
    set activeView(value: IView | undefined) {
        if (this._activeView === value) return;
        this._activeView = value;
        PubSub.default.pub("activeViewChanged", value);
    }

    constructor(readonly visual: IVisual) {
        this._views = new Set<IView>();
    }

    createView(name: string, workplane: Plane): IView {
        let view = this.handleCreateView(name, workplane);
        this._views.add(view);
        return view;
    }

    protected abstract handleCreateView(name: string, workplane: Plane): IView;

    removeView(view: IView) {
        this._views.delete(view);
        if (this.activeView === view) {
            this.activeView = [...this._views].at(0);
        }
    }

    views(): readonly IView[] {
        return [...this._views];
    }

    update() {
        this._views.forEach((v) => {
            v.update();
        });
    }

    dispose() {
        this.activeView = undefined;
        this._views.clear();
    }
}
