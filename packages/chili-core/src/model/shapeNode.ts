// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

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
    get edges(): EdgeMeshData | undefined {
        return this._edges.positions.length > 0 ? this._edges : undefined;
    }
    get faces(): FaceMeshData | undefined {
        return this._faces.positions.length > 0 ? this._faces : undefined;
    }

    constructor(readonly shapes: IShape[]) {
        this._edges = this.initEdgeMeshData();
        this._faces = this.initFaceMeshData();

        this.meshShapes();
    }

    private initEdgeMeshData(): EdgeMeshData {
        return {
            lineType: LineType.Solid,
            positions: [],
            groups: [],
            color: VisualConfig.defaultEdgeColor,
        };
    }

    private initFaceMeshData(): FaceMeshData {
        return {
            indices: [],
            normals: [],
            positions: [],
            uvs: [],
            groups: [],
            color: VisualConfig.defaultFaceColor,
        };
    }

    private meshShapes() {
        for (const shape of this.shapes) {
            this.combineEdge(shape.mesh.edges, shape.matrix);
            this.combineFace(shape.mesh.faces, shape.matrix);
        }
    }

    private combineFace(faceMeshData: FaceMeshData | undefined, matrix: Matrix4) {
        if (!faceMeshData) {
            return;
        }

        let start = this._faces.positions.length / 3;
        this._faces.indices = this._faces.indices.concat(faceMeshData.indices);
        this._faces.normals = this._faces.normals.concat(matrix.ofVectors(faceMeshData.normals));
        this._faces.uvs = this._faces.uvs.concat(faceMeshData.uvs);
        this._faces.positions = this._faces.positions.concat(matrix.ofPoints(faceMeshData.positions));
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

    private combineEdge(edgeMeshData: EdgeMeshData | undefined, matrix: Matrix4) {
        if (!edgeMeshData) {
            return;
        }

        let start = this._edges.positions.length / 3;
        this._edges.positions = this._edges.positions.concat(matrix.ofPoints(edgeMeshData.positions));
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
    override get shape(): Result<IShape> {
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

        if (shape instanceof Result) {
            this._shape = shape;
        } else {
            this._shape = Result.ok(shape);
        }
        this.setPrivateValue("transform", this._shape.value.matrix);
    }
}
