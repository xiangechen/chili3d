// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    CollectionAction,
    CollectionChangedArgs,
    DeepObserver,
    GroupNode,
    IDisposable,
    INode,
    IShapeFilter,
    IVisual,
    IVisualContext,
    IVisualObject,
    Material,
    MeshNode,
    NodeAction,
    NodeRecord,
    ShapeMeshData,
    ShapeNode,
    ShapeType,
    Texture,
    XY,
    XYZ,
} from "chili-core";
import {
    Box3,
    Group,
    LineSegments,
    Mesh,
    Object3D,
    Points,
    Scene,
    Material as ThreeMaterial,
    Vector3,
} from "three";
import { ThreeGeometry } from "./threeGeometry";
import { ThreeGeometryFactory } from "./threeGeometryFactory";
import { ThreeHelper } from "./threeHelper";
import { GroupVisualObject, ThreeMeshObject } from "./threeVisualObject";

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
        visual.document.materials.onCollectionChanged(this.onMaterialCollectionChanged);
    }

    private readonly onMaterialCollectionChanged = (args: CollectionChangedArgs) => {
        if (args.action === CollectionAction.add) {
            args.items.forEach((item: Material) => {
                this.createThreeMaterial(item);
            });
        } else if (args.action === CollectionAction.remove) {
            args.items.forEach((item: Material) => {
                let material = this.materialMap.get(item.id);
                this.materialMap.delete(item.id);
                DeepObserver.removeDeepPropertyChangedHandler(item, this.onMaterialPropertyChanged);
                material?.dispose();
            });
        }
    };

    private createThreeMaterial(material: Material) {
        let result = ThreeHelper.parseToThreeMaterial(material);
        DeepObserver.addDeepPropertyChangedHandler(material, this.onMaterialPropertyChanged);
        this.materialMap.set(material.id, result);
    }

    getMaterial(id: string): ThreeMaterial {
        let material = this.materialMap.get(id);
        if (!material) {
            throw new Error(`Material not found: ${id}`);
        }
        return material;
    }

    private readonly onMaterialPropertyChanged = (path: string, source: any) => {
        let material = this.materialMap.get(source?.id) as any;
        if (!material) return;

        let { isOk, value } = DeepObserver.getPathValue(source, path);
        if (!isOk) return;

        if (path === "color") {
            material.color.set(value);
            return;
        }

        if (!path.includes(".")) {
            material[path] = value instanceof Texture ? ThreeHelper.loadTexture(value) : value;
            return;
        }

        this.setTextureValue(source, material, path, value);
    };

    private setTextureValue(material: any, threeMaterial: any, path: string, value: any) {
        let paths = path.split(".");
        if (path.endsWith(".image") && material[paths[0]] instanceof Texture && paths[0] in threeMaterial) {
            threeMaterial[paths[0]] = ThreeHelper.loadTexture(material[paths[0]]);
            return;
        }

        let obj = threeMaterial;
        for (let i = 0; i < paths.length - 1; i++) {
            obj = obj[paths[i]];
        }
        if (obj === undefined) return;

        if (value instanceof XY) {
            obj[paths.at(-1)!].set(value.x, value.y);
        } else {
            obj[paths.at(-1)!] = value;
        }
    }

    handleNodeChanged = (records: NodeRecord[]) => {
        let adds: INode[] = [],
            rms: INode[] = [];
        records.forEach((x) => {
            if (x.action === NodeAction.add) {
                INode.nodeOrChildrenAppendToNodes(adds, x.node);
            } else if (x.action === NodeAction.remove) {
                INode.nodeOrChildrenAppendToNodes(rms, x.node);
            } else if (x.action === NodeAction.move) {
                if (x.newParent) this.moveNode(x.node, x.oldParent!);
            }
        });

        this.addNode(adds);
        this.removeNode(rms);
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
        this.visual.document.materials.removeCollectionChanged(this.onMaterialCollectionChanged);
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

    moveNode(node: INode, oldParent: INode): void {
        if (oldParent === node.parent) return;

        let parentNode = this._NodeVisualMap.get(oldParent) ?? this.visualShapes;
        let newParentNode = (this._NodeVisualMap.get(node.parent!) as any) ?? this.visualShapes;
        if (parentNode === newParentNode) {
            return;
        }

        if (parentNode instanceof Group) {
            let visual = this._NodeVisualMap.get(node);
            if (visual instanceof Object3D) {
                parentNode.remove(visual);
                newParentNode.add(visual);
            }
        }
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
        } else if (node instanceof GroupNode) {
            visualObject = new GroupVisualObject(node);
        }

        if (visualObject) {
            let parent = this.getParentVisual(node);
            parent.add(visualObject);
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
                this.getParentVisual(m).remove(visual);
                visual.dispose();
            }
        });
    }

    private getParentVisual(node: INode): Group {
        let parent = this.visualShapes;
        if (node.parent) {
            let parentNode = this._NodeVisualMap.get(node.parent);
            if (parentNode instanceof Group) {
                parent = parentNode;
            }
        } 
        return parent;
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
