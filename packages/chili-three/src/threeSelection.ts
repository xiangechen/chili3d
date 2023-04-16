// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    Constants,
    IDocument,
    ISelection,
    IShape,
    IView,
    IVisualizationShape,
    IModel,
    Observable,
    PubSub,
    ShapeType,
    INode,
} from "chili-core";
import { Object3D, Raycaster } from "three";

import { ThreeShape } from "./threeShape";
import { ThreeUtils } from "./threeUtils";
import { ThreeVisulizationContext } from "./threeVisulizationContext";

export class ThreeSelection extends Observable implements ISelection {
    private _selectedNodes: INode[] = [];
    private _unselectedNodes: INode[] = [];
    private _shapeType: ShapeType = ShapeType.Shape;

    constructor(readonly document: IDocument, readonly context: ThreeVisulizationContext) {
        super();
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

    getSelectedNodes(): INode[] {
        return this._selectedNodes;
    }

    select(view: IView, x: number, y: number, shiftDown: boolean) {
        let intersect = this.detected(view, x, y, true)?.at(0)?.parent?.parent;
        if (intersect === undefined) {
            this.clearSelected();
            return;
        }
        let node = view.document.nodes.get(intersect!.name) as IModel;
        if (node !== undefined) this.setSelected(shiftDown, [node]);
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

    setSelected(toggle: boolean, nodes: INode[]) {
        if (toggle) {
            this.toggleSelectPublish(nodes, true);
        } else {
            this.removeSelectedPublish(this._selectedNodes, false);
            this.addSelectPublish(nodes, true);
        }
    }

    unSelected(nodes: INode[]) {
        this.removeSelectedPublish(nodes, true);
    }

    clearSelected() {
        this.removeSelectedPublish(this._selectedNodes, true);
    }

    private publishSelection() {
        PubSub.default.pub("selectionChanged", this.document, this._selectedNodes, this._unselectedNodes);
    }

    private toggleSelectPublish(nodes: INode[], publish: boolean) {
        let selected = nodes.filter((m) => this._selectedNodes.includes(m));
        let unSelected = nodes.filter((m) => !this._selectedNodes.includes(m));
        this.removeSelectedPublish(selected, false);
        this.addSelectPublish(unSelected, publish);
    }

    private addSelectPublish(nodes: INode[], publish: boolean) {
        nodes.forEach((m) => {
            if (INode.isModelNode(m)) {
                this.context.getShape(m)?.selectedState();
            }
        });
        this._selectedNodes.push(...nodes);
        if (publish) this.publishSelection();
    }

    private removeSelectedPublish(nodes: INode[], publish: boolean) {
        for (const node of nodes) {
            if (INode.isModelNode(node)) {
                this.context.getShape(node)?.unSelectedState();
            }
        }
        this._selectedNodes = this._selectedNodes.filter((m) => !nodes.includes(m));
        this._unselectedNodes = nodes;
        if (publish) this.publishSelection();
    }
}
