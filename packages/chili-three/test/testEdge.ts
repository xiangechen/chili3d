import {
    I18nKeys,
    ICurve,
    IDocument,
    IEdge,
    IShape,
    IShapeMeshData,
    LineType,
    Matrix4,
    Orientation,
    ParameterGeometry,
    Ray,
    Result,
    Serialized,
    ShapeType,
    XYZ,
} from "chili-core";

export class TestEdge implements IEdge {
    constructor(
        readonly start: XYZ,
        readonly end: XYZ,
    ) {}

    findAncestor(ancestorType: ShapeType, fromShape: IShape): IShape[] {
        throw new Error("Method not implemented.");
    }

    iterSubShapes(shapeType: ShapeType, unique: boolean): IterableIterator<IShape> {
        throw new Error("Method not implemented.");
    }

    findSubShapes(subshapeType: ShapeType): IShape[] {
        throw new Error("Method not implemented.");
    }
    offset(distance: number, dir: XYZ): Result<IEdge> {
        throw new Error("Method not implemented.");
    }

    intersect(other: IEdge | Ray): XYZ[] {
        return [];
    }
    length(): number {
        return this.start.distanceTo(this.end);
    }
    asCurve(): Result<ICurve, string> {
        return Result.err("this");
    }
    get id(): string {
        return "testEdge";
    }
    shapeType: ShapeType = ShapeType.Edge;
    matrix: Matrix4 = Matrix4.identity();
    get mesh(): IShapeMeshData {
        return {
            shape: this,
            edges: {
                positions: [this.start.x, this.start.y, this.start.z, this.end.x, this.end.y, this.end.z],
                color: 0xff0000,
                lineType: LineType.Solid,
                groups: [],
            },
            faces: undefined,
            updateMeshShape() {},
        };
    }
    serialize(): Serialized {
        return {
            classKey: "Shape",
            properties: {},
        };
    }
    orientation(): Orientation {
        return Orientation.FORWARD;
    }
    isPartner(other: IShape): boolean {
        return true;
    }
    isSame(other: IShape): boolean {
        return true;
    }
    isEqual(other: IShape): boolean {
        if (other instanceof TestEdge) {
            return this.start.isEqualTo(other.start) && this.end.isEqualTo(other.end);
        }
        return false;
    }
}

export class TestBody extends ParameterGeometry {
    display: I18nKeys = "body.line";
    constructor(
        document: IDocument,
        readonly start: XYZ,
        readonly end: XYZ,
    ) {
        super(document);
    }

    protected generateShape(): Result<IShape> {
        return Result.ok(new TestEdge(this.start, this.end));
    }
}
