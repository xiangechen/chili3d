// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    CollectionAction,
    CollectionChangedArgs,
    CursorType,
    IApplication,
    IDocument,
    IView,
    Material,
    PubSub,
} from "chili-core";
import { OKCancel } from "../components/okCancel";
import { Cursor } from "../cursor";
import { MaterialEditor } from "../property/material";
import { MaterialDataContent } from "../property/material/materialDataContent";
import style from "./layoutViewport.module.css";
import { Viewport } from "./viewport";

export class LayoutViewport extends HTMLElement {
    private readonly _selectionController: OKCancel;
    private readonly _viewports: Map<IView, Viewport> = new Map();

    constructor(readonly app: IApplication) {
        super();
        this.className = style.root;
        this._selectionController = new OKCancel();
        this.append(this._selectionController);
        this.clearSelectionControl();
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
        PubSub.default.sub("showSelectionControl", this.showSelectionControl);
        PubSub.default.sub("editMaterial", this._handleMaterialEdit);
        PubSub.default.sub("clearSelectionControl", this.clearSelectionControl);
        PubSub.default.sub("viewCursor", this._handleCursor);
    }

    disconnectedCallback(): void {
        PubSub.default.remove("activeViewChanged", this._handleActiveViewChanged);
        PubSub.default.remove("showSelectionControl", this.showSelectionControl);
        PubSub.default.remove("editMaterial", this._handleMaterialEdit);
        PubSub.default.remove("clearSelectionControl", this.clearSelectionControl);
        PubSub.default.remove("viewCursor", this._handleCursor);
    }

    private readonly _handleCursor = (type: CursorType) => {
        this.style.cursor = Cursor.get(type);
    };

    private createViewport(view: IView) {
        let viewport = new Viewport(view);
        viewport.classList.add(style.viewport, style.hidden);
        this.appendChild(viewport);
        this._viewports.set(view, viewport);
        view.setDom(viewport);
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

    private readonly showSelectionControl = (controller: AsyncController) => {
        this._selectionController.setControl(controller);
        this._selectionController.style.visibility = "visible";
        this._selectionController.style.zIndex = "1000";
    };

    private readonly clearSelectionControl = () => {
        this._selectionController.setControl(undefined);
        this._selectionController.style.visibility = "hidden";
    };

    private readonly _handleMaterialEdit = (
        document: IDocument,
        editingMaterial: Material,
        callback: (material: Material) => void,
    ) => {
        let context = new MaterialDataContent(document, callback, editingMaterial);
        this.append(new MaterialEditor(context));
    };
}

customElements.define("chili-viewport", LayoutViewport);
