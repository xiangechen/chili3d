// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    CollectionAction,
    CollectionChangedArgs,
    EdgeMeshData,
    IDisposable,
    IModel,
    INode,
    IVisual,
    IVisualContext,
    IVisualObject,
    IVisualShape,
    LineType,
    Material,
    ShapeMeshData,
    ShapeType,
    VertexMeshData,
} from "chili-core";
import {
    BufferGeometry,
    DoubleSide,
    Float32BufferAttribute,
    Group,
    LineBasicMaterial,
    LineDashedMaterial,
    LineSegments,
    Object3D,
    Points,
    PointsMaterial,
    Scene,
    TextureLoader,
    MeshLambertMaterial as ThreeMaterial,
} from "three";
import { ThreeShape } from "./threeShape";
import { ThreeVisualObject } from "./threeVisualObject";

export class ThreeVisualContext implements IVisualContext {
    private readonly _shapeModelMap = new WeakMap<IVisualShape, IModel>();
    private readonly _modelShapeMap = new WeakMap<IModel, IVisualShape>();
    private readonly materialMap = new Map<string, ThreeMaterial>();

    readonly visualShapes: Group;
    readonly tempShapes: Group;

    constructor(
        readonly visual: IVisual,
        readonly scene: Scene,
    ) {
        this.visualShapes = new Group();
        this.tempShapes = new Group();
        scene.add(this.visualShapes, this.tempShapes);
        visual.document.materials.onCollectionChanged(this.onMaterialsChanged);
    }

    private onMaterialsChanged = (args: CollectionChangedArgs) => {
        if (args.action === CollectionAction.add) {
            args.items.forEach((item: Material) => {
                let material = new ThreeMaterial({
                    color: item.color,
                    side: DoubleSide,
                    transparent: true,
                    name: item.name,
                });
                if (item.texture) {
                    material.map = new TextureLoader().load(item.texture);
                }
                item.onPropertyChanged(this.onMaterialPropertyChanged);
                this.materialMap.set(item.id, material);
            });
        } else if (args.action === CollectionAction.remove) {
            args.items.forEach((item: Material) => {
                let material = this.materialMap.get(item.id);
                this.materialMap.delete(item.id);
                item.removePropertyChanged(this.onMaterialPropertyChanged);
                material?.dispose();
            });
        }
    };

    private onMaterialPropertyChanged = (prop: keyof Material, source: Material) => {
        let material = this.materialMap.get(source.id);
        if (!material) return;
        if (prop === "color") {
            material.color.set(source.color);
        } else if (prop === "texture") {
            material.map = source.texture ? new TextureLoader().load(source.texture) : null;
        } else if (prop === "opacity") {
            material.opacity = source.opacity;
        } else if (prop === "name") {
            material.name = source.name;
        } else if (prop === "width" && material.map) {
            material.map.image.width = source.width;
        } else if (prop === "height" && material.map) {
            material.map.image.height = source.height;
        } else {
            throw new Error("Unknown material property: " + prop);
        }
    };

    addMesh(data: ShapeMeshData): IVisualObject {
        let shape: ThreeVisualObject | undefined = undefined;
        if (ShapeMeshData.isVertex(data)) {
            shape = new ThreeVisualObject(this.createVertexGeometry(data));
        } else if (ShapeMeshData.isEdge(data)) {
            shape = new ThreeVisualObject(this.createEdgeGeometry(data));
        }
        if (shape) {
            this.visualShapes.add(shape);
            return shape;
        }
        throw new Error("Unsupported mesh data");
    }

    addVisualObject(object: IVisualObject): void {
        if (object instanceof Object3D) {
            this.visualShapes.add(object);
        }
    }

    removeVisualObject(object: IVisualObject): void {
        if (object instanceof Object3D) {
            this.visualShapes.remove(object);
        }
    }

    dispose() {
        this.visualShapes.traverse((x) => {
            if (x instanceof ThreeShape) {
                this._shapeModelMap.get(x)?.removePropertyChanged(this.handleModelPropertyChanged);
            }
            if (IDisposable.isDisposable(x)) x.dispose();
        });
        this.visual.document.materials.forEach((x) =>
            x.removePropertyChanged(this.onMaterialPropertyChanged),
        );
        this.visual.document.materials.removeCollectionChanged(this.onMaterialsChanged);
        this.materialMap.forEach((x) => x.dispose());
        this.materialMap.clear();
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

        // TODO: set state
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
        let color = data.color as number;
        let material: LineBasicMaterial =
            data.lineType === LineType.Dash
                ? new LineDashedMaterial({ color, dashSize: 6, gapSize: 6 })
                : new LineBasicMaterial({ color });
        return new LineSegments(buff, material).computeLineDistances();
    }

    private createVertexGeometry(data: VertexMeshData) {
        let buff = new BufferGeometry();
        buff.setAttribute("position", new Float32BufferAttribute(data.positions, 3));
        let color = data.color as number;
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
        let material = this.materialMap.get(model.materialId);
        if (!material) {
            throw new Error("Material not found");
        }
        let threeShape = new ThreeShape(modelShape, this.visual.highlighter, material);
        threeShape.transform = model.matrix;
        this.visualShapes.add(threeShape);
        this._shapeModelMap.set(threeShape, model);
        this._modelShapeMap.set(model, threeShape);
    }

    private handleModelPropertyChanged = (property: keyof IModel, model: IModel) => {
        let shape = this._modelShapeMap.get(model) as ThreeShape;
        if (shape === undefined) return;
        if (property === "matrix") {
            shape.transform = model.matrix;
        } else if (property === "materialId") {
            let material = this.materialMap.get(model.materialId)!;
            shape.setFaceMaterial(material);
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
                this.visualShapes.remove(shape);
                shape.dispose();
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
