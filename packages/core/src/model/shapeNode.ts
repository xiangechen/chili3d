// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { VisualConfig } from "../config";
import type { IDocument } from "../document";
import { type IEqualityComparer, Logger, PubSub, Result } from "../foundation";
import { I18n, type I18nKeys } from "../i18n";
import { Matrix4 } from "../math";
import { property } from "../property";
import { serializable, serialize } from "../serialize";
import {
    type EdgeMeshData,
    type FaceMeshData,
    type IShape,
    type IShapeMeshData,
    MeshDataUtils,
    ShapeTypeUtils,
    type VertexMeshData,
} from "../shape";
import { MeshUtils } from "../shape/meshUtils";
import { GeometryNode } from "./geometryNode";

const SHAPE_UNDEFINED = "Shape not initialized";

export abstract class ShapeNode extends GeometryNode {
    protected _shape: Result<IShape> = Result.err(SHAPE_UNDEFINED);
    get shape(): Result<IShape> {
        return this._shape;
    }
    set shape(value: Result<IShape>) {
        this.setShape(value);
    }

    @property("common.shapeType")
    get shapeType(): string {
        if (!this._shape.isOk) {
            return this._shape.error;
        }

        return ShapeTypeUtils.stringValue(this._shape.value.shapeType);
    }

    /**
     * Iconfont key for the model tree (`INodeIcon`). Every shape node is some kind of
     * solid, so the base is the generic solid icon; sketches and parametric bodies
     * override it so the three read apart at a glance.
     */
    get icon(): string {
        return "icon-box";
    }

    /**
     * Whether this node is reference geometry — a datum plane, not a solid or a sketch a
     * modeling operation may consume. Generic shape pickers filter these out; the nodes
     * that are one override it (see the parametric `PlaneNode`).
     */
    get isReferenceGeometry(): boolean {
        return false;
    }

    protected setShape(shape: Result<IShape>) {
        if (this._shape.isOk && shape.isOk && this._shape.value.isEqual(shape.value)) {
            return;
        }

        if (!shape.isOk) {
            PubSub.default.pub("displayError", shape.error);
            return;
        }

        this.invalidateMesh();
        this.setProperty("shape", shape);
    }

    /**
     * Runtime-only extra edges merged into `mesh.edges` — drawn and pickable like the node's
     * own edges, but neither serialized nor recorded in the history. An editing session (or any
     * feature with geometry to overlay) sets them and clears them with `undefined`; the node's
     * own shape is never touched.
     */
    private _extraDisplayEdges: EdgeMeshData[] | undefined;
    get extraDisplayEdges(): readonly EdgeMeshData[] | undefined {
        return this._extraDisplayEdges;
    }
    setExtraDisplayEdges(edges: EdgeMeshData[] | undefined): void {
        const next = edges?.length ? edges : undefined;
        // A no-op change must not rebuild: the editor asks on every start, and createMesh
        // is a full remesh of the node.
        if (next === undefined && this._extraDisplayEdges === undefined) return;
        this._extraDisplayEdges = next;
        this.refreshMesh();
    }

    protected override createMesh(): IShapeMeshData {
        if (!this.shape.isOk) {
            Logger.warn(this.shape.error);
            return { edges: undefined, faces: undefined, vertexs: undefined };
        }
        const mesh = this.shape.value.mesh;
        // Capture the raw faces once per shape: the merge below writes back into the
        // mesher's cache, so re-reading `mesh.faces` on a rebuild would feed an
        // already-merged mesh back in and misapply the pairs to rearranged ranges.
        this._originFaceMesh ??= mesh.faces;
        if (this._originFaceMesh)
            mesh.faces = MeshUtils.mergeFaceMesh(
                this._originFaceMesh,
                this.faceMaterialPair.map((x) => [x.faceIndex, x.materialIndex]),
            );
        if (!this._extraDisplayEdges?.length) return mesh;
        // Wrap instead of assigning `mesh.edges`: the shape's mesher keeps owning (and
        // disposing) exactly the ranges it created, extras included never reach it.
        return {
            get vertexs() {
                return mesh.vertexs;
            },
            faces: mesh.faces,
            edges: MeshDataUtils.appendEdgeMeshes(mesh.edges, this._extraDisplayEdges!),
        };
    }

    override disposeInternal(): void {
        super.disposeInternal();
        this._shape.unchecked()?.dispose();
        this._shape = null as any;
    }
}

export class MultiShapeMesh implements IShapeMeshData {
    private readonly _vertexs: VertexMeshData;
    private readonly _edges: EdgeMeshData;
    private readonly _faces: FaceMeshData;
    /**
     * The shapes whose points have not been merged yet. Reading `shape.mesh.vertexs`
     * builds that shape's whole point mesh (see `Mesher.buildVertexMesh`), so `addShape`
     * only records the shape and `vertexs` merges on first use — a panel that never does
     * a vertex pick never pays for it.
     */
    private readonly _pendingVertexShapes: { shape: IShape; matrix: Matrix4 }[] = [];
    private _vertexsBuilt = false;

    get vertexs() {
        if (!this._vertexsBuilt) {
            this._vertexsBuilt = true;
            for (const { shape, matrix } of this._pendingVertexShapes) {
                const vertexs = shape.mesh.vertexs;
                if (vertexs) MeshUtils.combineVertexMeshData(this._vertexs, vertexs, matrix);
            }
            this._pendingVertexShapes.length = 0;
        }
        return this._vertexs.position.length > 0 ? this._vertexs : undefined;
    }

    get edges() {
        return this._edges.position.length > 0 ? this._edges : undefined;
    }

    get faces() {
        return this._faces.position.length > 0 ? this._faces : undefined;
    }

    constructor() {
        this._vertexs = {
            position: new Float32Array(),
            range: [],
            size: 3,
        };
        this._edges = {
            lineType: "solid",
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
        if (this._vertexsBuilt) {
            const vertexs = mesh.vertexs;
            if (vertexs) MeshUtils.combineVertexMeshData(this._vertexs, vertexs, totleMatrix);
        } else {
            this._pendingVertexShapes.push({ shape, matrix: totleMatrix });
        }
    }
}

export interface MultiShapeNodeOptions {
    document: IDocument;
    name: string;
    shapes: IShape[];
    materialId?: string;
    id?: string;
}

@serializable()
export class MultiShapeNode extends GeometryNode {
    private readonly _shapes: IShape[];
    @serialize()
    get shapes(): ReadonlyArray<IShape> {
        return this._shapes;
    }

    constructor(options: MultiShapeNodeOptions) {
        super({
            document: options.document,
            name: options.name,
            materialId: options.materialId,
            id: options.id,
        });
        this._shapes = options.shapes;
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

export interface ParameterShapeNodeOptions {
    document: IDocument;
    name?: string;
    materialId?: string;
    id?: string;
}

export abstract class ParameterShapeNode extends ShapeNode {
    /**
     * A shape derived from parameters (a box, a cylinder, an extrude body) is copied as
     * an instance of its source: the parameters stay one definition, and the copy is a
     * placement. Inputs that are not bodies opt out explicitly — `SketchNode` and
     * `PlaneNode`.
     */
    override get copiesAsInstance(): boolean {
        return true;
    }

    override get shape(): Result<IShape> {
        if (!this._isDisposed && !this._shape.isOk) {
            this._shape = this.generateShape();
        }
        return this._shape;
    }
    override set shape(value: Result<IShape>) {
        this.setShape(value);
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

    constructor(options: ParameterShapeNodeOptions) {
        super({
            document: options.document,
            name: options.name,
            materialId: options.materialId,
            id: options.id,
        });
    }

    protected abstract generateShape(): Result<IShape>;
}

export interface EditableShapeNodeOptions {
    document: IDocument;
    name: string;
    shape: IShape | Result<IShape>;
    materialId?: string | string[];
    id?: string;
}

@serializable()
export class EditableShapeNode extends ShapeNode {
    /** A plain solid is copied as an instance; `SketchNode` deliberately stays out. */
    override get copiesAsInstance(): boolean {
        return true;
    }

    override display(): I18nKeys {
        return "body.editableShape";
    }

    @serialize()
    override get shape() {
        return this._shape;
    }

    override set shape(shape: Result<IShape>) {
        this.setShape(shape);
    }

    constructor(options: EditableShapeNodeOptions) {
        super(options);
        this._shape = options.shape instanceof Result ? options.shape : Result.ok(options.shape);
    }
}
