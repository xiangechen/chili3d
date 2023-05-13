// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    IDocument,
    IShape,
    IVisualContext,
    IVisualShape,
    LineType,
    GeometryModel,
    PubSub,
    RenderData,
    ShapeType,
    Matrix4,
    INode,
    IModel,
    Color,
} from "chili-core";
import {
    BufferGeometry,
    EdgesGeometry,
    Float32BufferAttribute,
    Group,
    Line,
    LineBasicMaterial,
    LineDashedMaterial,
    Material,
    Matrix4 as ThreeMatrix4,
    Mesh,
    MeshBasicMaterial,
    Object3D,
    Points,
    PointsMaterial,
    Scene,
    DirectionalLight,
    AxesHelper,
} from "three";

import { ThreeShape } from "./threeShape";

export interface ModelInfo {
    model: IModel;
    parent: IModel | IDocument | undefined;
}

export class ThreeVisualContext implements IVisualContext {
    private readonly _shapeModelMap = new WeakMap<IVisualShape, IModel>();
    private readonly _modelShapeMap = new WeakMap<IModel, IVisualShape>();

    readonly modelShapes: Group;
    readonly tempShapes: Group;
    readonly hilightedShapes: Group;
    hilightedColor: Color = new Color(0.5, 0.8, 0.3, 1);
    selectedColor: Color = new Color(0.5, 0.8, 0.3, 1);

    constructor(readonly scene: Scene) {
        this.modelShapes = new Group();
        this.tempShapes = new Group();
        this.hilightedShapes = new Group();
        this.initScene();
        scene.add(this.modelShapes, this.tempShapes, this.hilightedShapes);
        PubSub.default.sub("nodeAdded", this.handleAddModel);
        PubSub.default.sub("nodeRemoved", this.handleRemoveModel);
        PubSub.default.sub("modelUpdate", this.handleModelUpdate);
        PubSub.default.sub("visibleChanged", this.handleVisibleChanged);
        PubSub.default.sub("parentVisibleChanged", this.handleVisibleChanged);
    }

    initScene() {
        const light = new DirectionalLight(0xffffff, 0.5);
        this.scene.add(light);
        let axisHelper = new AxesHelper(250);
        this.scene.add(axisHelper);
    }

    getModel(shape: IVisualShape): IModel | undefined {
        return this._shapeModelMap.get(shape);
    }

    handleModelUpdate = (model: IModel) => {
        this.removeModel([model]);
        this.addModel([model]);
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

    getShape(model: IModel): IVisualShape | undefined {
        return this._modelShapeMap.get(model) as ThreeShape;
    }

    shapes(): IVisualShape[] {
        let shapes = new Array<ThreeShape>();
        this.modelShapes.children.forEach((x) => this._getThreeShapes(shapes, x));
        return shapes;
    }

    private _getThreeShapes(shapes: Array<ThreeShape>, shape: Object3D) {
        let group = shape as Group;
        if (group.type === "Group") {
            group.children.forEach((x) => this._getThreeShapes(shapes, x));
        } else {
            if (shape instanceof ThreeShape) shapes.push(shape);
        }
    }

    temporaryDisplay(...datas: RenderData[]): number {
        let group = new Group();

        datas.forEach((data) => {
            let geometry: Object3D | undefined = undefined;
            let buff = new BufferGeometry();
            buff.setAttribute("position", new Float32BufferAttribute(data.vertexs, 3));
            if (RenderData.isVertex(data)) {
                let material = new PointsMaterial({
                    size: data.size,
                    sizeAttenuation: false,
                    color: data.color,
                });
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

    handleAddModel = (document: IDocument, nodes: INode[]) => {
        this.addModel(nodes.map((x) => x as IModel).filter((x) => x.translation !== undefined));
    };

    handleRemoveModel = (document: IDocument, nodes: INode[]) => {
        this.removeModel(nodes.map((x) => x as IModel).filter((x) => x.translation !== undefined));
    };

    private handleVisibleChanged = (model: IModel) => {
        let shape = this.getShape(model);
        let visible = model.visible && model.parentVisible;
        if (shape === undefined || shape.visible === visible) return;
        shape.visible = visible;
    };

    addModel(models: IModel[]) {
        models.forEach((model) => {
            if (INode.isModelGroup(model)) {
                let childGroup = new Group();
                childGroup.name = model.id;
                this.modelShapes.add(childGroup);
            } else {
                let geometryModel = model;
                let shape = this.getShape(geometryModel);
                if (shape !== undefined) return shape;
                let modelShape = geometryModel.shape();
                if (modelShape === undefined) return;
                let threeShape = new ThreeShape(modelShape);
                threeShape.applyMatrix4(this.convertMatrix(model.transform()));
                model.onPropertyChanged(this.handleTransformChanged);
                this.modelShapes.add(threeShape);
                this._shapeModelMap.set(threeShape, model);
                this._modelShapeMap.set(model, threeShape);
            }
        });
    }

    private convertMatrix(transform: Matrix4) {
        return new ThreeMatrix4().fromArray(transform.toArray());
    }

    private handleTransformChanged = (model: IModel, property: keyof IModel) => {
        let shape = this.modelShapes.getObjectByName(model.id);
        if (shape === undefined) return;
        if (property === "translation") {
            shape?.position.set(model.translation.x, model.translation.y, model.translation.z);
            shape?.updateMatrix();
        } else if (property === "rotation") {
            shape?.rotation.set(model.rotation.x, model.rotation.y, model.rotation.z);
            shape?.updateMatrix();
        } else if (property === "scale") {
            shape?.scale.set(model.scale.x, model.scale.y, model.scale.z);
            shape?.updateMatrix();
        }
    };

    removeModel(models: IModel[]) {
        let shapes = models
            .map((model) => {
                return this._modelShapeMap.get(model) as ThreeShape;
            })
            .filter((x) => x !== undefined);
        // https://threejs.org/docs/index.html#manual/en/introduction/How-to-dispose-of-objects
        this.modelShapes.remove(...shapes);
        shapes.forEach((obj) => {
            this._modelShapeMap.delete(this._shapeModelMap.get(obj) as IModel);
            this._shapeModelMap.delete(obj);
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
        else {
            this.modelShapes.traverse((x) => {
                if (x instanceof ThreeShape) {
                    if (shapeType === ShapeType.Edge) {
                        let wireframe = x.wireframe();
                        if (wireframe !== undefined) res.push(...wireframe);
                    } else if (shapeType === ShapeType.Face) {
                        let faces = x.faces();
                        if (faces !== undefined) res.push(...faces);
                    }
                }
            });
        }

        return res;
    }
}
