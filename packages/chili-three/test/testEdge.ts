import {
    Entity,
    I18n,
    ICurve,
    IDocument,
    IEdge,
    IShape,
    IShapeMesh,
    IVertex,
    Quaternion,
    Ray,
    Result,
    ShapeType,
    XYZ,
} from "chili-core";

export class TestEdge implements IEdge {
    constructor(readonly start: XYZ, readonly end: XYZ) {}

    intersect(other: IEdge | Ray): XYZ[] {
        return [];
    }
    length(): number {
        return this.start.distanceTo(this.end);
    }
    asCurve(): Result<ICurve, string> {
        return Result.error("this");
    }
    get id(): string {
        return "testEdge";
    }
    shapeType: ShapeType = ShapeType.Edge;
    setTranslation(offset: XYZ): void {}
    setScale(scale: XYZ, value: number): void {}
    setRotation(rotation: Quaternion): void {}
    mesh(): IShapeMesh {
        return {
            vertexs: [],
            edges: [
                {
                    renderData: {
                        vertexs: [
                            this.start.x,
                            this.start.y,
                            this.start.z,
                            this.end.x,
                            this.end.y,
                            this.end.z,
                        ],
                        type: "edge",
                    },
                    edge: this,
                },
            ],
            faces: [],
        };
    }
    toJson(): string {
        return "json";
    }
    isEqual(other: IShape): boolean {
        if (other instanceof TestEdge) {
            return this.start.isEqualTo(other.start) && this.end.isEqualTo(other.end);
        }
        return false;
    }
}

export class TestBody extends Entity {
    name: keyof I18n = "body.line";
    constructor(document: IDocument, readonly start: XYZ, readonly end: XYZ) {
        super(document);
    }

    protected generateShape(): Result<IShape> {
        return Result.ok(new TestEdge(this.start, this.end));
    }
}
