// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IDocument, Plane, PubSub, XYZ } from "chili-core";
import { Flyout } from "../components";
import { BindableElement } from "../controls";
import { UIView } from "./uiview";
import style from "./viewport.module.css";

export class Viewport extends BindableElement {
    #flyout: Flyout = new Flyout();
    #uiviews: UIView[] = [];

    constructor() {
        super();
        this.className = style.root;
        document.body.appendChild(this.#flyout);
        this.addEventListener("mousemove", this.handleMouseMove);
        PubSub.default.sub("activeDocumentChanged", this.handleActiveDocumentChanged);
        PubSub.default.sub("documentClosed", (d) => this.clearViews());
    }

    private handleMouseMove(e: MouseEvent) {
        this.#flyout.style.top = e.clientY + "px";
        this.#flyout.style.left = e.clientX + "px";
    }

    private clearViews() {
        this.#uiviews.forEach((v) => {
            v.view.close();
        });
        this.#uiviews = [];
    }

    private createView(document: IDocument) {
        let view = document.visual.viewer.createView("3D", Plane.XY);
        view.cameraController.lookAt(new XYZ(1000, 1000, 1000), XYZ.zero, XYZ.unitZ);
        let uiview = new UIView(view);
        this.appendChild(uiview);
        this.#uiviews.push(uiview);
        view.setDom(uiview);
        document.visual.viewer.update();
    }

    private handleActiveDocumentChanged = (document: IDocument | undefined) => {
        this.clearViews();
        if (document !== undefined) {
            this.createView(document);
        }
    };
}

customElements.define("chili-viewport", Viewport);
