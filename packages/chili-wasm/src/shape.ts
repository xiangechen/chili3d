import {
    gc,
    ICompound,
    ICompoundSolid,
    ICurve,
    Id,
    IEdge,
    IFace,
    IShape,
    IShapeMeshData,
    IShell,
    ISolid,
    ISurface,
    ITrimmedCurve,
    IVertex,
    IWire,
    JoinType,
    MathUtils,
    Matrix4,
    Orientation,
    Plane,
    Ray,
    Result,
    SerializedProperties,
    Serializer,
    ShapeType,
    XYZ,
} from "chili-core";
import { TopoDS_Edge, TopoDS_Face, TopoDS_Shape, TopoDS_Vertex, TopoDS_Wire } from "../lib/chili-wasm";
import { OccShapeConverter } from "./converter";
import { OccCurve, OccTrimmedCurve } from "./curve";
import { OcctHelper } from "./helper";
import { Mesher } from "./mesher";

@Serializer.register(["shape", "id"], OccShape.deserialize, OccShape.serialize)
export class OccShape implements IShape {
    static serialize(target: OccShape): SerializedProperties<OccShape> {
        return {
            shape: new OccShapeConverter().convertToBrep(target).value,
            id: target.id,
        };
    }

    static deserialize(shape: string, id: string) {
        let tshape = new OccShapeConverter().convertFromBrep(shape).value as OccShape;
        tshape._id = id;
        return tshape;
    }

    readonly shapeType: ShapeType;
    protected _mesh: IShapeMeshData | undefined;
    get mesh(): IShapeMeshData {
        if (!this._mesh) {
            this._mesh = new Mesher(this);
        }
        return this._mesh;
    }

    protected _shape: TopoDS_Shape;
    get shape(): TopoDS_Shape {
        return this._shape;
    }

    protected _id: string;
    get id(): string {
        return this._id;
    }

    get matrix(): Matrix4 {
        return OcctHelper.convertToMatrix(this.shape.getLocation().transformation());
    }

    set matrix(matrix: Matrix4) {
        gc((c) => {
            let location = new wasm.TopLoc_Location(OcctHelper.convertFromMatrix(matrix));
            this._shape.setLocation(location, false);
            this._mesh?.updateMeshShape();
        });
    }

    constructor(shape: TopoDS_Shape, id?: string) {
        this._id = id ?? Id.generate();
        this._shape = shape;
        this.shapeType = OcctHelper.getShapeType(shape);
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

    section(shape: IShape | Plane): IShape {
        if (shape instanceof OccShape) {
            let section = wasm.Shape.sectionSS(this.shape, shape.shape);
            return OcctHelper.wrapShape(section);
        }
        if (shape instanceof Plane) {
            let section = wasm.Shape.sectionSP(this.shape, {
                location: shape.origin,
                direction: shape.normal,
                xDirection: shape.xvec,
            });
            return OcctHelper.wrapShape(section);
        }

        throw new Error("Unsupported type");
    }

    split(edges: (IEdge | IWire)[]): IShape {
        let shapes = edges.map((x) => {
            if (x instanceof OccShape) {
                return x.shape;
            }
            throw new Error("Unsupported type");
        });
        return OcctHelper.wrapShape(wasm.Shape.splitByEdgeOrWires(this.shape, shapes));
    }

    reserve(): void {
        this.shape.reverse();
    }

    dispose(): void {
        this._shape.delete();
        this._shape = null as any;
    }
}

@Serializer.register(["shape", "id"], OccShape.deserialize, OccShape.serialize)
export class OccVertex extends OccShape implements IVertex {
    readonly vertex: TopoDS_Vertex;

    constructor(shape: TopoDS_Vertex, id?: string) {
        super(shape, id);
        this.vertex = shape;
    }
}

@Serializer.register(["shape", "id"], OccShape.deserialize, OccShape.serialize)
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
            let edge: TopoDS_Edge | undefined = undefined;
            if (other instanceof OccEdge) {
                edge = other.edge;
            }
            if (other instanceof Ray) {
                let line = c(wasm.Curve.makeLine(other.location, other.direction));
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

    curve(): ITrimmedCurve {
        return gc((c) => {
            let curve = c(wasm.Edge.curve(this.edge));
            return new OccTrimmedCurve(curve.get()!);
        });
    }

    offset(distance: number, dir: XYZ): Result<IEdge> {
        return gc((c) => {
            let occDir = c(OcctHelper.toDir(dir));
            let edge = wasm.Edge.offset(this.edge, occDir, distance);
            if (edge.isNull()) {
                return Result.err("Offset failed");
            }
            return Result.ok(OcctHelper.wrapShape(edge));
        });
    }

    trim(start: number, end: number): IEdge {
        let newEdge = wasm.Edge.trim(this.edge, start, end);
        return new OccEdge(newEdge);
    }
}

@Serializer.register(["shape", "id"], OccShape.deserialize, OccShape.serialize)
export class OccWire extends OccShape implements IWire {
    constructor(
        readonly wire: TopoDS_Wire,
        id?: string,
    ) {
        super(wire, id);
    }

    toFace(): Result<IFace> {
        let face = wasm.Wire.makeFace(this.wire);
        if (face.isNull()) {
            return Result.err("To face failed");
        }
        return Result.ok(new OccFace(face));
    }

    offset(distance: number, joinType: JoinType): Result<IShape> {
        let offseted = wasm.Wire.offset(this.wire, distance, OcctHelper.getJoinType(joinType));
        if (offseted.isNull()) {
            return Result.err("Offset failed");
        }
        return Result.ok(OcctHelper.wrapShape(offseted));
    }
}

@Serializer.register(["shape", "id"], OccShape.deserialize, OccShape.serialize)
export class OccFace extends OccShape implements IFace {
    constructor(
        readonly face: TopoDS_Face,
        id?: string,
    ) {
        super(face, id);
    }
    normal(u: number, v: number): [point: XYZ, normal: XYZ] {
        return gc((c) => {
            let pnt = c(new wasm.gp_Pnt(0, 0, 0));
            let normal = c(new wasm.gp_Vec(0, 0, 0));
            wasm.Face.normal(this.shape, u, v, pnt, normal);
            return [OcctHelper.toXYZ(pnt), OcctHelper.toXYZ(normal)];
        });
    }
    outerWire(): IWire {
        return new OccWire(wasm.Face.outerWire(this.face));
    }
    surface(): ISurface {
        return gc((c) => {
            let handleSurface = c(wasm.Face.surface(this.face));
            return OcctHelper.wrapSurface(handleSurface.get()!);
        });
    }
    segmentsOfEdgeOnFace(edge: IEdge): undefined | { start: number; end: number } {
        if (edge instanceof OccEdge) {
            let domain = wasm.Face.curveOnSurface(this.face, edge.edge);
            if (MathUtils.allEqualZero(domain.start, domain.end)) {
                return undefined;
            }
            return domain;
        }
        return undefined;
    }
}

@Serializer.register(["shape", "id"], OccShape.deserialize, OccShape.serialize)
export class OccShell extends OccShape implements IShell {}

@Serializer.register(["shape", "id"], OccShape.deserialize, OccShape.serialize)
export class OccSolid extends OccShape implements ISolid {}

@Serializer.register(["shape", "id"], OccShape.deserialize, OccShape.serialize)
export class OccCompSolid extends OccShape implements ICompoundSolid {}

@Serializer.register(["shape", "id"], OccShape.deserialize, OccShape.serialize)
export class OccCompound extends OccShape implements ICompound {}
