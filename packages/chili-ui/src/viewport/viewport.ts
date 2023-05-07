// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument, Plane, PubSub } from "chili-core";
import { Control, Panel } from "../components";
import { ViewControl } from "./view";
import style from "./viewport.module.css";

export class Viewport extends Control {
    readonly viewTop: Panel = new Panel(style.view);
    readonly viewFront: Panel = new Panel(style.view);
    readonly view3D: Panel = new Panel(style.view);
    readonly viewRight: Panel = new Panel(style.view);

    constructor() {
        super(style.root);
        this.append(this.viewTop, this.view3D, this.viewFront, this.viewRight);
        PubSub.default.sub("activeDocumentChanged", this.handleActiveDocumentChanged);
    }
    private handleActiveDocumentChanged = (document: IDocument | undefined) => {
        this.viewTop.clearChildren();
        this.viewFront.clearChildren();
        this.view3D.clearChildren();
        this.viewRight.clearChildren();

        if (document !== undefined) {
            document.visualization.viewFactory.create("Top", Plane.XY, this.viewTop);
            document.visualization.viewFactory.create("3D", Plane.XY, this.view3D);
            document.visualization.viewFactory.create("Front", Plane.ZX, this.viewFront);
            document.visualization.viewFactory.create("Right", Plane.YZ, this.viewRight);
            document.visualization.viewer.redraw();
        }
    };
}

customElements.define("chili-viewport", Viewport);
