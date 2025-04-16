// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { VisualConfig } from "../config";
import { IDocument } from "../document";
import { Id, IEqualityComparer, PubSub, Result } from "../foundation";
import { I18n, I18nKeys } from "../i18n";
import { Matrix4 } from "../math";
import { Serializer } from "../serialize";
import { EdgeMeshData, FaceMeshData, IShape, IShapeMeshData, LineType } from "../shape";
import { GeometryNode } from "./node";

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

export class ManyMesh implements IShapeMeshData {
    private readonly _edges: EdgeMeshData;
    private readonly _faces: FaceMeshData;

    get edges() {
        return this._edges.positions.length > 0 ? this._edges : undefined;
    }

    get faces() {
        return this._faces.positions.length > 0 ? this._faces : undefined;
    }

    constructor(readonly shapes: IShape[]) {
        this._edges = {
            lineType: LineType.Solid,
            positions: new Float32Array(),
            groups: [],
            color: VisualConfig.defaultEdgeColor,
        };

        this._faces = {
            indices: new Uint16Array(),
            normals: new Float32Array(),
            positions: new Float32Array(),
            uvs: new Float32Array(),
            groups: [],
            color: VisualConfig.defaultFaceColor,
        };

        for (const shape of shapes) {
            this.combineShape(shape);
        }
    }

    private combineShape(shape: IShape) {
        const { mesh, matrix } = shape;
        if (mesh.faces) {
            this.combineFace(mesh.faces, matrix);
        }
        if (mesh.edges) {
            this.combineEdge(mesh.edges, matrix);
        }
    }

    private combineFace(faceMeshData: FaceMeshData | undefined, matrix: Matrix4) {
        if (!faceMeshData) {
            return;
        }

        let start = this._faces.positions.length / 3;
        this._faces.indices = this.combineUintArray(this._faces.indices, faceMeshData.indices);
        this._faces.normals = this.combineFloat32Array(
            this._faces.normals,
            matrix.ofVectors(faceMeshData.normals),
        );
        this._faces.uvs = this.combineFloat32Array(this._faces.uvs, faceMeshData.uvs);
        this._faces.positions = this.combineFloat32Array(
            this._faces.positions,
            matrix.ofPoints(faceMeshData.positions),
        );
        this._faces.groups = this._faces.groups.concat(
            faceMeshData.groups.map((g) => {
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

    private combineUintArray(arr1: Uint16Array | Uint32Array, arr2: Uint16Array | Uint32Array) {
        let array: Uint16Array | Uint32Array;
        if (arr1 instanceof Uint16Array && arr2 instanceof Uint16Array) {
            array = new Uint16Array(arr1.length + arr2.length);
        } else {
            array = new Uint32Array(arr1.length + arr2.length);
        }
        array.set(arr1);
        array.set(arr2, arr1.length);
        return array;
    }

    private combineEdge(edgeMeshData: EdgeMeshData | undefined, matrix: Matrix4) {
        if (!edgeMeshData) {
            return;
        }

        let start = this._edges.positions.length / 3;
        this._edges.positions = this.combineFloat32Array(this._edges.positions, edgeMeshData.positions);
        this._edges.groups = this._edges.groups.concat(
            edgeMeshData.groups.map((g) => {
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
        return new ManyMesh(this._shapes);
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
