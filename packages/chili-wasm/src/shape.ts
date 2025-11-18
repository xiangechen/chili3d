// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type EdgeMeshData,
    gc,
    type ICompound,
    type ICompoundSolid,
    type ICurve,
    IDisposable,
    Id,
    type IEdge,
    type IFace,
    type IShape,
    type IShapeMeshData,
    type IShell,
    type ISolid,
    type ISubEdgeShape,
    type ISubFaceShape,
    type ISurface,
    type ITrimmedCurve,
    type IVertex,
    type IWire,
    type JoinType,
    LineType,
    Logger,
    MathUtils,
    type Matrix4,
    type Orientation,
    Plane,
    Ray,
    Result,
    type SerializedProperties,
    Serializer,
    type ShapeType,
    VisualConfig,
    type XYZ,
    type XYZLike,
} from "chili-core";
import type {
    TopoDS_Edge,
    TopoDS_Face,
    TopoDS_Shape,
    TopoDS_Solid,
    TopoDS_Vertex,
    TopoDS_Wire,
} from "../lib/chili-wasm";
import { OccShapeConverter } from "./converter";
import { OccCurve, OccTrimmedCurve } from "./curve";
import { OcctHelper } from "./helper";
import { Mesher } from "./mesher";

function occShapeSerialize(target: OccShape): SerializedProperties<OccShape> {
    return {
        shape: new OccShapeConverter().convertToBrep(target).value,
        id: target.id,
    };
}

function occShapeDeserialize(shape: string, id: string) {
    const tshape = new OccShapeConverter().convertFromBrep(shape).value as OccShape;
    tshape.id = id;
    return tshape;
}

@Serializer.register(["shape", "id"], occShapeDeserialize, occShapeSerialize)
export class OccShape implements IShape {
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
            return OcctHelper.convertToMatrix(c(c(this.shape.getLocation()).transformation()));
        });
    }

    set matrix(matrix: Matrix4) {
        gc((c) => {
            const location = c(new wasm.TopLoc_Location(c(OcctHelper.convertFromMatrix(matrix))));
            this._shape.setLocation(location, false);
            this.onTransformChanged();
        });
    }

    constructor(shape: TopoDS_Shape, id?: string) {
        this.id = id ?? Id.generate();
        this._shape = shape;
        this.shapeType = OcctHelper.getShapeType(shape);
    }

    transformed(matrix: Matrix4): IShape {
        return gc((c) => {
            const location = c(new wasm.TopLoc_Location(c(OcctHelper.convertFromMatrix(matrix))));
            const shape = this._shape.located(location, false); // TODO: check if this is correct
            return OcctHelper.wrapShape(shape);
        });
    }

    transformedMul(matrix: Matrix4): IShape {
        return gc((c) => {
            const location = c(new wasm.TopLoc_Location(c(OcctHelper.convertFromMatrix(matrix))));
            const shape = this._shape.moved(location, false); // TODO: check if this is correct
            return OcctHelper.wrapShape(shape);
        });
    }

    protected onTransformChanged(): void {
        if (this._mesh) {
            Logger.warn("Shape matrix changed, mesh will be recreated");
            this._mesh = undefined;
        }
    }

    edgesMeshPosition(): EdgeMeshData {
        const occMesher = new wasm.Mesher(this.shape, 0.005);
        const position = occMesher.edgesMeshPosition();
        occMesher.delete();
        return {
            lineType: LineType.Solid,
            position: new Float32Array(position),
            range: [],
            color: VisualConfig.defaultEdgeColor,
        };
    }

    clone(): IShape {
        return OcctHelper.wrapShape(wasm.Shape.clone(this._shape));
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
        return OcctHelper.getOrientation(this.shape);
    }

    findAncestor(ancestorType: ShapeType, fromShape: IShape): IShape[] {
        if (fromShape instanceof OccShape) {
            return wasm.Shape.findAncestor(
                fromShape.shape,
                this.shape,
                OcctHelper.getShapeEnum(ancestorType),
            ).map((x) => OcctHelper.wrapShape(x));
        }
        return [];
    }

    findSubShapes(subshapeType: ShapeType): IShape[] {
        return wasm.Shape.findSubShapes(this.shape, OcctHelper.getShapeEnum(subshapeType)).map((x) =>
            OcctHelper.wrapShape(x),
        );
    }

    iterShape(): IShape[] {
        let subShape = wasm.Shape.iterShape(this.shape);
        if (subShape.length === 1 && subShape[0].shapeType() === this.shape.shapeType()) {
            subShape = wasm.Shape.iterShape(subShape[0]);
        }
        return subShape.map((x) => OcctHelper.wrapShape(x));
    }

    section(shape: IShape | Plane): IShape {
        if (shape instanceof OccShape) {
            const section = wasm.Shape.sectionSS(this.shape, shape.shape);
            return OcctHelper.wrapShape(section);
        }
        if (shape instanceof Plane) {
            const section = wasm.Shape.sectionSP(this.shape, {
                location: shape.origin,
                direction: shape.normal,
                xDirection: shape.xvec,
            });
            return OcctHelper.wrapShape(section);
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
        return OcctHelper.wrapShape(wasm.Shape.splitShapes([this.shape], occShapes));
    }

    reserve(): void {
        this.shape.reverse();
    }

    hlr(position: XYZLike, direction: XYZLike, xDir: XYZLike): IShape {
        return gc((c) => {
            const shape = wasm.Shape.hlr(
                this.shape,
                c(OcctHelper.toPnt(position)),
                c(OcctHelper.toDir(direction)),
                c(OcctHelper.toDir(xDir)),
            );
            return OcctHelper.wrapShape(shape);
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

        if (this._mesh && IDisposable.isDisposable(this._mesh)) {
            this._mesh.dispose();
            this._mesh = null as any;
        }
    }
}

@Serializer.register(["shape", "id"], occShapeDeserialize, occShapeSerialize)
export class OccVertex extends OccShape implements IVertex {
    readonly vertex: TopoDS_Vertex;

    constructor(shape: TopoDS_Vertex, id?: string) {
        super(shape, id);
        this.vertex = shape;
    }
}

@Serializer.register(["shape", "id"], occShapeDeserialize, occShapeSerialize)
export class OccEdge extends OccShape implements IEdge {
    private _edge: TopoDS_Edge;
    get edge(): TopoDS_Edge {
        return this._edge;
    }

    constructor(shape: TopoDS_Edge, id?: string) {
        super(shape, id);
        this._edge = shape;
    }

    update(curve: ICurve): void {
        if (!(curve instanceof OccCurve)) {
            throw new Error("Invalid curve");
        }
        this._shape = wasm.Edge.fromCurve(curve.curve);
        this._mesh = undefined;
    }

    intersect(other: IEdge | Ray): { parameter: number; point: XYZ }[] {
        return gc((c) => {
            let edge: TopoDS_Edge | undefined;
            if (other instanceof OccEdge) {
                edge = other.edge;
            }
            if (other instanceof Ray) {
                const line = c(wasm.Curve.makeLine(other.location, other.direction));
                edge = c(wasm.Edge.fromCurve(line.get()));
            }
            if (edge === undefined) {
                throw new Error("Unsupported type");
            }
            return wasm.Edge.intersect(this.edge, edge).map((x) => ({
                parameter: x.parameter,
                point: OcctHelper.toXYZ(x.point),
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
        return this._curve;
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
            const occDir = c(OcctHelper.toDir(dir));
            const edge = wasm.Edge.offset(this.edge, occDir, distance);
            if (edge.isNull()) {
                return Result.err("Offset failed");
            }
            return Result.ok(OcctHelper.wrapShape(edge));
        });
    }

    trim(start: number, end: number): IEdge {
        const newEdge = wasm.Edge.trim(this.edge, start, end);
        return new OccEdge(newEdge);
    }

    protected override disposeInternal(): void {
        super.disposeInternal();
        if (this._curve && IDisposable.isDisposable(this._curve)) {
            this._curve.dispose();
            this._curve = null as any;
        }
    }
}

@Serializer.register(["shape", "id"], occShapeDeserialize, occShapeSerialize)
export class OccWire extends OccShape implements IWire {
    constructor(
        readonly wire: TopoDS_Wire,
        id?: string,
    ) {
        super(wire, id);
    }

    edgeLoop(): IEdge[] {
        return wasm.Wire.edgeLoop(this.wire).map((x) => OcctHelper.wrapShape(x)) as IEdge[];
    }

    toFace(): Result<IFace> {
        const face = wasm.Wire.makeFace(this.wire);
        if (face.isNull()) {
            return Result.err("To face failed");
        }
        return Result.ok(new OccFace(face));
    }

    offset(distance: number, joinType: JoinType): Result<IShape> {
        const offseted = wasm.Wire.offset(this.wire, distance, OcctHelper.getJoinType(joinType));
        if (offseted.isNull()) {
            return Result.err("Offset failed");
        }
        return Result.ok(OcctHelper.wrapShape(offseted));
    }
}

@Serializer.register(["shape", "id"], occShapeDeserialize, occShapeSerialize)
export class OccFace extends OccShape implements IFace {
    constructor(
        readonly face: TopoDS_Face,
        id?: string,
    ) {
        super(face, id);
    }

    area(): number {
        return wasm.Face.area(this.face);
    }

    normal(u: number, v: number): [point: XYZ, normal: XYZ] {
        return gc((c) => {
            const pnt = c(new wasm.gp_Pnt(0, 0, 0));
            const normal = c(new wasm.gp_Vec(0, 0, 0));
            wasm.Face.normal(this.shape, u, v, pnt, normal);
            return [OcctHelper.toXYZ(pnt), OcctHelper.toXYZ(normal)];
        });
    }
    outerWire(): IWire {
        return new OccWire(wasm.Face.outerWire(this.face));
    }
    surface(): ISurface {
        return gc((c) => {
            const handleSurface = c(wasm.Face.surface(this.face));
            return OcctHelper.wrapSurface(handleSurface.get()!);
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

@Serializer.register(["shape", "id"], occShapeDeserialize, occShapeSerialize)
export class OccShell extends OccShape implements IShell {}

@Serializer.register(["shape", "id"], occShapeDeserialize, occShapeSerialize)
export class OccSolid extends OccShape implements ISolid {
    constructor(
        readonly solid: TopoDS_Solid,
        id?: string,
    ) {
        super(solid, id);
    }

    volume(): number {
        return wasm.Solid.volume(this.solid);
    }
}

@Serializer.register(["shape", "id"], occShapeDeserialize, occShapeSerialize)
export class OccCompSolid extends OccShape implements ICompoundSolid {}

@Serializer.register(["shape", "id"], occShapeDeserialize, occShapeSerialize)
export class OccCompound extends OccShape implements ICompound {}

export class OccSubEdgeShape extends OccEdge implements ISubEdgeShape {
    override get mesh(): IShapeMeshData {
        throw new Error("Method not implemented.");
    }

    constructor(
        readonly parent: IShape,
        edge: TopoDS_Edge,
        readonly index: number,
        id?: string,
    ) {
        super(edge, id);
    }
}

export class OccSubFaceShape extends OccFace implements ISubFaceShape {
    override get mesh(): IShapeMeshData {
        throw new Error("Method not implemented.");
    }

    constructor(
        readonly parent: IShape,
        face: TopoDS_Face,
        readonly index: number,
        id?: string,
    ) {
        super(face, id);
    }
}
