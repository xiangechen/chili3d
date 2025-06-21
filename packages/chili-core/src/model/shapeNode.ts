// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { MeshUtils } from "chili-geo";
import { VisualConfig } from "../config";
import { IDocument } from "../document";
import { Id, IEqualityComparer, PubSub, Result } from "../foundation";
import { I18n, I18nKeys } from "../i18n";
import { Matrix4 } from "../math";
import { Serializer } from "../serialize";
import { EdgeMeshData, FaceMeshData, IShape, IShapeMeshData, LineType } from "../shape";
import { GeometryNode } from "./geometryNode";

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

        this.emitPropertyChanged("shape", oldShape);

        oldShape.unchecked()?.dispose();
    }

    protected override createMesh(): IShapeMeshData {
        if (!this.shape.isOk) {
            throw new Error(this.shape.error);
        }
        const mesh = this.shape.value.mesh;
        this._originFaceMesh = mesh.faces;
        if (mesh.faces)
            mesh.faces = MeshUtils.mergeFaceMesh(
                mesh.faces,
                this.faceMaterialPair.map((x) => [x.faceIndex, x.materialIndex]),
            );
        return mesh;
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
            index: new Uint32Array(),
            normal: new Float32Array(),
            position: new Float32Array(),
            uv: new Float32Array(),
            range: [],
            groups: [],
            color: VisualConfig.defaultFaceColor,
        };
    }

    public addShape(shape: IShape, matrix: Matrix4) {
        const mesh = shape.mesh;
        const totleMatrix = shape.matrix.multiply(matrix);
        if (mesh.faces) {
            MeshUtils.combineFaceMeshData(this._faces, mesh.faces, totleMatrix);
        }
        if (mesh.edges) {
            MeshUtils.combineEdgeMeshData(this._edges, mesh.edges, totleMatrix);
        }
    }
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
        materialId?: string | string[],
        id?: string,
    ) {
        super(document, name, materialId, id);
        this._shape = shape instanceof Result ? shape : Result.ok(shape);
    }
}
