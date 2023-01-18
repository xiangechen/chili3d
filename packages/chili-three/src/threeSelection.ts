// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { Constants, Observable, ShapeType } from "chili-shared";
import { IVisualizationShape, ISelection, IView } from "chili-vis";
import { Line, Mesh, Object3D, Raycaster, Vector3 } from "three";
import { IDocument, PubSub } from "chili-core";
import { ThreeVisulizationContext } from "./threeVisulizationContext";
import { ThreeShape } from "./threeShape";
import { IEdge, IModel, IModelObject, IShape } from "chili-geo";
import { ThreeUtils } from "./threeUtils";

export class ThreeSelection extends Observable implements ISelection {
    private readonly _selectedModels: Set<IModelObject>;
    private _shapeType: ShapeType;

    constructor(readonly document: IDocument, readonly context: ThreeVisulizationContext) {
        super();
        this._shapeType = ShapeType.Shape;
        this._selectedModels = new Set<IModelObject>();
    }

    detectedModel(view: IView, x: number, y: number): IVisualizationShape | undefined {
        return this.detected(view, x, y, true)?.at(0)?.parent?.parent as ThreeShape;
    }

    setSelectionType(type: ShapeType): void {
        this._shapeType = type;
    }

    detectedShape(view: IView, x: number, y: number): IShape | undefined {
        let obj = this.detected(view, x, y, true)?.at(0);
        if (obj === undefined) return undefined;
        return obj.userData[Constants.ShapeKey];
    }

    detectedShapes(view: IView, x: number, y: number): IShape[] | undefined {
        let objs = this.detected(view, x, y, false);
        return objs?.map((x) => x.userData[Constants.ShapeKey]);
    }

    getSelectedModels(): IModelObject[] {
        return [...this._selectedModels];
    }

    select(view: IView, x: number, y: number, shiftDown: boolean) {
        let intersect = this.detected(view, x, y, true)?.at(0)?.parent?.parent;
        if (intersect === undefined) {
            this.clearSelected();
            return;
        }
        let model = view.document.getModel(intersect!.name);
        if (model !== undefined) this.setSelectedObserver(shiftDown, true, model);
    }

    setSelected(shift: boolean, ...models: IModelObject[]) {
        this.setSelectedObserver(shift, true, ...models);
    }

    private setSelectedObserver(shift: boolean, publish: boolean, ...models: IModelObject[]) {
        if (shift) {
            this.shiftSelect(models);
        } else {
            this.clearSelected();
            this.setToSelected(...models);
        }
        if (publish) this.publishSelection();
    }

    unSelected(...models: IModelObject[]) {
        this.unSelectedObserver(true, models);
    }

    clearSelected() {
        this.unSelectedObserver(true, this._selectedModels);
    }

    private unSelectedObserver(publish: boolean, models: Set<IModelObject> | IModelObject[]) {
        models.forEach((m) => {
            this.removeSelectedStatus(m);
            this._selectedModels.delete(m);
        });
        if (publish) this.publishSelection();
    }

    private publishSelection() {
        PubSub.default.pub("selectionChanged", this.document, [...this._selectedModels]);
    }

    private detected(view: IView, x: number, y: number, firstHitOnly: boolean) {
        let ray = view.rayAt(x, y);
        let raycaster = new Raycaster();
        let threshold = 10 * view.scale;
        raycaster.params = { Line: { threshold }, Points: { threshold } };
        raycaster.set(ThreeUtils.fromXYZ(ray.location), ThreeUtils.fromXYZ(ray.direction));
        raycaster.firstHitOnly = firstHitOnly;
        let threeShapes = this.context.getThreeShapes();
        let shapes = new Array<Object3D>();
        threeShapes.forEach((x) => {
            if (this._shapeType === ShapeType.Shape || this._shapeType === ShapeType.Edge) {
                let lines = x.wireframe();
                if (lines !== undefined) shapes.push(...lines);
            }
            if (this._shapeType === ShapeType.Shape || this._shapeType === ShapeType.Face) {
                let faces = x.faces();
                if (faces !== undefined) shapes.push(...faces);
            }
        });
        return raycaster.intersectObjects(shapes, false).map((x) => x.object);
    }

    private shiftSelect(models: IModelObject[]) {
        models.forEach((m) => {
            if (this._selectedModels.has(m)) {
                this._selectedModels.delete(m);
                this.removeSelectedStatus(m);
            } else {
                this.setToSelected(m);
            }
        });
    }

    private setToSelected(...models: IModelObject[]) {
        models.forEach((m) => {
            let shape = this.context.getShape(m);
            if (shape !== undefined) {
                shape.selectedState();
                this._selectedModels.add(m);
            }
        });
    }

    private removeSelectedStatus(model: IModelObject) {
        let shape = this.context.getShape(model);
        if (shape !== undefined) shape.unSelectedState();
    }
}
