// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    BoundingBox,
    type EdgeMeshData,
    type FaceMeshData,
    gc,
    type ICompound,
    type ICompoundSolid,
    type ICurve,
    type IDisposable,
    Id,
    type IEdge,
    type IFace,
    type IShape,
    type IShapeMeshData,
    type IShell,
    type ISolid,
    type ISubEdgeShape,
    type ISubFaceShape,
    type ISubVertexShape,
    type ISurface,
    type ITrimmedCurve,
    type IVertex,
    type IWire,
    isDisposable,
    type JoinType,
    Line,
    Logger,
    MathUtils,
    type Matrix4,
    type Orientation,
    type OrientedBoundingBox,
    Plane,
    Result,
    type Serialized,
    type SerializedData,
    type ShapeMeshRange,
    type ShapeType,
    serializable,
    type VertexMeshData,
    VisualConfig,
    type XYZ,
    type XYZLike,
} from "@chili3d/core";
import type {
    EdgeMeshData as OccEdgeMeshData,
    FaceMeshData as OccFaceMeshData,
    TopoDS_Compound,
    TopoDS_CompSolid,
    TopoDS_Edge,
    TopoDS_Face,
    TopoDS_Shape,
    TopoDS_Shell,
    TopoDS_Solid,
    TopoDS_Vertex,
    TopoDS_Wire,
} from "../lib/chili-wasm";
import { OccCurve, OccTrimmedCurve } from "./curve";
import {
    convertFromMatrix,
    convertToMatrix,
    getJoinType,
    getOrientation,
    getShapeEnum,
    getShapeType,
    toDir,
    toPnt,
    toXYZ,
} from "./helper";
import { OccSurface } from "./surface";

export interface OccShapeOptions {
    shape: TopoDS_Shape;
    id?: string;
}

function occShapeSerialize(target: OccShape): SerializedData {
    return {
        shape: wasm.Converter.convertToBrep(target.shape),
        id: target.id,
    };
}

function occShapeDeserialize(properties: Serialized) {
    return OccShape.wrap(
        wasm.Converter.convertFromBrep(properties["shape"] as string),
        properties["id"] as string,
    ) as OccShape;
}

@serializable({
    deserialize: occShapeDeserialize,
    serialize: occShapeSerialize,
})
export class OccShape implements IShape {
    private _boundingBox: BoundingBox | undefined;
    private _orientedBoundingBox: OrientedBoundingBox | undefined;

    readonly shapeType: ShapeType;
    protected _mesh: IShapeMeshData | undefined;
    get mesh(): IShapeMeshData {
        this._mesh ??= new Mesher(this);
        return this._mesh;
    }

    protected _shape: TopoDS_Shape;
    get shape(): TopoDS_Shape {
        return this._shape;
    }

    id: string;

    get matrix(): Matrix4 {
        return gc((c) => {
            return convertToMatrix(c(c(this.shape.getLocation()).transformation()));
        });
    }

    set matrix(matrix: Matrix4) {
        gc((c) => {
            const location = c(new wasm.TopLoc_Location(c(convertFromMatrix(matrix))));
            this._shape.setLocation(location, false);

            if (this._boundingBox) {
                this._boundingBox = BoundingBox.transformed(this._boundingBox, matrix);
            }
            if (this._orientedBoundingBox) {
                this._orientedBoundingBox = {
                    center: {
                        location: matrix.ofPoint(this._orientedBoundingBox.center.location),
                        xDirection: matrix.ofVector(this._orientedBoundingBox.center.xDirection),
                        direction: matrix.ofVector(this._orientedBoundingBox.center.direction),
                    },
                    size: this._orientedBoundingBox.size,
                };
            }

            this.onTransformChanged();
        });
    }

    constructor(options: OccShapeOptions) {
        this.id = options.id ?? Id.generate();
        this._shape = options.shape;
        this.shapeType = getShapeType(options.shape);
    }

    static wrap(shape: TopoDS_Shape, id: string = Id.generate()): IShape {
        if (shape.isNull()) {
            throw new Error("Shape is null");
        }

        switch (shape.shapeType()) {
            case wasm.TopAbs_ShapeEnum.TopAbs_COMPOUND:
                return new OccCompound({ shape: wasm.TopoDS.compound(shape), id });
            case wasm.TopAbs_ShapeEnum.TopAbs_COMPSOLID:
                return new OccCompSolid({ shape: wasm.TopoDS.compsolid(shape), id });
            case wasm.TopAbs_ShapeEnum.TopAbs_SOLID:
                return new OccSolid({ shape: wasm.TopoDS.solid(shape), id });
            case wasm.TopAbs_ShapeEnum.TopAbs_SHELL:
                return new OccShell({ shape: wasm.TopoDS.shell(shape), id });
            case wasm.TopAbs_ShapeEnum.TopAbs_FACE:
                return new OccFace({ shape: wasm.TopoDS.face(shape), id });
            case wasm.TopAbs_ShapeEnum.TopAbs_WIRE:
                return new OccWire({ shape: wasm.TopoDS.wire(shape), id });
            case wasm.TopAbs_ShapeEnum.TopAbs_EDGE:
                return new OccEdge({ shape: wasm.TopoDS.edge(shape), id });
            case wasm.TopAbs_ShapeEnum.TopAbs_VERTEX:
                return new OccVertex({ shape: wasm.TopoDS.vertex(shape), id });
            default:
                return new OccShape({ shape, id });
        }
    }

    boundingBox(): BoundingBox {
        if (!this._boundingBox) {
            this._boundingBox = wasm.Shape.boundingBox(this.shape, this._mesh !== undefined);
        }
        return this._boundingBox;
    }

    orientedBoundingBox(): OrientedBoundingBox {
        if (!this._orientedBoundingBox) {
            this._orientedBoundingBox = wasm.Shape.orientedBoundingBox(this.shape, this._mesh !== undefined);
        }
        return this._orientedBoundingBox;
    }

    transformed(matrix: Matrix4): IShape {
        return gc((c) => {
            const location = c(new wasm.TopLoc_Location(c(convertFromMatrix(matrix))));
            const shape = this._shape.located(location, false); // TODO: check if this is correct
            return OccShape.wrap(shape);
        });
    }

    transformedMul(matrix: Matrix4): IShape {
        return gc((c) => {
            const location = c(new wasm.TopLoc_Location(c(convertFromMatrix(matrix))));
            const shape = this._shape.moved(location, false); // TODO: check if this is correct
            return OccShape.wrap(shape);
        });
    }

    protected onTransformChanged(): void {
        if (this._mesh) {
            Logger.warn("Shape matrix changed, mesh will be recreated");
            this._mesh = undefined;
        }
    }

    edgesMeshPosition(): EdgeMeshData {
        const occMesher = new wasm.Mesher(this.shape, 0.005, true);
        const position = occMesher.edgesMeshPosition();
        occMesher.delete();
        return {
            lineType: "solid",
            position: new Float32Array(position),
            range: [],
            color: VisualConfig.defaultEdgeColor,
        };
    }

    clone(): IShape {
        return OccShape.wrap(wasm.Shape.clone(this._shape));
    }

    isClosed(): boolean {
        return wasm.Shape.isClosed(this.shape);
    }

    isNull(): boolean {
        return this.shape.isNull();
    }

    isEqual(other: IShape): boolean {
        if (other instanceof OccShape) {
            return this.shape.isEqual(other.shape);
        }
        return false;
    }

    isSame(other: IShape): boolean {
        if (other instanceof OccShape) {
            return this.shape.isSame(other.shape);
        }
        return false;
    }

    isPartner(other: IShape): boolean {
        if (other instanceof OccShape) {
            return this.shape.isPartner(other.shape);
        }
        return false;
    }

    orientation(): Orientation {
        return getOrientation(this.shape);
    }

    findAncestor(ancestorType: ShapeType, fromShape: IShape): IShape[] {
        if (fromShape instanceof OccShape) {
            return wasm.Shape.findAncestor(fromShape.shape, this.shape, getShapeEnum(ancestorType)).map((x) =>
                OccShape.wrap(x),
            );
        }
        return [];
    }

    findSubShapes(subshapeType: ShapeType): IShape[] {
        return wasm.Shape.findSubShapes(this.shape, getShapeEnum(subshapeType)).map((x) => OccShape.wrap(x));
    }

    iterShape(): IShape[] {
        let subShape = wasm.Shape.iterShape(this.shape);
        if (subShape.length === 1 && subShape[0].shapeType() === this.shape.shapeType()) {
            subShape = wasm.Shape.iterShape(subShape[0]);
        }
        return subShape.map((x) => OccShape.wrap(x));
    }

    section(shape: IShape | Plane): IShape {
        if (shape instanceof OccShape) {
            const section = wasm.Shape.sectionSS(this.shape, shape.shape);
            return OccShape.wrap(section);
        }
        if (shape instanceof Plane) {
            const section = wasm.Shape.sectionSP(this.shape, {
                location: shape.origin,
                direction: shape.normal,
                xDirection: shape.xvec,
            });
            return OccShape.wrap(section);
        }

        throw new Error("Unsupported type");
    }

    split(shapes: IShape[]): IShape {
        const occShapes = shapes.map((x) => {
            if (x instanceof OccShape) {
                return x.shape;
            }
            throw new Error("Unsupported type");
        });
        return OccShape.wrap(wasm.Shape.splitShapes([this.shape], occShapes));
    }

    reserve(): void {
        this.shape.reverse();
    }

    hlr(position: XYZLike, direction: XYZLike, xDir: XYZLike): IShape {
        return gc((c) => {
            const shape = wasm.Shape.hlr(this.shape, c(toPnt(position)), c(toDir(direction)), c(toDir(xDir)));
            return OccShape.wrap(shape);
        });
    }

    #isDisposed = false;
    readonly dispose = () => {
        if (!this.#isDisposed) {
            this.#isDisposed = true;
            this.disposeInternal();
        }
    };

    protected disposeInternal(): void {
        this._shape.nullify();
        this._shape.delete();
        this._shape = null as any;

        if (this._mesh && isDisposable(this._mesh)) {
            this._mesh.dispose();
            this._mesh = null as any;
        }
    }
}

export interface OccVertexOptions {
    shape: TopoDS_Vertex;
    id?: string;
}

@serializable({
    deserialize: occShapeDeserialize,
    serialize: occShapeSerialize,
})
export class OccVertex extends OccShape implements IVertex {
    readonly vertex: TopoDS_Vertex;

    constructor(options: OccVertexOptions) {
        super(options);
        this.vertex = options.shape;
    }

    point(): XYZ {
        return toXYZ(wasm.Vertex.point(this.vertex));
    }
}

export interface OccEdgeOptions {
    shape: TopoDS_Edge;
    id?: string;
}

@serializable({
    deserialize: occShapeDeserialize,
    serialize: occShapeSerialize,
})
export class OccEdge extends OccShape implements IEdge {
    private _edge: TopoDS_Edge;
    get edge(): TopoDS_Edge {
        return this._edge;
    }

    constructor(options: OccEdgeOptions) {
        super(options);
        this._edge = options.shape;
    }

    update(curve: ICurve): void {
        if (!(curve instanceof OccCurve)) {
            throw new Error("Invalid curve");
        }
        this._shape = wasm.Edge.fromCurve(curve.curve);
        this._mesh = undefined;
    }

    intersect(other: IEdge | Line): { parameter: number; point: XYZ }[] {
        return gc((c) => {
            let edge: TopoDS_Edge | undefined;
            if (other instanceof OccEdge) {
                edge = other.edge;
            }
            if (other instanceof Line) {
                const line = c(wasm.Curve.makeLine(other.point, other.direction));
                edge = c(wasm.Edge.fromCurve(line.get()));
            }
            if (edge === undefined) {
                throw new Error("Unsupported type");
            }
            return wasm.Edge.intersect(this.edge, edge).map((x) => ({
                parameter: x.parameter,
                point: toXYZ(x.point),
            }));
        });
    }

    length(): number {
        return wasm.Edge.curveLength(this.edge);
    }

    private _curve: ITrimmedCurve | undefined;
    get curve(): ITrimmedCurve {
        this._curve ??= gc((c) => {
            const curve = c(wasm.Edge.curve(this.edge));
            return new OccTrimmedCurve(curve.get()!);
        });
        return this._curve as ITrimmedCurve;
    }

    protected override onTransformChanged(): void {
        super.onTransformChanged();
        if (this._curve) {
            this._curve.dispose();
            this._curve = undefined;
        }
    }

    offset(distance: number, dir: XYZ): Result<IEdge> {
        return gc((c) => {
            const occDir = c(toDir(dir));
            if (MathUtils.anyEqualZero(distance)) {
                return Result.err("Invalid distance");
            }
            const edge = wasm.Edge.offset(this.edge, occDir, distance);
            if (edge.isNull()) {
                return Result.err("Offset failed");
            }
            return Result.ok(OccShape.wrap(edge));
        });
    }

    trim(start: number, end: number): IEdge {
        const newEdge = wasm.Edge.trim(this.edge, start, end);
        return new OccEdge({ shape: newEdge });
    }

    protected override disposeInternal(): void {
        super.disposeInternal();
        if (this._curve && isDisposable(this._curve)) {
            this._curve.dispose();
            this._curve = null as any;
        }
    }
}

export interface OccWireOptions {
    shape: TopoDS_Wire;
    id?: string;
}

@serializable({
    deserialize: occShapeDeserialize,
    serialize: occShapeSerialize,
})
export class OccWire extends OccShape implements IWire {
    readonly wire: TopoDS_Wire;

    constructor(options: OccWireOptions) {
        super(options);
        this.wire = options.shape;
    }

    edgeLoop(): IEdge[] {
        return wasm.Wire.edgeLoop(this.wire).map((x) => OccShape.wrap(x)) as IEdge[];
    }

    toFace(): Result<IFace> {
        const face = wasm.Wire.makeFace(this.wire);
        if (face.isNull()) {
            return Result.err("To face failed");
        }
        return Result.ok(new OccFace({ shape: face }));
    }

    offset(distance: number, joinType: JoinType): Result<IShape> {
        if (MathUtils.anyEqualZero(distance)) {
            return Result.err("Invalid distance");
        }
        const offseted = wasm.Wire.offset(this.wire, distance, getJoinType(joinType));
        if (offseted.isNull()) {
            return Result.err("Offset failed");
        }
        return Result.ok(OccShape.wrap(offseted));
    }
}

export interface OccFaceOptions {
    shape: TopoDS_Face;
    id?: string;
}

@serializable({
    deserialize: occShapeDeserialize,
    serialize: occShapeSerialize,
})
export class OccFace extends OccShape implements IFace {
    readonly face: TopoDS_Face;

    constructor(options: OccFaceOptions) {
        super(options);
        this.face = options.shape;
    }

    area(): number {
        return wasm.Face.area(this.face);
    }

    normal(u: number, v: number): [point: XYZ, normal: XYZ] {
        return gc((c) => {
            const pnt = c(new wasm.gp_Pnt(0, 0, 0));
            const normal = c(new wasm.gp_Vec(0, 0, 0));
            wasm.Face.normal(this.shape, u, v, pnt, normal);
            return [toXYZ(pnt), toXYZ(normal)];
        });
    }
    outerWire(): IWire {
        return new OccWire({ shape: wasm.Face.outerWire(this.face) });
    }
    surface(): ISurface {
        return gc((c) => {
            const handleSurface = c(wasm.Face.surface(this.face));
            return OccSurface.wrap(handleSurface.get()!);
        });
    }
    segmentsOfEdgeOnFace(edge: IEdge): undefined | { start: number; end: number } {
        if (edge instanceof OccEdge) {
            const domain = wasm.Face.curveOnSurface(this.face, edge.edge);
            if (MathUtils.allEqualZero(domain.start, domain.end)) {
                return undefined;
            }
            return domain;
        }
        return undefined;
    }
}

export interface OccShellOptions {
    shape: TopoDS_Shell;
    id?: string;
}

@serializable({
    deserialize: occShapeDeserialize,
    serialize: occShapeSerialize,
})
export class OccShell extends OccShape implements IShell {
    constructor(options: OccShellOptions) {
        super(options);
    }
}

export interface OccSolidOptions {
    shape: TopoDS_Solid;
    id?: string;
}

@serializable({
    deserialize: occShapeDeserialize,
    serialize: occShapeSerialize,
})
export class OccSolid extends OccShape implements ISolid {
    readonly solid: TopoDS_Solid;

    constructor(options: OccSolidOptions) {
        super(options);
        this.solid = options.shape;
    }

    volume(): number {
        return wasm.Solid.volume(this.solid);
    }
}

export interface OccCompSolidOptions {
    shape: TopoDS_CompSolid;
    id?: string;
}

@serializable({
    deserialize: occShapeDeserialize,
    serialize: occShapeSerialize,
})
export class OccCompSolid extends OccShape implements ICompoundSolid {
    constructor(options: OccCompSolidOptions) {
        super(options);
    }
}

export interface OccCompoundOptions {
    shape: TopoDS_Compound;
    id?: string;
}

@serializable({
    deserialize: occShapeDeserialize,
    serialize: occShapeSerialize,
})
export class OccCompound extends OccShape implements ICompound {
    constructor(options: OccCompoundOptions) {
        super(options);
    }
}

export interface OccSubVertexShapeOptions {
    parent: IShape;
    shape: TopoDS_Vertex;
    index: number;
    id?: string;
}

export class OccSubVertexShape extends OccVertex implements ISubVertexShape {
    override get mesh(): IShapeMeshData {
        throw new Error("Method not implemented.");
    }

    readonly parent: IShape;
    readonly index: number;

    constructor(options: OccSubVertexShapeOptions) {
        super(options);
        this.parent = options.parent;
        this.index = options.index;
    }
}

export interface OccSubEdgeShapeOptions {
    parent: IShape;
    shape: TopoDS_Edge;
    index: number;
    id?: string;
}

export class OccSubEdgeShape extends OccEdge implements ISubEdgeShape {
    override get mesh(): IShapeMeshData {
        throw new Error("Method not implemented.");
    }

    readonly parent: IShape;
    readonly index: number;

    constructor(options: OccSubEdgeShapeOptions) {
        super(options);
        this.parent = options.parent;
        this.index = options.index;
    }
}

export interface OccSubFaceShapeOptions {
    parent: IShape;
    shape: TopoDS_Face;
    index: number;
    id?: string;
}

export class OccSubFaceShape extends OccFace implements ISubFaceShape {
    override get mesh(): IShapeMeshData {
        throw new Error("Method not implemented.");
    }

    readonly parent: IShape;
    readonly index: number;

    constructor(options: OccSubFaceShapeOptions) {
        super(options);
        this.parent = options.parent;
        this.index = options.index;
    }
}

export class Mesher implements IShapeMeshData, IDisposable {
    private _isMeshed = false;
    private _lines?: EdgeMeshData;
    private _faces?: FaceMeshData;
    private _points?: VertexMeshData;

    get edges(): EdgeMeshData | undefined {
        if (this._lines === undefined) {
            this.mesh();
        }
        return this._lines;
    }
    set edges(value: EdgeMeshData | undefined) {
        this._lines = value;
    }

    get faces(): FaceMeshData | undefined {
        if (this._faces === undefined) {
            this.mesh();
        }
        return this._faces;
    }
    set faces(value: FaceMeshData | undefined) {
        this._faces = value;
    }

    get vertexs(): VertexMeshData | undefined {
        if (this._points === undefined && this.shape instanceof OccVertex) {
            const point = this.shape.point();
            this._points = {
                position: new Float32Array(point.toArray()),
                color: VisualConfig.defaultEdgeColor,
                range: [
                    {
                        start: 0,
                        count: 1,
                        shape: new OccSubVertexShape({
                            parent: this.shape,
                            shape: this.shape.shape,
                            index: 0,
                        }),
                    },
                ],
                size: 3,
            };
        }
        return this._points;
    }
    set vertexs(value: VertexMeshData | undefined) {
        this._points = value;
    }

    constructor(private shape: OccShape) {}

    private mesh() {
        if (this._isMeshed) {
            return;
        }
        this._isMeshed = true;

        gc((c) => {
            const occMesher = c(new wasm.Mesher(this.shape.shape, 0.005, true));
            const meshData = c(occMesher.mesh());
            const faceMeshData = c(meshData.faceMeshData);
            const edgeMeshData = c(meshData.edgeMeshData);

            this._faces = this.parseFaceMeshData(faceMeshData);
            this._lines = this.parseEdgeMeshData(edgeMeshData);
        });
    }

    private parseFaceMeshData(faceMeshData: OccFaceMeshData): FaceMeshData {
        return {
            position: new Float32Array(faceMeshData.position),
            normal: new Float32Array(faceMeshData.normal),
            uv: new Float32Array(faceMeshData.uv),
            index: new Uint32Array(faceMeshData.index),
            range: this.getFaceRanges(faceMeshData),
            color: VisualConfig.defaultFaceColor,
            groups: [],
        };
    }

    private parseEdgeMeshData(edgeMeshData: OccEdgeMeshData): EdgeMeshData {
        return {
            lineType: "solid",
            position: new Float32Array(edgeMeshData.position),
            range: this.getEdgeRanges(edgeMeshData),
            color: VisualConfig.defaultEdgeColor,
        };
    }

    dispose(): void {
        this._faces?.range.forEach((g) => g.shape.dispose());
        this._lines?.range.forEach((g) => g.shape.dispose());

        this.shape = null as any;
        this._faces = null as any;
        this._lines = null as any;
    }

    private getEdgeRanges(data: OccEdgeMeshData): ShapeMeshRange[] {
        const result: ShapeMeshRange[] = [];
        for (let i = 0; i < data.edges.length; i++) {
            result.push({
                start: data.group[2 * i],
                count: data.group[2 * i + 1],
                shape: new OccSubEdgeShape({ parent: this.shape, shape: data.edges[i], index: i }),
            });
        }
        return result;
    }

    private getFaceRanges(data: OccFaceMeshData): ShapeMeshRange[] {
        const result: ShapeMeshRange[] = [];
        for (let i = 0; i < data.faces.length; i++) {
            result.push({
                start: data.group[2 * i],
                count: data.group[2 * i + 1],
                shape: new OccSubFaceShape({ parent: this.shape, shape: data.faces[i], index: i }),
            });
        }
        return result;
    }
}
