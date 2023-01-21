// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    IDocument,
    PubSub,
    IVisualizationContext,
    IVisualizationShape,
    ModelObject,
    IShape,
    RenderData,
    Model,
} from "chili-core";
import { LineType, ShapeType, XYZ } from "chili-shared";
import {
    BufferGeometry,
    EdgesGeometry,
    Float32BufferAttribute,
    Group,
    Line,
    LineBasicMaterial,
    LineDashedMaterial,
    Material,
    Mesh,
    MeshBasicMaterial,
    Object3D,
    Points,
    PointsMaterial,
    Scene,
} from "three";
import { ThreeShape } from "./threeShape";

export interface ModelInfo {
    model: ModelObject;
    parent: ModelObject | IDocument | undefined;
}

export class ThreeVisulizationContext implements IVisualizationContext {
    readonly modelShapes: Group;
    readonly tempShapes: Group;
    readonly hilightedShapes: Group;

    constructor(scene: Scene) {
        this.modelShapes = new Group();
        this.tempShapes = new Group();
        this.hilightedShapes = new Group();
        scene.add(this.modelShapes, this.tempShapes, this.hilightedShapes);
        PubSub.default.sub("modelAdded", this.handleAddModel);
        PubSub.default.sub("modelRemoved", this.handleRemoveModel);
        PubSub.default.sub("modelUpdate", this.handleModelUpdate);
        PubSub.default.sub("visibleChanged", this.handleVisibleChanged);
    }

    handleModelUpdate = (model: ModelObject) => {
        this.removeModel(model);
        this.addModel(model);
    };

    hilighted(shape: IShape) {
        let threeShape = new ThreeShape(shape);
        threeShape.name = shape.id;
        threeShape.hilightedState();
        this.hilightedShapes.add(threeShape);
    }

    unHilighted(shape: IShape): void {
        let threeShape = this.hilightedShapes.getObjectByName(shape.id);
        if (threeShape === undefined) return;
        this.hilightedShapes.remove(threeShape);
    }

    get shapeCount() {
        return this.modelShapes.children.length;
    }

    getShape(model: ModelObject): IVisualizationShape | undefined {
        return this.modelShapes.getObjectByName(model.id) as ThreeShape;
    }

    getThreeShapes(): ThreeShape[] {
        let shapes = new Array<ThreeShape>();
        this.modelShapes.children.forEach((x) => this._getThreeShapes(shapes, x));
        return shapes;
    }

    private _getThreeShapes(shapes: Array<ThreeShape>, shape: Object3D) {
        let group = shape as Group;
        if (group.type === "Group") {
            group.children.forEach((x) => this._getThreeShapes(shapes, x));
        } else {
            let threeShape = shape as ThreeShape;
            if (threeShape.shape !== undefined) shapes.push(threeShape);
        }
    }

    temporaryDisplay(...datas: RenderData[]): number {
        let group = new Group();

        datas.forEach((data) => {
            let geometry: Object3D | undefined = undefined;
            let buff = new BufferGeometry();
            buff.setAttribute("position", new Float32BufferAttribute(data.vertexs, 3));
            if (RenderData.isVertex(data)) {
                let material = new PointsMaterial({ size: data.size, sizeAttenuation: false, color: data.color });
                geometry = new Points(buff, material);
            } else if (RenderData.isEdge(data)) {
                let material: LineBasicMaterial =
                    data.lineType === LineType.Dash
                        ? new LineDashedMaterial({ color: data.color, dashSize: 6, gapSize: 6 })
                        : new LineBasicMaterial({ color: data.color });
                geometry = new Line(buff, material).computeLineDistances();
            }
            if (geometry !== undefined) group.add(geometry);
        });

        this.tempShapes.add(group!);
        return group!.id;
    }

    temporaryRemove(id: number) {
        let shape = this.tempShapes.getObjectById(id);
        if (shape === undefined) return;
        this.tempShapes.remove(shape);
    }

    handleAddModel = (document: IDocument, model: ModelObject) => {
        this.addModel(model);
    };

    handleRemoveModel = (document: IDocument, ...models: ModelObject[]) => {
        this.removeModel(...models);
    };

    private handleVisibleChanged = (model: ModelObject) => {
        let shape = this.getShape(model);
        if (shape === undefined || shape.visible === model.visible) return;
        shape.visible = model.visible;
    };

    private addModelToGroup(group: Group, modelObject: ModelObject) {
        if (ModelObject.isGroup(modelObject)) {
            let childGroup = new Group();
            childGroup.name = modelObject.id;
            group.add(childGroup);
        } else {
            let model = modelObject as Model;
            let shape = this.getShape(model);
            if (shape !== undefined) return shape;
            let modelShape = model.getShape();
            if (modelShape.isErr()) return;
            let threeShape = new ThreeShape(modelShape.value!);
            threeShape.name = model.id;
            group.add(threeShape);
        }
    }

    addModel(...models: ModelObject[]) {
        models.forEach((model) => this.addModelToGroup(this.modelShapes, model));
    }

    removeModel(...models: ModelObject[]) {
        models.forEach((model) => {
            let obj = this.modelShapes.getObjectByName(model.id);
            if (obj === undefined) return;
            // https://threejs.org/docs/index.html#manual/en/introduction/How-to-dispose-of-objects
            this.modelShapes.remove(obj);
            obj.traverse((child) => {
                if (child instanceof BufferGeometry) {
                    child.dispose();
                } else if (child instanceof Material) {
                    child.dispose();
                }
            });
        });
    }

    findShapes(shapeType: ShapeType): Object3D[] {
        let res = new Array<Object3D>();
        if (shapeType === ShapeType.Shape) res.push(...this.modelShapes.children);
        if (shapeType === ShapeType.Edge) {
            this.modelShapes.traverse((x) => {
                if (x instanceof ThreeShape) {
                    let wireframe = x.wireframe();
                    if (wireframe !== undefined) res.push(...wireframe);
                }
            });
        }
        if (shapeType === ShapeType.Face) {
            this.modelShapes.traverse((x) => {
                if (x instanceof ThreeShape) {
                    let faces = x.faces();
                    if (faces !== undefined) res.push(...faces);
                }
            });
        }

        return res;
    }
}
