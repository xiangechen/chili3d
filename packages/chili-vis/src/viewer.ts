// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { CursorType, IView, IViewer, IVisual, Plane, PubSub } from "chili-core";

export abstract class Viewer implements IViewer {
    readonly #views: Set<IView>;

    #activeView?: IView;
    get activeView(): IView | undefined {
        return this.#activeView;
    }
    set activeView(value: IView | undefined) {
        if (this.#activeView === value) return;
        this.#activeView = value;
        PubSub.default.pub("activeViewChanged", value);
    }

    constructor(readonly visual: IVisual) {
        this.#views = new Set<IView>();
    }

    createView(name: string, workplane: Plane): IView {
        let view = this.handleCreateView(name, workplane);
        this.#views.add(view);
        return view;
    }

    protected abstract handleCreateView(name: string, workplane: Plane): IView;

    removeView(view: IView) {
        this.#views.delete(view);
        if (this.activeView === view) {
            this.activeView = [...this.#views].at(0);
        }
    }

    views(): readonly IView[] {
        return [...this.#views];
    }

    setCursor(cursor: CursorType) {
        this.#views.forEach((x) => x.setCursor(cursor));
    }

    update() {
        this.#views.forEach((v) => {
            v.update();
        });
    }

    dispose() {
        this.activeView = undefined;
        this.#views.clear();
    }
}
