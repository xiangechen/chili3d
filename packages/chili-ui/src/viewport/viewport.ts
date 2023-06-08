// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument, Plane, PubSub, XYZ } from "chili-core";
import { Control, Flyout, Panel } from "../components";
import style from "./viewport.module.css";

export class Viewport extends Control {
    readonly viewTop: Panel = new Panel(style.view);
    readonly viewFront: Panel = new Panel(style.view);
    readonly view3D: Panel = new Panel(style.view);
    readonly viewRight: Panel = new Panel(style.view);
    readonly flyout: Flyout = new Flyout();

    constructor() {
        super(style.root);
        this.append(this.viewTop, this.view3D, this.viewFront, this.viewRight, this.flyout);
        this.addEventListener("mousemove", this.handleMouseMove);
        PubSub.default.sub("activeDocumentChanged", this.handleActiveDocumentChanged);
    }

    private handleMouseMove(e: MouseEvent) {
        this.flyout.style.top = e.clientY + "px";
        this.flyout.style.left = e.clientX + "px";
    }

    private handleActiveDocumentChanged = (document: IDocument | undefined) => {
        this.viewTop.clearChildren();
        this.viewFront.clearChildren();
        this.view3D.clearChildren();
        this.viewRight.clearChildren();

        if (document !== undefined) {
            document.visual.viewer
                .createView("Top", Plane.XY, this.viewTop)
                .lookAt(new XYZ(0, 0, 1000), XYZ.zero);
            document.visual.viewer.createView("3D", Plane.XY, this.view3D);
            document.visual.viewer
                .createView("Front", Plane.ZX, this.viewFront)
                .lookAt(new XYZ(0, 1000, 0), XYZ.zero);
            document.visual.viewer
                .createView("Right", Plane.YZ, this.viewRight)
                .lookAt(new XYZ(1000, 0, 0), XYZ.zero);
            document.visual.viewer.redraw();
        }
    };
}

customElements.define("chili-viewport", Viewport);
