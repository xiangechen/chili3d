// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    Annotation,
    BoundingBox,
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
    type MeshOption,
    type NodeRecord,
    NodeUtils,
    type ShapeMeshData,
    type ShapeNode,
    type ShapeType,
    ShapeTypes,
    Texture,
    XY,
    type XYZ,
} from "@chili3d/core";
import {
    Box3,
    BufferAttribute,
    BufferGeometry,
    Group,
    InstancedMesh,
    LineBasicMaterial,
    LineSegments,
    Mesh,
    type MeshLambertMaterial,
    type MeshPhysicalMaterial,
    Object3D,
    PMREMGenerator,
    Points,
    type Scene,
    type Material as ThreeMaterial,
    Vector3,
    type WebGLRenderer,
    type WebGLRenderTarget,
} from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import { AnnotationBatch } from "./annotationBatch";
import { createAnnotationVisual, ThreeAnnotation } from "./threeAnnotation";
import { ThreeGeometry } from "./threeGeometry";
import { ThreeGeometryFactory } from "./threeGeometryFactory";
import { ThreeHelper } from "./threeHelper";
import { GroupVisualObject, ThreeComponentObject, ThreeMeshObject } from "./threeVisualObject";

/** Whether a material in `materialMap` is one of the document's physically based surfaces. */
function isPhysicalMaterial(material: ThreeMaterial): material is MeshPhysicalMaterial {
    return (material as Partial<MeshPhysicalMaterial>).isMeshPhysicalMaterial === true;
}

export class ThreeVisualContext implements IVisualContext {
    private readonly _visualNodeMap = new Map<IVisualObject, INode>();
    private readonly _NodeVisualMap = new Map<INode, IVisualObject & Object3D>();
    private readonly _annotationBatches = new Map<Object3D, AnnotationBatch>();
    readonly materialMap = new Map<string, ThreeMaterial>();

    readonly visualShapes: Group;
    readonly tempShapes: Group;
    readonly cssObjects: Group;
    private _environmentTarget?: WebGLRenderTarget;

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

    /**
     * Image-based lighting for the physically based materials, from a neutral studio room: a
     * metallic surface has nothing to reflect without it and renders near-black, so raising
     * `metalness` would otherwise make a body darker rather than shinier. It also carries the
     * fill light the `AmbientLight` used to provide. The scene is shared by every view of a
     * document, so the first view to be created sets it up and the others reuse it.
     *
     * The room goes in as it ships, and `scene.environmentIntensity` is the fraction of it that
     * the materials *without* an environment of their own are lit at: the highlight, selection and
     * lock overlays, which are lit Lambert surfaces. A document material carries the environment
     * itself, so its `Material.envMapIntensity` decides how much of the room it reflects.
     */
    initEnvironment(renderer: WebGLRenderer) {
        if (this._environmentTarget !== undefined) return;

        const room = new RoomEnvironment();
        const pmrem = new PMREMGenerator(renderer);
        this._environmentTarget = pmrem.fromScene(room, 0.04);
        this.scene.environment = this._environmentTarget.texture;
        this.scene.environmentIntensity = 0.1;
        pmrem.dispose();
        room.dispose();

        // The materials that were made before this view existed hold no environment yet.
        for (const material of this.visual.document.modelManager.materials) {
            const threeMaterial = this.materialMap.get(material.id);
            if (threeMaterial !== undefined) this.attachEnvironment(threeMaterial, material);
        }
    }

    /**
     * Hands a document material the scene's environment as its own. Materials that go through the
     * scene keep three's `scene.environmentIntensity` for the uniform — and that is overwritten on
     * every frame after the first, so a material's own `envMapIntensity` is only honoured when the
     * environment is attached to the material. With this a material can reflect more than the
     * bodies around it, which is what a metal needs: it has no diffuse term to light it.
     */
    private attachEnvironment(threeMaterial: ThreeMaterial, material: Material) {
        const environment = this.scene.environment;
        // the map is typed as three's Material; only the physically based ones take an environment
        if (environment === null || !isPhysicalMaterial(threeMaterial)) return;

        threeMaterial.envMap = environment;
        threeMaterial.envMapIntensity = material.envMapIntensity;
        // swapping a map recompiles the material's program
        threeMaterial.needsUpdate = true;
    }

    private readonly onMaterialCollectionChanged = (args: CollectionChangedArgs) => {
        if (args.action === "add") {
            args.items.forEach(this.createThreeMaterial.bind(this));
        } else if (args.action === "remove") {
            args.items.forEach(this.removeThreeMaterial.bind(this));
        }
    };

    private createThreeMaterial(material: Material) {
        const result = ThreeHelper.parseToThreeMaterial(material);
        this.attachEnvironment(result, material);
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

        // A three.js Color/Vector2 has to be written through `set`: assigning the document's
        // own value over it would replace the three.js object itself, and the shader would
        // read a plain number (or an XY) from then on. The flags are three.js's own, so a new
        // color- or vector-valued material property keeps working without a list to maintain.
        const target = material[path];
        if (target?.isColor === true) {
            target.set(value);
            return;
        }
        if (target?.isVector2 === true) {
            target.set(value.x, value.y);
            return;
        }

        if (!path.includes(".")) {
            if (value instanceof Texture) {
                this.setTexture(material, path, value);
            } else {
                material[path] = value;
            }
            if (path === "opacity") {
                material["transparent"] = value < 1;
            }
        } else {
            this.setTextureValue(source, material, path, value);
        }
    };

    /**
     * Puts a texture into a material slot. A program compiles its map slots in — whether `USE_MAP`
     * is defined is decided when it is built — so a material that had no map there keeps sampling
     * nothing however often the uniform is refreshed. Giving the slot a texture (or taking one
     * away) therefore has to rebuild the program, which is what `needsUpdate` asks for.
     */
    private setTexture(threeMaterial: any, slot: string, texture: Texture) {
        threeMaterial[slot] = ThreeHelper.loadTexture(texture, slot);
        threeMaterial.needsUpdate = true;
    }

    private setTextureValue(material: any, threeMaterial: any, path: string, value: any) {
        const paths = path.split(".");
        if (path.endsWith(".image") && material[paths[0]] instanceof Texture && paths[0] in threeMaterial) {
            this.setTexture(threeMaterial, paths[0], material[paths[0]]);
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
            if (x.action === "add" || x.action === "insertBefore" || x.action === "insertAfter") {
                NodeUtils.nodeOrChildrenAppendToNodes(adds, x.node);
            } else if (x.action === "remove" || x.action === "transfer") {
                NodeUtils.nodeOrChildrenAppendToNodes(rms, x.node);
            } else if (x.action === "move" && x.newParent) {
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

    /**
     * The batch drawing every annotation directly under `parent`, created on first
     * ask. Batches prune themselves when their last annotation unregisters.
     */
    batchFor(parent: Object3D): AnnotationBatch {
        let batch = this._annotationBatches.get(parent);
        if (batch === undefined) {
            batch = new AnnotationBatch(this, () => this._annotationBatches.delete(parent));
            this._annotationBatches.set(parent, batch);
            parent.add(batch);
        }
        return batch;
    }

    removeVisualObject(object: IVisualObject): void {
        if (object instanceof Object3D) {
            this.visualShapes.remove(object);
        }
    }

    dispose() {
        this._environmentTarget?.dispose();
        this._environmentTarget = undefined;
        this.scene.environment = null;
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
        this._annotationBatches.clear();
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
            // Annotations have no geometryNode — and no business in a shape filter.
            if (node === undefined) return false;
            const shape = (node as ShapeNode)?.shape?.unchecked();
            if (filter && shape && !filter.allow(shape, node.transform)) {
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
        } else if (obj instanceof ThreeComponentObject) {
            visuals.push(obj);
            // Member annotations hang under the component object (the merged mesh has no
            // room for them): descend, or picking and rectangle selection never see them.
            obj.annotations.forEach((x) => this._getVisualObject(visuals, x));
        } else if (
            obj instanceof ThreeGeometry ||
            obj instanceof ThreeMeshObject ||
            obj instanceof ThreeAnnotation
        ) {
            visuals.push(obj);
        }
    }

    displayMesh(datas: ShapeMeshData[], meshOption?: MeshOption): number {
        const group = new Group();
        datas.forEach((data) => {
            if (MeshDataUtils.isVertexMesh(data)) {
                group.add(ThreeGeometryFactory.createVertexGeometry(data, meshOption));
            } else if (MeshDataUtils.isEdgeMesh(data)) {
                group.add(ThreeGeometryFactory.createEdgeGeometry(data, meshOption));
            } else if (MeshDataUtils.isFaceMesh(data)) {
                group.add(ThreeGeometryFactory.createFaceGeometry(data, meshOption));
            }
        });
        this.tempShapes.add(group);
        return group.id;
    }

    setMeshColor(id: number, color: number): void {
        const group = this.tempShapes.getObjectById(id) as Group;
        if (!group) return;

        group.children.forEach((mesh: any) => {
            (mesh.material as MeshLambertMaterial).color.setHex(color);
        });
    }

    displayInstancedMesh(data: MeshLike, matrixs: Matrix4[], meshOption?: MeshOption): number {
        const geometry = ThreeGeometryFactory.createFaceBufferGeometry(data);
        const material = ThreeGeometryFactory.createMeshMaterial(meshOption);

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
        if (shape instanceof ThreeComponentObject) {
            // Three's own traversal hides member annotations on render, but the pick
            // paths read the flag on the annotation visual itself.
            shape.annotations.forEach((x) => (x.visible = visible));
        }
    }

    setNodeOnTop(nodes: INode[], onTop: boolean): void {
        nodes.forEach((node) => {
            const visual = this._NodeVisualMap.get(node);
            if (visual instanceof ThreeGeometry) {
                visual.setRenderOnTop(onTop);
            }
        });
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
        } else if (node instanceof Annotation) {
            visualObject = createAnnotationVisual(this, node);
        }

        if (visualObject) {
            const parent = this.getParentVisual(node);
            parent.add(visualObject);
            this._visualNodeMap.set(visualObject, node);
            this._NodeVisualMap.set(node, visualObject);
            if (visualObject instanceof ThreeComponentObject) {
                // Member annotations are displayed by the component object, not through
                // node records — register them so getNode/getVisual resolve for picking.
                visualObject.annotations.forEach((annotation) => {
                    this._visualNodeMap.set(annotation, annotation.annotation);
                    this._NodeVisualMap.set(annotation.annotation, annotation);
                });
            }
        }
    }

    removeNode(models: INode[]) {
        models.forEach((m) => {
            const visual = this._NodeVisualMap.get(m);
            this._NodeVisualMap.delete(m);
            if (!visual) return;
            this._visualNodeMap.delete(visual);
            if (visual instanceof ThreeComponentObject) {
                visual.annotations.forEach((annotation) => {
                    this._visualNodeMap.delete(annotation);
                    // A sibling instance of the same component may own the node's entry now.
                    if (this._NodeVisualMap.get(annotation.annotation) === annotation) {
                        this._NodeVisualMap.delete(annotation.annotation);
                    }
                });
            }
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
        if (shapeType === ShapeTypes.shape) {
            return [...this.visualShapes.children];
        }
        const shapes: Object3D[] = [];
        this.visualShapes.traverse((child) => {
            if (!(child instanceof ThreeGeometry)) return;

            if (shapeType === ShapeTypes.edge) {
                const wireframe = child.edges();
                if (wireframe) shapes.push(wireframe);
            } else if (shapeType === ShapeTypes.face) {
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
