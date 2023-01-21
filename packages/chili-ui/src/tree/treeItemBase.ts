// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { IDocument, ModelObject } from "chili-core";
import { Transaction } from "chili-core/src/transaction";
import { Constants, IDisposable } from "chili-shared";
import { Control } from "../control";
import style from "./treeItemBase.module.css";

export const DragIdFormat = "text/id";

export abstract class TreeItemBase implements IDisposable {
    readonly dom: HTMLDivElement;
    readonly text: HTMLSpanElement;
    readonly icon: SVGSVGElement;

    constructor(readonly document: IDocument, readonly model: ModelObject, div: HTMLDivElement, className: string) {
        this.dom = div;
        this.dom.className = className;
        this.dom.draggable = true;
        this.text = Control.textSpan(this.model.name, style.itemText);
        this.icon = Control.svg(this.getVisibleIcon(model.visible), style.itemVisibleIcon);
        this.text.setAttribute(Constants.ModelIdAttribute, this.model.id);
        this.icon.addEventListener("click", this._handleVisibleClick);
        model.onPropertyChanged(this.propertyChanged);

        this.dom.addEventListener("dragstart", this.onDragStart);
        this.dom.addEventListener("dragover", this.onDragOver);
        this.dom.addEventListener("dragleave", this.onDragLeave);
        this.dom.addEventListener("drop", this.onDrop);
    }

    dispose() {
        this.model.removePropertyChanged(this.propertyChanged);
        this.icon.removeEventListener("click", this._handleVisibleClick);
    }

    private _handleVisibleClick = () => {
        this.handleVisibleClick();
        this.document.viewer.redraw();
    };

    protected abstract handleVisibleClick(): void;

    private getVisibleIcon(visible: boolean) {
        return visible === true ? "icon-eye" : "icon-eye-slash";
    }

    private propertyChanged = (source: ModelObject, property: keyof ModelObject, oldValue: any, newValue: any) => {
        if (property === "name") {
            this.text.textContent = newValue;
        } else if (property === "visible") {
            Control.setSvgIcon(this.icon, this.getVisibleIcon(this.model.visible));
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

    protected abstract handleDrop(model: ModelObject): void;

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
            let parent = this.model.parent;
            while (parent) {
                if (id === parent.id) {
                    isDragCurrent = true;
                    break;
                }
                parent = parent.parent;
            }
        }

        return isDragCurrent;
    }
}
