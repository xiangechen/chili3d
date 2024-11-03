// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    CollectionAction,
    CollectionChangedArgs,
    IDisposable,
    INode,
    IShapeFilter,
    IVisual,
    IVisualContext,
    IVisualObject,
    Material,
    MathUtils,
    MeshNode,
    NodeAction,
    NodeRecord,
    ShapeMeshData,
    ShapeNode,
    ShapeType,
    XYZ,
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
    Vector3,
} from "three";
import { ThreeGeometry } from "./threeGeometry";
import { ThreeGeometryFactory } from "./threeGeometryFactory";
import { ThreeHelper } from "./threeHelper";
import { ThreeMeshObject } from "./threeVisualObject";

export class ThreeVisualContext implements IVisualContext {
    private readonly _visualNodeMap = new WeakMap<IVisualObject, INode>();
    private readonly _NodeVisualMap = new WeakMap<INode, IVisualObject>();
    readonly materialMap = new Map<string, ThreeMaterial>();

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

    private readonly onMaterialsChanged = (args: CollectionChangedArgs) => {
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

    private readonly onMaterialPropertyChanged = (prop: keyof Material, source: Material) => {
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
        this.addNode(adds.filter((x) => !INode.isLinkedListNode(x)));
        this.removeNode(rms.filter((x) => !INode.isLinkedListNode(x)));
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

    getNode(visual: IVisualObject): INode | undefined {
        return this._visualNodeMap.get(visual);
    }

    redrawNode(models: INode[]) {
        this.removeNode(models);
        this.addNode(models);

        // TODO: set state
    }

    get shapeCount() {
        return this.visualShapes.children.length;
    }

    getVisual(nodel: INode): IVisualObject | undefined {
        return this._NodeVisualMap.get(nodel);
    }

    visuals(): IVisualObject[] {
        let shapes = new Array<IVisualObject>();
        this.visualShapes.children.forEach((x) => this._getVisualObject(shapes, x));
        return shapes;
    }

    boundingBoxIntersectFilter(
        boundingBox: {
            min: XYZ;
            max: XYZ;
        },
        filter?: IShapeFilter,
    ): IVisualObject[] {
        let box = new Box3().setFromPoints([
            ThreeHelper.fromXYZ(boundingBox.min),
            ThreeHelper.fromXYZ(boundingBox.max),
        ]);
        return this.visuals().filter((x) => {
            if (filter && x instanceof ShapeNode && x.shape.isOk && !filter.allow(x.shape.value)) {
                return false;
            }

            let boundingBox = x.boundingBox();
            if (boundingBox === undefined) {
                return false;
            }

            let testBox = new Box3(
                new Vector3(boundingBox.min.x, boundingBox.min.y, boundingBox.min.z),
                new Vector3(boundingBox.max.x, boundingBox.max.y, boundingBox.max.z),
            );
            return box.intersectsBox(testBox);
        });
    }

    private _getVisualObject(visuals: Array<IVisualObject>, obj: Object3D) {
        let group = obj as Group;
        if (group.type === "Group") {
            group.children.forEach((x) => this._getVisualObject(visuals, x));
        } else if (obj instanceof ThreeGeometry || obj instanceof ThreeMeshObject) {
            visuals.push(obj);
        }
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

    setVisible(node: INode, visible: boolean): void {
        let shape = this.getVisual(node);
        if (shape === undefined || shape.visible === visible) return;
        shape.visible = visible;
    }

    addNode(nodes: INode[]) {
        nodes.forEach((node) => {
            if (this._NodeVisualMap.has(node)) return;
            this.displayNode(node);
        });
    }

    private displayNode(node: INode) {
        let visualObject: (IVisualObject & Object3D) | undefined = undefined;
        if (node instanceof MeshNode) {
            visualObject = new ThreeMeshObject(this, node);
        } else if (node instanceof ShapeNode) {
            visualObject = new ThreeGeometry(node as any, this);
        }

        if (visualObject) {
            this.visualShapes.add(visualObject);
            this._visualNodeMap.set(visualObject, node);
            this._NodeVisualMap.set(node, visualObject);
        }
    }

    removeNode(models: INode[]) {
        models.forEach((m) => {
            let visual = this._NodeVisualMap.get(m);
            this._NodeVisualMap.delete(m);
            if (!visual) return;
            this._visualNodeMap.delete(visual);
            if (visual instanceof ThreeGeometry || visual instanceof ThreeMeshObject) {
                this.visualShapes.remove(visual);
                visual.dispose();
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
