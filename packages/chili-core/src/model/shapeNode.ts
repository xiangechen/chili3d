// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { VisualConfig } from "../config";
import { IDocument } from "../document";
import { Id, IEqualityComparer, PubSub, Result } from "../foundation";
import { I18n, I18nKeys } from "../i18n";
import { Matrix4 } from "../math";
import { Serializer } from "../serialize";
import { EdgeMeshData, FaceMeshData, IShape, IShapeMeshData, LineType } from "../shape";
import { GeometryNode } from "./geometryNode";

/**
 * ShapeNode is the base class for all shape nodes.
 * It provides a shape property that can be used to set the shape of the node.
 * The matrix of the shape is equal to the matrix of the node.
 * When the matrix of the node is changed, the matrix of the shape is also changed.
 */
export abstract class ShapeNode extends GeometryNode {
    protected _shape: Result<IShape> = Result.err(SHAPE_UNDEFINED);
    get shape(): Result<IShape> {
        return this._shape;
    }

    protected setShape(shape: Result<IShape>) {
        if (this._shape.isOk && this._shape.value.isEqual(shape.value)) {
            return;
        }

        if (!shape.isOk) {
            PubSub.default.pub("displayError", shape.error);
            return;
        }

        let oldShape = this._shape;
        this._shape = shape;
        this._mesh = undefined;
        this._boundingBox = undefined;
        this._shape.value.matrix = this.transform;
        this.emitPropertyChanged("shape", oldShape);

        oldShape.unchecked()?.dispose();
    }

    protected override onTransformChanged(newMatrix: Matrix4): void {
        if (this.shape.isOk) this.shape.value.matrix = newMatrix;
    }

    protected override createMesh(): IShapeMeshData {
        if (!this.shape.isOk) {
            throw new Error(this.shape.error);
        }
        return this.shape.value.mesh;
    }

    override disposeInternal(): void {
        super.disposeInternal();
        this._shape.unchecked()?.dispose();
        this._shape = null as any;
    }
}

export class MultiShapeMesh implements IShapeMeshData {
    private readonly _edges: EdgeMeshData;
    private readonly _faces: FaceMeshData;

    get edges() {
        return this._edges.position.length > 0 ? this._edges : undefined;
    }

    get faces() {
        return this._faces.position.length > 0 ? this._faces : undefined;
    }

    constructor() {
        this._edges = {
            lineType: LineType.Solid,
            position: new Float32Array(),
            range: [],
            color: VisualConfig.defaultEdgeColor,
        };

        this._faces = {
            index: [],
            normal: new Float32Array(),
            position: new Float32Array(),
            uv: new Float32Array(),
            range: [],
            color: VisualConfig.defaultFaceColor,
        };
    }

    public addShape(shape: IShape, matrix: Matrix4) {
        const mesh = shape.mesh;
        const totleMatrix = shape.matrix.multiply(matrix);
        if (mesh.faces) {
            this.combineFace(mesh.faces, totleMatrix);
        }
        if (mesh.edges) {
            this.combineEdge(mesh.edges, totleMatrix);
        }
    }

    private combineFace(faceMeshData: FaceMeshData | undefined, matrix: Matrix4) {
        if (!faceMeshData) {
            return;
        }

        let start = this._faces.position.length / 3;
        this._faces.index = this._faces.index.concat(faceMeshData.index.map((x) => x + start));
        this._faces.normal = this.combineFloat32Array(
            this._faces.normal,
            matrix.ofVectors(faceMeshData.normal),
        );
        this._faces.uv = this.combineFloat32Array(this._faces.uv, faceMeshData.uv);
        this._faces.position = this.combineFloat32Array(
            this._faces.position,
            matrix.ofPoints(faceMeshData.position),
        );
        this._faces.range = this._faces.range.concat(
            faceMeshData.range.map((g) => {
                return {
                    start: g.start + start,
                    shape: g.shape,
                    count: g.count,
                };
            }),
        );
    }

    private combineFloat32Array(arr1: ArrayLike<number>, arr2: ArrayLike<number>) {
        let arr = new Float32Array(arr1.length + arr2.length);
        arr.set(arr1);
        arr.set(arr2, arr1.length);
        return arr;
    }

    private combineEdge(edgeMeshData: EdgeMeshData | undefined, matrix: Matrix4) {
        if (!edgeMeshData) {
            return;
        }

        let start = this._edges.position.length / 3;
        this._edges.position = this.combineFloat32Array(
            this._edges.position,
            matrix.ofPoints(edgeMeshData.position),
        );
        this._edges.range = this._edges.range.concat(
            edgeMeshData.range.map((g) => {
                return {
                    start: g.start + start,
                    shape: g.shape,
                    count: g.count,
                };
            }),
        );
    }

    updateMeshShape() {}
}

@Serializer.register(["document", "name", "shapes", "materialId", "id"])
export class MultiShapeNode extends GeometryNode {
    private readonly _shapes: IShape[];
    @Serializer.serialze()
    get shapes(): ReadonlyArray<IShape> {
        return this._shapes;
    }

    constructor(
        document: IDocument,
        name: string,
        shapes: IShape[],
        materialId?: string,
        id: string = Id.generate(),
    ) {
        super(document, name, materialId, id);
        this._shapes = shapes;
    }

    protected override createMesh(): IShapeMeshData {
        const meshes = new MultiShapeMesh();

        this._shapes.forEach((shape) => {
            meshes.addShape(shape, Matrix4.identity());
        });

        return meshes;
    }

    override display(): I18nKeys {
        return "body.multiShape";
    }
}

const SHAPE_UNDEFINED = "Shape not initialized";
export abstract class ParameterShapeNode extends ShapeNode {
    override get shape(): Result<IShape> {
        if (!this._shape.isOk && this._shape.error === SHAPE_UNDEFINED) {
            this._shape = this.generateShape();
        }
        return this._shape;
    }

    protected setPropertyEmitShapeChanged<K extends keyof this>(
        property: K,
        newValue: this[K],
        onPropertyChanged?: (property: K, oldValue: this[K]) => void,
        equals?: IEqualityComparer<this[K]> | undefined,
    ): boolean {
        if (this.setProperty(property, newValue, onPropertyChanged, equals)) {
            this.setShape(this.generateShape());
            return true;
        }

        return false;
    }

    constructor(document: IDocument, materialId?: string, id?: string) {
        super(document, undefined as any, materialId, id);
        this.setPrivateValue("name", I18n.translate(this.display()));
    }

    protected abstract generateShape(): Result<IShape>;
}

@Serializer.register(["document", "name", "shape", "materialId", "id"])
export class EditableShapeNode extends ShapeNode {
    override display(): I18nKeys {
        return "body.editableShape";
    }

    @Serializer.serialze()
    override get shape() {
        return this._shape;
    }

    override set shape(shape: Result<IShape>) {
        this.setShape(shape);
    }

    constructor(
        document: IDocument,
        name: string,
        shape: IShape | Result<IShape>,
        materialId?: string,
        id?: string,
    ) {
        super(document, name, materialId, id);
        this._shape = shape instanceof Result ? shape : Result.ok(shape);
        this.setPrivateValue("transform", this._shape.value.matrix);
    }
}
