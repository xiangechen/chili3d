// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    BoundingBox,
    CollectionAction,
    type CollectionChangedArgs,
    ComponentNode,
    DeepObserver,
    type EdgeMeshData,
    GeometryNode,
    GroupNode,
    type INode,
    type IShapeFilter,
    type IVisual,
    type IVisualContext,
    type IVisualObject,
    isDisposable,
    type Material,
    type Matrix4,
    MeshDataUtils,
    type MeshLike,
    MeshNode,
    NodeAction,
    type NodeRecord,
    NodeUtils,
    type ShapeMeshData,
    type ShapeNode,
    ShapeType,
    Texture,
    XY,
    type XYZ,
} from "chili-core";
import {
    Box3,
    BufferAttribute,
    BufferGeometry,
    Group,
    InstancedMesh,
    LineBasicMaterial,
    LineSegments,
    Mesh,
    Object3D,
    Points,
    type Scene,
    type Material as ThreeMaterial,
    Vector3,
} from "three";
import { ThreeGeometry } from "./threeGeometry";
import { ThreeGeometryFactory } from "./threeGeometryFactory";
import { ThreeHelper } from "./threeHelper";
import { GroupVisualObject, ThreeComponentObject, ThreeMeshObject } from "./threeVisualObject";

export class ThreeVisualContext implements IVisualContext {
    private readonly _visualNodeMap = new Map<IVisualObject, INode>();
    private readonly _NodeVisualMap = new Map<INode, IVisualObject & Object3D>();
    readonly materialMap = new Map<string, ThreeMaterial>();

    readonly visualShapes: Group;
    readonly tempShapes: Group;
    readonly cssObjects: Group;

    constructor(
        readonly visual: IVisual,
        readonly scene: Scene,
    ) {
        this.visualShapes = new Group();
        this.tempShapes = new Group();
        this.cssObjects = new Group();
        scene.add(this.visualShapes, this.tempShapes, this.cssObjects);
        visual.document.modelManager.addNodeObserver(this.handleNodeChanged);
        visual.document.modelManager.materials.onCollectionChanged(this.onMaterialCollectionChanged);
    }

    private readonly onMaterialCollectionChanged = (args: CollectionChangedArgs) => {
        if (args.action === CollectionAction.add) {
            args.items.forEach(this.createThreeMaterial.bind(this));
        } else if (args.action === CollectionAction.remove) {
            args.items.forEach(this.removeThreeMaterial.bind(this));
        }
    };

    private createThreeMaterial(material: Material) {
        const result = ThreeHelper.parseToThreeMaterial(material);
        DeepObserver.addDeepPropertyChangedHandler(material, this.onMaterialPropertyChanged);
        this.materialMap.set(material.id, result);
    }

    private removeThreeMaterial(item: Material) {
        const material = this.materialMap.get(item.id);
        this.materialMap.delete(item.id);
        DeepObserver.removeDeepPropertyChangedHandler(item, this.onMaterialPropertyChanged);
        material?.dispose();
    }

    private readonly onMaterialPropertyChanged = (path: string, source: any) => {
        const material: any = this.materialMap.get(source?.id);
        if (!material) return;

        const { isOk, value } = DeepObserver.getPathValue(source, path);
        if (!isOk) return;

        if (path === "color") {
            material.color.set(value);
        } else if (!path.includes(".")) {
            material[path] = value instanceof Texture ? ThreeHelper.loadTexture(value) : value;
        } else {
            this.setTextureValue(source, material, path, value);
        }
    };

    private setTextureValue(material: any, threeMaterial: any, path: string, value: any) {
        const paths = path.split(".");
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

    readonly handleNodeChanged = (records: NodeRecord[]) => {
        const adds: INode[] = [];
        const rms: INode[] = [];
        records.forEach((x) => {
            if (
                x.action === NodeAction.add ||
                x.action === NodeAction.insertBefore ||
                x.action === NodeAction.insertAfter
            ) {
                NodeUtils.nodeOrChildrenAppendToNodes(adds, x.node);
            } else if (x.action === NodeAction.remove || x.action === NodeAction.transfer) {
                NodeUtils.nodeOrChildrenAppendToNodes(rms, x.node);
            } else if (x.action === NodeAction.move && x.newParent) {
                this.moveNode(x.node, x.oldParent!);
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
            if (isDisposable(x)) x.dispose();
        });
        this.visual.document.modelManager.materials.forEach((x) =>
            x.removePropertyChanged(this.onMaterialPropertyChanged),
        );
        this.visual.document.modelManager.materials.removeCollectionChanged(this.onMaterialCollectionChanged);
        this.visual.document.modelManager.removeNodeObserver(this.handleNodeChanged);
        this.materialMap.forEach((x) => x.dispose());
        this.materialMap.clear();
        this.visualShapes.clear();
        this.tempShapes.clear();
        this._visualNodeMap.clear();
        this._NodeVisualMap.clear();
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
        const shapes: IVisualObject[] = [];
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
        const box = new Box3().setFromPoints([
            ThreeHelper.fromXYZ(boundingBox.min),
            ThreeHelper.fromXYZ(boundingBox.max),
        ]);
        return this.visuals().filter((x) => {
            const node = (x as ThreeGeometry)?.geometryNode;
            const shape = (node as ShapeNode)?.shape?.unchecked();
            if (filter && shape && !filter.allow(shape)) {
                return false;
            }

            const boundingBox = BoundingBox.transformed(x.boundingBox()!, node.worldTransform());
            if (boundingBox === undefined) {
                return false;
            }

            const testBox = new Box3(
                new Vector3(boundingBox.min.x, boundingBox.min.y, boundingBox.min.z),
                new Vector3(boundingBox.max.x, boundingBox.max.y, boundingBox.max.z),
            );
            return box.intersectsBox(testBox);
        });
    }

    private _getVisualObject(visuals: Array<IVisualObject>, obj: Object3D) {
        const group = obj as Group;
        if (group.type === "Group") {
            group.children.forEach((x) => this._getVisualObject(visuals, x));
        } else if (
            obj instanceof ThreeGeometry ||
            obj instanceof ThreeMeshObject ||
            obj instanceof ThreeComponentObject
        ) {
            visuals.push(obj);
        }
    }

    displayMesh(datas: ShapeMeshData[], opacity?: number): number {
        const group = new Group();
        datas.forEach((data) => {
            if (MeshDataUtils.isVertexMesh(data)) {
                group.add(ThreeGeometryFactory.createVertexGeometry(data));
            } else if (MeshDataUtils.isEdgeMesh(data)) {
                group.add(ThreeGeometryFactory.createEdgeGeometry(data));
            } else if (MeshDataUtils.isFaceMesh(data)) {
                group.add(ThreeGeometryFactory.createFaceGeometry(data, opacity));
            }
        });
        this.tempShapes.add(group);
        return group.id;
    }

    displayInstancedMesh(data: MeshLike, matrixs: Matrix4[], opacity?: number): number {
        const geometry = ThreeGeometryFactory.createFaceBufferGeometry(data);
        const material = ThreeGeometryFactory.createMeshMaterial(opacity);

        ThreeGeometryFactory.setColor(geometry, data, material);
        const instancedMesh = new InstancedMesh(geometry, material, matrixs.length);
        matrixs.forEach((matrix, index) => {
            instancedMesh.setMatrixAt(index, ThreeHelper.fromMatrix(matrix));
        });

        this.tempShapes.add(instancedMesh);
        return instancedMesh.id;
    }

    displayLineSegments(data: EdgeMeshData): number {
        const bufferGeometry = new BufferGeometry();
        bufferGeometry.setAttribute("position", new BufferAttribute(data.position, 3));
        const material = new LineBasicMaterial();
        const lineSegments = new LineSegments(bufferGeometry, material);
        ThreeGeometryFactory.setColor(bufferGeometry, data, material);

        this.tempShapes.add(lineSegments);
        return lineSegments.id;
    }

    setPosition(id: number, position: Float32Array): void {
        const shape = this.tempShapes.getObjectById(id);
        if (shape === undefined) return;

        if ("geometry" in shape && shape.geometry instanceof BufferGeometry) {
            shape.geometry.setAttribute("position", new BufferAttribute(position, 3));
            shape.geometry.attributes["position"].needsUpdate = true;
        }
    }

    setInstanceMatrix(id: number, matrixs: Matrix4[]) {
        const shape = this.tempShapes.getObjectById(id) as InstancedMesh;
        if (shape === undefined) return;
        matrixs.forEach((matrix, index) => {
            shape.setMatrixAt(index, ThreeHelper.fromMatrix(matrix));
        });
        shape.instanceMatrix.needsUpdate = true;
    }

    removeMesh(id: number) {
        const shape = this.tempShapes.getObjectById(id);
        if (shape === undefined) return;
        shape.children.forEach((x) => {
            if (x instanceof Mesh || x instanceof LineSegments || x instanceof Points) {
                x.geometry.dispose();
                x.material.dispose();
            }
            if (isDisposable(x)) {
                x.dispose();
            }
        });
        shape.children.length = 0;
        this.tempShapes.remove(shape);
    }

    setVisible(node: INode, visible: boolean): void {
        const shape = this.getVisual(node);
        if (shape === undefined || shape.visible === visible) return;
        shape.visible = visible;
    }

    moveNode(node: INode, oldParent: INode): void {
        if (oldParent === node.parent) return;

        const parentNode = this._NodeVisualMap.get(oldParent) ?? this.visualShapes;
        const newParentNode = (this._NodeVisualMap.get(node.parent!) as any) ?? this.visualShapes;
        if (parentNode === newParentNode) {
            return;
        }

        if (parentNode instanceof Group) {
            const visual = this._NodeVisualMap.get(node);
            if (visual instanceof Object3D) {
                parentNode.remove(visual);
                newParentNode.add(visual);
            }
        }
    }

    addNode(nodes: INode[]) {
        nodes.forEach((node) => {
            if (!this._NodeVisualMap.has(node)) {
                this.displayNode(node);
            }
        });
    }

    private displayNode(node: INode) {
        let visualObject: (IVisualObject & Object3D) | undefined;
        if (node instanceof MeshNode) {
            visualObject = new ThreeMeshObject(this, node);
        } else if (node instanceof GeometryNode) {
            visualObject = new ThreeGeometry(node, this);
        } else if (node instanceof GroupNode) {
            visualObject = new GroupVisualObject(node);
        } else if (node instanceof ComponentNode) {
            visualObject = new ThreeComponentObject(node, this);
        }

        if (visualObject) {
            const parent = this.getParentVisual(node);
            parent.add(visualObject);
            this._visualNodeMap.set(visualObject, node);
            this._NodeVisualMap.set(node, visualObject);
        }
    }

    removeNode(models: INode[]) {
        models.forEach((m) => {
            const visual = this._NodeVisualMap.get(m);
            this._NodeVisualMap.delete(m);
            if (!visual) return;
            this._visualNodeMap.delete(visual);
            visual.parent?.remove(visual);
            visual.dispose();
        });
    }

    private getParentVisual(node: INode): Group {
        let parent = this.visualShapes;
        if (node.parent) {
            const parentNode = this._NodeVisualMap.get(node.parent);
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
                const wireframe = child.edges();
                if (wireframe) shapes.push(wireframe);
            } else if (shapeType === ShapeType.Face) {
                const faces = child.faces();
                if (faces) shapes.push(faces);
            }
        });
        return shapes;
    }

    getMaterial(id: string | string[]): ThreeMaterial | ThreeMaterial[] {
        if (Array.isArray(id)) {
            const materials = [];
            for (const i of id) {
                const material = this.materialMap.get(i);
                if (!material) {
                    throw new Error(`Material not found: ${i}`);
                }
                materials.push(material);
            }
            return materials.length === 1 ? materials[0] : materials;
        }

        const material = this.materialMap.get(id);
        if (!material) {
            throw new Error(`Material not found: ${id}`);
        }
        return material;
    }
}
