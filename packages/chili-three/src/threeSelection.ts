// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    Constants,
    IDocument,
    ISelection,
    IShape,
    IView,
    IVisualizationShape,
    ModelObject,
    Observable,
    PubSub,
    ShapeType,
} from "chili-core";
import { Object3D, Raycaster } from "three";

import { ThreeShape } from "./threeShape";
import { ThreeUtils } from "./threeUtils";
import { ThreeVisulizationContext } from "./threeVisulizationContext";

export class ThreeSelection extends Observable implements ISelection {
    private readonly _selectedModels: Set<ModelObject>;
    private _shapeType: ShapeType;

    constructor(readonly document: IDocument, readonly context: ThreeVisulizationContext) {
        super();
        this._shapeType = ShapeType.Shape;
        this._selectedModels = new Set<ModelObject>();
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

    detectedShapes(view: IView, x: number, y: number): IShape[] {
        let objs = this.detected(view, x, y, false);
        return objs.map((x) => x.userData[Constants.ShapeKey]);
    }

    getSelectedModels(): ModelObject[] {
        return [...this._selectedModels];
    }

    select(view: IView, x: number, y: number, shiftDown: boolean) {
        let intersect = this.detected(view, x, y, true)?.at(0)?.parent?.parent;
        if (intersect === undefined) {
            this.clearSelected();
            return;
        }
        let model = view.document.models.get(intersect!.name);
        if (model !== undefined) this.setSelectedObserver(shiftDown, true, model);
    }

    setSelected(shift: boolean, ...models: ModelObject[]) {
        this.setSelectedObserver(shift, true, ...models);
    }

    private setSelectedObserver(shift: boolean, publish: boolean, ...models: ModelObject[]) {
        if (shift) {
            this.shiftSelect(models);
        } else {
            this.clearSelected();
            this.setToSelected(...models);
        }
        if (publish) this.publishSelection();
    }

    unSelected(...models: ModelObject[]) {
        this.unSelectedObserver(true, models);
    }

    clearSelected() {
        this.unSelectedObserver(true, this._selectedModels);
    }

    private unSelectedObserver(publish: boolean, models: Set<ModelObject> | ModelObject[]) {
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

    private shiftSelect(models: ModelObject[]) {
        models.forEach((m) => {
            if (this._selectedModels.has(m)) {
                this._selectedModels.delete(m);
                this.removeSelectedStatus(m);
            } else {
                this.setToSelected(m);
            }
        });
    }

    private setToSelected(...models: ModelObject[]) {
        models.forEach((m) => {
            let shape = this.context.getShape(m);
            if (shape !== undefined) {
                shape.selectedState();
                this._selectedModels.add(m);
            }
        });
    }

    private removeSelectedStatus(model: ModelObject) {
        let shape = this.context.getShape(model);
        if (shape !== undefined) shape.unSelectedState();
    }
}
