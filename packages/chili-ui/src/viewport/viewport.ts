// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IDocument, Plane, PubSub, XYZ } from "chili-core";
import { Control, Flyout, Panel } from "../components";
import style from "./viewport.module.css";

export class Viewport extends Control {
    readonly flyout: Flyout = new Flyout();
    readonly viewDom = new Panel(style.view);

    constructor() {
        super(style.root);
        this.append(this.viewDom, this.flyout);
        this.addEventListener("mousemove", this.handleMouseMove);
        PubSub.default.sub("activeDocumentChanged", this.handleActiveDocumentChanged);
        PubSub.default.sub("documentClosed", (d) => this.clearViews());
    }

    private handleMouseMove(e: MouseEvent) {
        this.flyout.style.top = e.clientY + "px";
        this.flyout.style.left = e.clientX + "px";
    }

    private clearViews() {
        this.viewDom.clearChildren();
    }

    private createView(document: IDocument) {
        document.visual.viewer
            .createView("3D", Plane.XY, this.viewDom)
            .cameraController.lookAt(new XYZ(1000, 1000, 1000), XYZ.zero);
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
