// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    EdgeMeshData,
    I18nKeys,
    ICurve,
    IDocument,
    IEdge,
    IEqualityComparer,
    IShape,
    IShapeMeshData,
    ITrimmedCurve,
    IWire,
    LineType,
    Matrix4,
    Orientation,
    ParameterShapeNode,
    Plane,
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
    transformed(matrix: Matrix4): IShape {
        throw new Error("Method not implemented.");
    }
    transformedMul(matrix: Matrix4): IShape {
        throw new Error("Method not implemented.");
    }
    edgesMeshPosition(): EdgeMeshData {
        throw new Error("Method not implemented.");
    }
    clone(): IShape {
        throw new Error("Method not implemented.");
    }

    dispose(): void {
        throw new Error("Method not implemented.");
    }
    update(curve: ICurve): void {
        throw new Error("Method not implemented.");
    }
    trim(start: number, end: number): IEdge {
        throw new Error("Method not implemented.");
    }
    isClosed(): boolean {
        throw new Error("Method not implemented.");
    }
    isNull(): boolean {
        throw new Error("Method not implemented.");
    }
    reserve(): void {
        throw new Error("Method not implemented.");
    }
    section(shape: IShape | Plane): IShape {
        throw new Error("Method not implemented.");
    }
    split(edges: (IEdge | IWire)[]): IShape {
        throw new Error("Method not implemented.");
    }

    findAncestor(ancestorType: ShapeType, fromShape: IShape): IShape[] {
        throw new Error("Method not implemented.");
    }

    findSubShapes(subshapeType: ShapeType): IShape[] {
        throw new Error("Method not implemented.");
    }
    iterShape(): IShape[] {
        throw new Error("Method not implemented.");
    }
    offset(distance: number, dir: XYZ): Result<IEdge> {
        throw new Error("Method not implemented.");
    }

    intersect(other: IEdge | Ray) {
        return [];
    }
    length(): number {
        return this.start.distanceTo(this.end);
    }
    get curve(): ITrimmedCurve {
        throw new Error("Method not implemented.");
    }
    get id(): string {
        return "testEdge";
    }
    shapeType: ShapeType = ShapeType.Edge;
    matrix: Matrix4 = Matrix4.identity();
    get mesh(): IShapeMeshData {
        return {
            edges: {
                position: new Float32Array([
                    this.start.x,
                    this.start.y,
                    this.start.z,
                    this.end.x,
                    this.end.y,
                    this.end.z,
                ]),
                color: 0xff0000,
                lineType: LineType.Solid,
                range: [],
            },
            faces: undefined,
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

export class TestNode extends ParameterShapeNode {
    override display(): I18nKeys {
        return "body.line";
    }
    constructor(
        document: IDocument,
        readonly start: XYZ,
        readonly end: XYZ,
    ) {
        super(document);
    }

    protected override setProperty<K extends keyof this>(
        property: K,
        newValue: this[K],
        onPropertyChanged?: ((property: K, oldValue: this[K]) => void) | undefined,
        equals?: IEqualityComparer<this[K]> | undefined,
    ): boolean {
        this.setPrivateValue(property, newValue);
        return true;
    }

    generateShape(): Result<IShape> {
        return Result.ok(new TestEdge(this.start, this.end));
    }
}
