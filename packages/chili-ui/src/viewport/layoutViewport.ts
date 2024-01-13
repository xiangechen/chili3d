// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IDocument, IView, Plane, PubSub, XYZ } from "chili-core";
import { BindableElement } from "../controls";
import style from "./layoutViewport.module.css";
import { Viewport } from "./viewport";

export class LayoutViewport extends BindableElement {
    readonly #viewports: Viewport[] = [];

    constructor() {
        super();
        this.className = style.root;

        PubSub.default.sub("activeViewChanged", this.#handleActiveViewChanged);
        PubSub.default.sub("activeDocumentChanged", this.#handleActiveDocumentChanged);
        PubSub.default.sub("documentClosed", (d) => this.clearViewports());
    }

    private clearViewports() {
        this.#viewports.forEach((v) => {
            v.view.close();
        });
        this.#viewports.length = 0;
    }

    private createView(document: IDocument) {
        let view = document.visual.viewer.createView("3D", Plane.XY);
        view.cameraController.lookAt(new XYZ(1000, 1000, 1000), XYZ.zero, XYZ.unitZ);
        let viewport = new Viewport(view);
        viewport.classList.add(style.viewport);
        this.appendChild(viewport);
        this.#viewports.push(viewport);
        view.setDom(viewport);
        document.visual.viewer.update();
    }

    #handleActiveViewChanged = (view: IView | undefined) => {
        this.#viewports.forEach((v) => {
            v.setActive(v.view === view);
        });
    };

    #handleActiveDocumentChanged = (document: IDocument | undefined) => {
        this.clearViewports();
        if (document !== undefined) {
            this.createView(document);
            document.visual.viewer.activeView = this.#viewports.at(-1)?.view;
        }
    };
}

customElements.define("chili-viewport", LayoutViewport);
