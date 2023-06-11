// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import {
    Color,
    IModel,
    INode,
    IVisualContext,
    IVisualShape,
    LineType,
    Matrix4,
    ShapeMeshData,
    ShapeType,
} from "chili-core";
import {
    BufferGeometry,
    Float32BufferAttribute,
    Group,
    LineBasicMaterial,
    LineDashedMaterial,
    LineSegments,
    Object3D,
    Points,
    PointsMaterial,
    Scene,
    Matrix4 as ThreeMatrix4,
} from "three";
import { ThreeHelper } from "./threeHelper";
import { ThreeShape } from "./threeShape";

export class ThreeVisualContext implements IVisualContext {
    private readonly _shapeModelMap = new WeakMap<ThreeShape, IModel>();
    private readonly _modelShapeMap = new WeakMap<IModel, ThreeShape>();

    readonly modelShapes: Group;
    readonly tempShapes: Group;

    constructor(readonly scene: Scene) {
        this.modelShapes = new Group();
        this.tempShapes = new Group();
        scene.add(this.modelShapes, this.tempShapes);
    }

    getModel(shape: IVisualShape): IModel | undefined {
        return this._shapeModelMap.get(shape as ThreeShape);
    }

    redrawModel(models: IModel[]) {
        this.removeModel(models);
        this.addModel(models);
    }

    get shapeCount() {
        return this.modelShapes.children.length;
    }

    getShape(model: IModel): IVisualShape | undefined {
        return this._modelShapeMap.get(model);
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

    displayShapeMesh(...datas: ShapeMeshData[]): number {
        let group = new Group();

        datas.forEach((data) => {
            let geometry: Object3D | undefined = undefined;
            let buff = new BufferGeometry();
            buff.setAttribute("position", new Float32BufferAttribute(data.positions, 3));
            let color = ThreeHelper.fromColor(data.color as Color);
            if (ShapeMeshData.isVertex(data)) {
                let material = new PointsMaterial({
                    size: data.size,
                    sizeAttenuation: false,
                    color,
                });
                geometry = new Points(buff, material);
            } else if (ShapeMeshData.isEdge(data)) {
                let material: LineBasicMaterial =
                    data.lineType === LineType.Dash
                        ? new LineDashedMaterial({ color, dashSize: 6, gapSize: 6 })
                        : new LineBasicMaterial({ color });
                geometry = new LineSegments(buff, material).computeLineDistances();
            }
            if (geometry !== undefined) group.add(geometry);
        });

        this.tempShapes.add(group!);
        return group!.id;
    }

    removeShapeMesh(id: number) {
        let shape = this.tempShapes.getObjectById(id);
        if (shape === undefined) return;
        this.tempShapes.remove(shape);
    }

    setVisible(model: IModel, visible: boolean): void {
        let shape = this.getShape(model);
        if (shape === undefined || shape.visible === visible) return;
        shape.visible = visible;
    }

    addModel(models: IModel[]) {
        models.forEach((model) => {
            if (this._modelShapeMap.has(model)) return;
            if (INode.isModelGroup(model)) {
                let childGroup = new Group();
                childGroup.name = model.id;
                this.modelShapes.add(childGroup);
            } else {
                let shape = this.getShape(model);
                if (shape !== undefined) return shape;
                let modelShape = model.shape();
                if (modelShape === undefined) return;
                let threeShape = new ThreeShape(modelShape);
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
        let shape = this.getShape(model) as ThreeShape;
        if (shape === undefined) return;
        if (property === "matrix") {
            shape.matrix.copy(this.convertMatrix(model.matrix));
            shape.matrixWorldNeedsUpdate = true;
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
                }
            });
        });
    }

    findShapes(shapeType: ShapeType): Object3D[] {
        const shapes: Object3D[] = [];
        if (shapeType === ShapeType.Shape) {
            shapes.push(...this.modelShapes.children);
        } else {
            this.modelShapes.traverse((child) => {
                if (!(child instanceof ThreeShape)) return;
                if (shapeType === ShapeType.Edge) {
                    let wireframe = child.edges();
                    if (wireframe) shapes.push(wireframe);
                } else if (shapeType === ShapeType.Face) {
                    let faces = child.faces();
                    if (faces) shapes.push(faces);
                }
            });
        }

        return shapes;
    }
}
