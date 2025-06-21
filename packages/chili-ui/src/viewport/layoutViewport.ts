// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    CollectionAction,
    CollectionChangedArgs,
    CursorType,
    IApplication,
    IView,
    PubSub
} from "chili-core";
import { Cursor } from "../cursor";
import style from "./layoutViewport.module.css";
import { Viewport } from "./viewport";

export class LayoutViewport extends HTMLElement {
    private readonly _viewports: Map<IView, Viewport> = new Map();

    constructor(readonly app: IApplication, readonly showViewControls: boolean = true) {
        super();
        this.className = style.root;
        app.views.onCollectionChanged(this._handleViewCollectionChanged);
    }

    private readonly _handleViewCollectionChanged = (args: CollectionChangedArgs) => {
        if (args.action === CollectionAction.add) {
            args.items.forEach((view) => {
                this.createViewport(view);
            });
        } else if (args.action === CollectionAction.remove) {
            args.items.forEach((view) => {
                let viewport = this._viewports.get(view);
                viewport?.remove();
                viewport?.dispose();
                this._viewports.delete(view);
            });
        }
    };

    connectedCallback(): void {
        PubSub.default.sub("activeViewChanged", this._handleActiveViewChanged);
        PubSub.default.sub("viewCursor", this._handleCursor);
    }

    disconnectedCallback(): void {
        PubSub.default.remove("activeViewChanged", this._handleActiveViewChanged);
        PubSub.default.remove("viewCursor", this._handleCursor);
    }

    private readonly _handleCursor = (type: CursorType) => {
        this.style.cursor = Cursor.get(type);
    };

    private createViewport(view: IView) {
        let viewport = new Viewport(view, this.showViewControls);
        viewport.classList.add(style.viewport, style.hidden);
        this.appendChild(viewport);
        this._viewports.set(view, viewport);
        return viewport;
    }

    private readonly _handleActiveViewChanged = (view: IView | undefined) => {
        this._viewports.forEach((v) => {
            if (v.view === view) {
                v.classList.remove(style.hidden);
            } else {
                v.classList.add(style.hidden);
            }
        });
    };
}

customElements.define("chili-viewport", LayoutViewport);
