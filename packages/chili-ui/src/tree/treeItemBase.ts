// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument } from "chili-core";
import { Transaction } from "chili-core/src/transaction";
import { IModelObject } from "chili-geo";
import { Constants, IDisposable } from "chili-shared";
import { Control, Div, Svg, TextBlock } from "../controls";
import style from "./treeItemBase.module.css";

export const DragIdFormat = "text/id";

export abstract class TreeItemBase extends Control implements IDisposable {
    readonly text: TextBlock;
    readonly icon: Svg;

    constructor(readonly document: IDocument, readonly model: IModelObject, div: Div, className: string) {
        super(div.dom, className);
        this.dom.draggable = true;
        this.text = new TextBlock(this.model.name, style.itemText);
        this.icon = new Svg(this.getVisibleIcon(model.visible), style.itemVisibleIcon);
        this.text.setAttribute(Constants.ModelIdAttribute, this.model.id);
        this.icon.dom.addEventListener("click", this._handleVisibleClick);
        model.onPropertyChanged(this.propertyChanged);

        this.dom.addEventListener("dragstart", this.onDragStart);
        this.dom.addEventListener("dragover", this.onDragOver);
        this.dom.addEventListener("dragleave", this.onDragLeave);
        this.dom.addEventListener("drop", this.onDrop);
    }

    dispose() {
        this.model.removePropertyChanged(this.propertyChanged);
        this.icon.dom.removeEventListener("click", this._handleVisibleClick);
    }

    private _handleVisibleClick = () => {
        this.handleVisibleClick();
        this.document.viewer.redraw();
    };

    protected abstract handleVisibleClick(): void;

    private getVisibleIcon(visible: boolean) {
        return visible === true ? "icon-eye" : "icon-eye-slash";
    }

    private propertyChanged = (source: IModelObject, property: keyof IModelObject, oldValue: any, newValue: any) => {
        if (property === "name") {
            this.text.text = newValue;
        } else if (property === "visible") {
            this.icon.setIcon(this.getVisibleIcon(this.model.visible));
        }
    };

    private onDragLeave = (event: DragEvent) => {
        if (this.isDragCurrent(event)) return;
    };

    private onDragOver = (event: DragEvent) => {
        if (this.isDragCurrent(event)) return;
        event.preventDefault();
        event.dataTransfer!.dropEffect = "move";
    };

    protected onDrop = (event: DragEvent) => {
        if (this.isDragCurrent(event)) return;
        event.preventDefault();
        event.stopPropagation();
        let modelId = event.dataTransfer?.getData(DragIdFormat);
        if (modelId === undefined) return;
        let model = this.document.getModel(modelId);
        if (model === undefined) return;
        Transaction.excute(this.document, "set parent", () => {
            this.handleDrop(model!);
        });
    };

    protected abstract handleDrop(model: IModelObject): void;

    private onDragStart = (event: DragEvent) => {
        event.stopPropagation();
        event.dataTransfer?.setData(DragIdFormat, this.model.id);
    };

    protected isDragCurrent(event: DragEvent) {
        let id = event.dataTransfer?.getData(DragIdFormat);
        let isDragCurrent = false;
        if (id === this.model.id) {
            isDragCurrent = true;
        } else {
            let parentId = this.model.parentId;
            while (parentId) {
                if (id === parentId) {
                    isDragCurrent = true;
                    break;
                }
                parentId = this.document.getModel(parentId)?.parentId;
            }
        }
        return isDragCurrent;
    }
}
