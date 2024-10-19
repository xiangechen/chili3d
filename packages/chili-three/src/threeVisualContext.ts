// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    CollectionAction,
    CollectionChangedArgs,
    GeometryModel,
    IDisposable,
    INode,
    IShapeFilter,
    IVisual,
    IVisualContext,
    IVisualGeometry,
    IVisualObject,
    Material,
    MathUtils,
    NodeAction,
    NodeRecord,
    ShapeMeshData,
    ShapeNode,
    ShapeType,
    XYZ
} from "chili-core";
import {
    Box3,
    DoubleSide,
    Group,
    LineSegments,
    Mesh,
    Object3D,
    Points,
    RepeatWrapping,
    Scene,
    TextureLoader,
    MeshLambertMaterial as ThreeMaterial,
} from "three";
import { ThreeGeometry } from "./threeGeometry";
import { ThreeGeometryFactory } from "./threeGeometryFactory";
import { ThreeHelper } from "./threeHelper";

export class ThreeVisualContext implements IVisualContext {
    private readonly _shapeModelMap = new WeakMap<IVisualGeometry, INode>();
    private readonly _modelShapeMap = new WeakMap<INode, IVisualGeometry>();
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
        visual.document.addNodeObserver(this);
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
                    opacity: item.opacity,
                });
                material.map = this.loadTexture(item);
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

    private loadTexture(item: Material) {
        if (!item.texture) {
            return null;
        }

        let map = new TextureLoader().load(item.texture);
        map.wrapS = RepeatWrapping;
        map.wrapT = RepeatWrapping;
        map.center.set(0.5, 0.5);
        map.repeat.set(item.repeatU, item.repeatV);
        map.rotation = MathUtils.degToRad(item.angle);
        return map;
    }

    getMaterial(id: string): ThreeMaterial {
        let material = this.materialMap.get(id);
        if (!material) {
            throw new Error(`Material not found: ${id}`);
        }
        return material;
    }

    private onMaterialPropertyChanged = (prop: keyof Material, source: Material) => {
        let material = this.materialMap.get(source.id);
        if (!material) return;
        if (prop === "color") {
            material.color.set(source.color);
        } else if (prop === "texture") {
            material.map = this.loadTexture(source);
        } else if (prop === "opacity") {
            material.opacity = source.opacity;
        } else if (prop === "name") {
            material.name = source.name;
        } else if (prop === "angle" && material.map) {
            material.map.rotation = MathUtils.degToRad(source.angle);
        } else if (prop === "repeatU" && material.map) {
            material.map.repeat.setX(source.repeatU);
        } else if (prop === "repeatV" && material.map) {
            material.map.repeat.setY(source.repeatV);
        } else {
            throw new Error("Unknown material property: " + prop);
        }
    };

    handleNodeChanged = (records: NodeRecord[]) => {
        let adds: INode[] = [],
            rms: INode[] = [];
        records.forEach((x) => {
            if (x.action === NodeAction.add) {
                INode.nodeOrChildrenAppendToNodes(adds, x.node);
            } else if (x.action === NodeAction.remove) {
                INode.nodeOrChildrenAppendToNodes(rms, x.node);
            }
        });
        this.addModel(adds.filter((x) => !INode.isLinkedListNode(x)));
        this.removeModel(rms.filter((x) => !INode.isLinkedListNode(x)));
    };

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
            if (IDisposable.isDisposable(x)) x.dispose();
        });
        this.visual.document.materials.forEach((x) =>
            x.removePropertyChanged(this.onMaterialPropertyChanged),
        );
        this.visual.document.materials.removeCollectionChanged(this.onMaterialsChanged);
        this.visual.document.removeNodeObserver(this);
        this.materialMap.forEach((x) => x.dispose());
        this.materialMap.clear();
        this.visualShapes.clear();
        this.tempShapes.clear();
        this.scene.remove(this.visualShapes, this.tempShapes);
    }

    getModel(shape: IVisualGeometry): INode | undefined {
        return this._shapeModelMap.get(shape);
    }

    redrawModel(models: INode[]) {
        this.removeModel(models);
        this.addModel(models);

        // TODO: set state
    }

    get shapeCount() {
        return this.visualShapes.children.length;
    }

    getShape(model: INode): IVisualGeometry | undefined {
        return this._modelShapeMap.get(model);
    }

    shapes(): IVisualGeometry[] {
        let shapes = new Array<ThreeGeometry>();
        this.visualShapes.children.forEach((x) => this._getThreeShapes(shapes, x));
        return shapes;
    }

    boundingBoxIntersectFilter(
        boundingBox: {
            min: XYZ;
            max: XYZ;
        },
        filter?: IShapeFilter,
    ): IVisualGeometry[] {
        let box = new Box3().setFromPoints([
            ThreeHelper.fromXYZ(boundingBox.min),
            ThreeHelper.fromXYZ(boundingBox.max),
        ]);
        return this.shapes().filter((x) => {
            if (filter && x instanceof GeometryModel && x.geometryEngity.shape.isOk && !filter.allow(x.geometryEngity.shape.ok())) {
                return false;
            }

            if (filter && x instanceof ShapeNode && x.shape.isOk && !filter.allow(x.shape.ok())) {
                return false;
            }

            let testBox = (x as ThreeGeometry).box();
            if (testBox === undefined) {
                return false;
            }
            return box.intersectsBox(testBox);
        });
    }

    private _getThreeShapes(shapes: Array<ThreeGeometry>, shape: Object3D) {
        let group = shape as Group;
        if (group.type === "Group") {
            group.children.forEach((x) => this._getThreeShapes(shapes, x));
        } else if (shape instanceof ThreeGeometry) shapes.push(shape);
    }

    displayMesh(...datas: ShapeMeshData[]): number {
        let group = new Group();
        datas.forEach((data) => {
            if (ShapeMeshData.isVertex(data)) {
                group.add(ThreeGeometryFactory.createVertexGeometry(data));
            } else if (ShapeMeshData.isEdge(data)) {
                group.add(ThreeGeometryFactory.createEdgeGeometry(data));
            } else if (ShapeMeshData.isFace(data)) {
                group.add(ThreeGeometryFactory.createFaceGeometry(data));
            }
        });
        this.tempShapes.add(group);
        return group.id;
    }

    removeMesh(id: number) {
        let shape = this.tempShapes.getObjectById(id);
        if (shape === undefined) return;
        shape.children.forEach((x) => {
            if (x instanceof Mesh || x instanceof LineSegments || x instanceof Points) {
                x.geometry.dispose();
                x.material.dispose();
            }
            if (IDisposable.isDisposable(x)) {
                x.dispose();
            }
        });
        shape.children.length = 0;
        this.tempShapes.remove(shape);
    }

    setVisible(model: INode, visible: boolean): void {
        let shape = this.getShape(model);
        if (shape === undefined || shape.visible === visible) return;
        shape.visible = visible;
    }

    addModel(models: INode[]) {
        models.forEach((model) => {
            if (this._modelShapeMap.has(model)) return;
            if (INode.isModelGroup(model)) {
                let childGroup = new Group();
                childGroup.name = model.id;
                this.visualShapes.add(childGroup);
                return;
            }
            this.displayModel(model);
        });
    }

    private displayModel(model: INode) {
        if (INode.isModelNode(model)) {
            let modelShape = model.geometry.shape.ok();
            if (modelShape === undefined) return;
            let threeShape = new ThreeGeometry(model.geometry, this);
            this.visualShapes.add(threeShape);
            this._shapeModelMap.set(threeShape, model);
            this._modelShapeMap.set(model, threeShape);
        } else if (model instanceof ShapeNode) {
            let threeShape = new ThreeGeometry(model as any, this);
            this.visualShapes.add(threeShape);
            this._shapeModelMap.set(threeShape, model);
            this._modelShapeMap.set(model, threeShape);
        }

    }

    removeModel(models: INode[]) {
        models.forEach((m) => {
            let shape = this._modelShapeMap.get(m);
            this._modelShapeMap.delete(m);
            if (!shape) return;
            this._shapeModelMap.delete(shape);
            if (shape instanceof ThreeGeometry) {
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
            if (!(child instanceof ThreeGeometry)) return;
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
