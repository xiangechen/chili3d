// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { IDocument, Plane, PubSub, XYZ } from "chili-core";
import { Control, Flyout, Panel } from "../components";
import style from "./viewport.module.css";

export class Viewport extends Control {
    readonly flyout: Flyout = new Flyout();
    readonly viewDoms: Panel[] = [];

    constructor() {
        super(style.root);
        this.append(this.flyout);
        this.addEventListener("mousemove", this.handleMouseMove);
        PubSub.default.sub("activeDocumentChanged", this.handleActiveDocumentChanged);
        PubSub.default.sub("documentClosed", (d) => this.clearViews());
    }

    private handleMouseMove(e: MouseEvent) {
        this.flyout.style.top = e.clientY + "px";
        this.flyout.style.left = e.clientX + "px";
    }

    private clearViews() {
        this.viewDoms.forEach((v) => v.clearChildren());
        this.viewDoms.length = 0;
    }

    private createViews(document: IDocument) {
        let viewInfos: [string, Plane, XYZ][] = [
            // ["Top", Plane.XY, new XYZ(0, 0, 1000)],
            // ["Front", Plane.ZX, new XYZ(0, 1000, 0)],
            ["3D", Plane.XY, new XYZ(1000, 1000, 1000)],
            // ["Right", Plane.YZ, new XYZ(1000, 0, 0)],
        ];
        viewInfos.forEach((info) => {
            let dom = new Panel(style.view);
            this.append(dom);
            document.visual.viewer.createView(info[0], info[1], dom).lookAt(info[2], XYZ.zero);
        });
        document.visual.viewer.redraw();
    }

    private handleActiveDocumentChanged = (document: IDocument | undefined) => {
        this.clearViews();
        if (document !== undefined) {
            this.createViews(document);
        }
    };
}

customElements.define("chili-viewport", Viewport);
