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
import { ThreeHelper } from "./threeHelper";
import { ThreeVisulizationContext } from "./threeVisulizationContext";
import ThreeView from "./threeView";

export class ThreeSelection extends Observable implements ISelection {
    private _selectedNodes: INode[] = [];
    private _unselectedNodes: INode[] = [];

    constructor(readonly view: ThreeView, readonly context: ThreeVisulizationContext) {
        super();
    }

    detectedModel(x: number, y: number): IVisualizationShape | undefined {
        return this.detected(x, y, true)?.at(0)?.parent?.parent as ThreeShape;
    }

    detectedShapes(x: number, y: number): IShape[] {
        let objs = this.detected(x, y, false);
        return objs.map((x) => x.userData[Constants.ShapeKey]);
    }

    getSelectedNodes(): INode[] {
        return this._selectedNodes;
    }

    select(x: number, y: number, shiftDown: boolean) {
        let intersect = this.detected(x, y, true)?.at(0)?.parent?.parent;
        if (intersect === undefined) {
            this.clearSelected();
            return [];
        }
        let node = this.view.viewer.document.nodes.get(intersect!.name) as IModel;
        if (node !== undefined) this.setSelected(shiftDown, [node]);
    }

    private detected(x: number, y: number, firstHitOnly: boolean) {
        let raycaster = this.initRaycaster(x, y, firstHitOnly);
        let shapes = new Array<Object3D>();
        let threeShapes = this.context.getThreeShapes();
        threeShapes.forEach((x) => {
            if (
                this.view.viewer.selectionType === ShapeType.Shape ||
                this.view.viewer.selectionType === ShapeType.Edge
            ) {
                let lines = x.wireframe();
                if (lines !== undefined) shapes.push(...lines);
            }
            if (
                this.view.viewer.selectionType === ShapeType.Shape ||
                this.view.viewer.selectionType === ShapeType.Face
            ) {
                let faces = x.faces();
                if (faces !== undefined) shapes.push(...faces);
            }
        });
        return raycaster.intersectObjects(shapes, false).map((x) => x.object);
    }

    private initRaycaster(x: number, y: number, firstHitOnly: boolean) {
        let threshold = 10 * this.view.scale;
        let ray = this.view.rayAt(x, y);
        let raycaster = new Raycaster();
        raycaster.params = { Line: { threshold }, Points: { threshold } };
        raycaster.set(ThreeHelper.fromXYZ(ray.location), ThreeHelper.fromXYZ(ray.direction));
        raycaster.firstHitOnly = firstHitOnly;
        return raycaster;
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
        PubSub.default.pub(
            "selectionChanged",
            this.view.viewer.document,
            this._selectedNodes,
            this._unselectedNodes
        );
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
