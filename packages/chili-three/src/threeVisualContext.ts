// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    Color,
    EdgeMeshData,
    IDisposable,
    IModel,
    INode,
    IVisual,
    IVisualContext,
    IVisualShape,
    LineType,
    Matrix4,
    ShapeMeshData,
    ShapeType,
    VertexMeshData,
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
    private readonly _shapeModelMap = new WeakMap<IVisualShape, IModel>();
    private readonly _modelShapeMap = new WeakMap<IModel, IVisualShape>();

    readonly visualShapes: Group;
    readonly tempShapes: Group;

    constructor(
        readonly visual: IVisual,
        readonly scene: Scene,
    ) {
        this.visualShapes = new Group();
        this.tempShapes = new Group();
        scene.add(this.visualShapes, this.tempShapes);
    }

    dispose() {
        this.visualShapes.traverse((x) => {
            if (x instanceof ThreeShape) {
                this._shapeModelMap.get(x)?.removePropertyChanged(this.handleModelPropertyChanged);
            }
            if (IDisposable.isDisposable(x)) x.dispose();
        });
        this.visualShapes.clear();
        this.tempShapes.clear();
        this.scene.remove(this.visualShapes, this.tempShapes);
    }

    getModel(shape: IVisualShape): IModel | undefined {
        return this._shapeModelMap.get(shape);
    }

    redrawModel(models: IModel[]) {
        this.removeModel(models);
        this.addModel(models);
    }

    get shapeCount() {
        return this.visualShapes.children.length;
    }

    getShape(model: IModel): IVisualShape | undefined {
        return this._modelShapeMap.get(model);
    }

    shapes(): IVisualShape[] {
        let shapes = new Array<ThreeShape>();
        this.visualShapes.children.forEach((x) => this._getThreeShapes(shapes, x));
        return shapes;
    }

    private _getThreeShapes(shapes: Array<ThreeShape>, shape: Object3D) {
        let group = shape as Group;
        if (group.type === "Group") {
            group.children.forEach((x) => this._getThreeShapes(shapes, x));
        } else if (shape instanceof ThreeShape) shapes.push(shape);
    }

    displayShapeMesh(...datas: ShapeMeshData[]): number {
        let group = new Group();
        datas.forEach((data) => {
            if (ShapeMeshData.isVertex(data)) {
                group.add(this.createVertexGeometry(data));
            } else if (ShapeMeshData.isEdge(data)) {
                group.add(this.createEdgeGeometry(data));
            }
        });
        this.tempShapes.add(group);
        return group.id;
    }

    private createEdgeGeometry(data: EdgeMeshData) {
        let buff = new BufferGeometry();
        buff.setAttribute("position", new Float32BufferAttribute(data.positions, 3));
        let color = ThreeHelper.fromColor(data.color as Color);
        let material: LineBasicMaterial =
            data.lineType === LineType.Dash
                ? new LineDashedMaterial({ color, dashSize: 6, gapSize: 6 })
                : new LineBasicMaterial({ color });
        return new LineSegments(buff, material).computeLineDistances();
    }

    private createVertexGeometry(data: VertexMeshData) {
        let buff = new BufferGeometry();
        buff.setAttribute("position", new Float32BufferAttribute(data.positions, 3));
        let color = ThreeHelper.fromColor(data.color as Color);
        let material = new PointsMaterial({
            size: data.size,
            sizeAttenuation: false,
            color,
        });
        return new Points(buff, material);
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
                this.visualShapes.add(childGroup);
                return;
            }
            model.onPropertyChanged(this.handleModelPropertyChanged);
            this.displayModel(model);
        });
    }

    private displayModel(model: IModel) {
        let modelShape = model.shape();
        if (modelShape === undefined) return;
        let threeShape = new ThreeShape(modelShape, this.visual.highlighter);
        threeShape.color = model.color;
        threeShape.opacity = model.opacity;
        threeShape.matrix.copy(this.convertMatrix(model.matrix));
        this.visualShapes.add(threeShape);
        this._shapeModelMap.set(threeShape, model);
        this._modelShapeMap.set(model, threeShape);
    }

    private convertMatrix(transform: Matrix4) {
        return new ThreeMatrix4().fromArray(transform.toArray());
    }

    private handleModelPropertyChanged = (property: keyof IModel, model: IModel) => {
        let shape = this._modelShapeMap.get(model) as ThreeShape;
        if (shape === undefined) return;
        if (property === "matrix") {
            shape.matrix.copy(this.convertMatrix(model.matrix));
            shape.matrixWorldNeedsUpdate = true;
        } else if (property === "color") {
            shape.color = model[property];
        } else if (property === "opacity") {
            shape.opacity = model[property];
        }
    };

    removeModel(models: IModel[]) {
        models.forEach((m) => {
            m.removePropertyChanged(this.handleModelPropertyChanged);
            let shape = this._modelShapeMap.get(m);
            this._modelShapeMap.delete(m);
            if (!shape) return;
            this._shapeModelMap.delete(shape);
            if (shape instanceof ThreeShape) {
                // https://threejs.org/docs/index.html#manual/en/introduction/How-to-dispose-of-objects
                this.visualShapes.remove(shape);
                shape.traverse((child) => {
                    if (child instanceof BufferGeometry) {
                        child.dispose();
                    }
                });
            }
        });
    }

    findShapes(shapeType: ShapeType): Object3D[] {
        if (shapeType === ShapeType.Shape) {
            return [...this.visualShapes.children];
        }
        const shapes: Object3D[] = [];
        this.visualShapes.traverse((child) => {
            if (!(child instanceof ThreeShape)) return;
            if (shapeType === ShapeType.Edge) {
                let wireframe = child.edges();
                if (wireframe) shapes.push(wireframe);
            } else if (shapeType === ShapeType.Face) {
                let faces = child.faces();
                if (faces) shapes.push(faces);
            }
        });
        return shapes;
    }
}
