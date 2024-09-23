// TypeScript bindings for emscripten-generated code.  Automatically generated at compile time.
declare namespace RuntimeExports {
    let HEAPF32: any;
    let HEAPF64: any;
    let HEAP_DATA_VIEW: any;
    let HEAP8: any;
    let HEAPU8: any;
    let HEAP16: any;
    let HEAPU16: any;
    let HEAP32: any;
    let HEAPU32: any;
    let HEAP64: any;
    let HEAPU64: any;
}
interface WasmModule {}

export interface FaceMesher {
    getFaceSize(): number;
    getFace(_0: number): TopoDS_Face;
    getIndex(): Uint32Array;
    getGroups(): Uint32Array;
    getPosition(): Float32Array;
    getNormal(): Float32Array;
    getUV(): Float32Array;
    getFaces(): Array<TopoDS_Face>;
    delete(): void;
}

export interface EdgeMesher {
    getEdgeSize(): number;
    getEdge(_0: number): TopoDS_Edge;
    getGroups(): Uint32Array;
    getPosition(): Float32Array;
    getEdges(): Array<TopoDS_Edge>;
    delete(): void;
}

export interface GeomAbs_JoinTypeValue<T extends number> {
    value: T;
}
export type GeomAbs_JoinType =
    | GeomAbs_JoinTypeValue<0>
    | GeomAbs_JoinTypeValue<2>
    | GeomAbs_JoinTypeValue<1>;

export interface TopAbs_ShapeEnumValue<T extends number> {
    value: T;
}
export type TopAbs_ShapeEnum =
    | TopAbs_ShapeEnumValue<7>
    | TopAbs_ShapeEnumValue<6>
    | TopAbs_ShapeEnumValue<5>
    | TopAbs_ShapeEnumValue<4>
    | TopAbs_ShapeEnumValue<3>
    | TopAbs_ShapeEnumValue<2>
    | TopAbs_ShapeEnumValue<0>
    | TopAbs_ShapeEnumValue<1>
    | TopAbs_ShapeEnumValue<8>;

export interface TopAbs_OrientationValue<T extends number> {
    value: T;
}
export type TopAbs_Orientation =
    | TopAbs_OrientationValue<0>
    | TopAbs_OrientationValue<1>
    | TopAbs_OrientationValue<2>
    | TopAbs_OrientationValue<3>;

export interface Standard_Transient {
    delete(): void;
}

export interface Geom_Geometry extends Standard_Transient {
    delete(): void;
}

export interface Geom_Curve extends Geom_Geometry {
    isClosed(): boolean;
    isPeriodic(): boolean;
    period(): number;
    reverse(): void;
    firstParameter(): number;
    lastParameter(): number;
    value(_0: number): gp_Pnt;
    d1(_0: number, _1: gp_Pnt, _2: gp_Vec): void;
    d2(_0: number, _1: gp_Pnt, _2: gp_Vec, _3: gp_Vec): void;
    d3(_0: number, _1: gp_Pnt, _2: gp_Vec, _3: gp_Vec, _4: gp_Vec): void;
    d4(_0: number, _1: number): gp_Vec;
    delete(): void;
}

export interface Geom_TrimmedCurve extends Geom_Curve {
    delete(): void;
}

export interface Geom_Surface extends Geom_Geometry {
    delete(): void;
}

export interface Handle_Geom_Curve {
    isNull(): boolean;
    get(): Geom_Curve | null;
    delete(): void;
}

export interface gp_Pnt {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    delete(): void;
}

export interface gp_Vec {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    delete(): void;
}

export interface gp_Dir {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    delete(): void;
}

export interface gp_Ax1 {
    readonly location: gp_Pnt;
    readonly direction: gp_Dir;
    delete(): void;
}

export interface gp_Ax2 {
    readonly location: gp_Pnt;
    readonly direction: gp_Dir;
    readonly xDirection: gp_Dir;
    readonly yDirection: gp_Dir;
    delete(): void;
}

export interface gp_Ax3 {
    readonly location: gp_Pnt;
    readonly direction: gp_Dir;
    readonly xDirection: gp_Dir;
    readonly yDirection: gp_Dir;
    readonly direct: boolean;
    delete(): void;
}

export interface gp_Trsf {
    value(_0: number, _1: number): number;
    setValues(
        _0: number,
        _1: number,
        _2: number,
        _3: number,
        _4: number,
        _5: number,
        _6: number,
        _7: number,
        _8: number,
        _9: number,
        _10: number,
        _11: number,
    ): void;
    delete(): void;
}

export interface gp_Pln {
    location(): gp_Pnt;
    position(): gp_Ax3;
    delete(): void;
}

export interface TopLoc_Location {
    transformation(): gp_Trsf;
    inverted(): TopLoc_Location;
    delete(): void;
}

export interface TopoDS_Shape {
    infinite(): boolean;
    isEqual(_0: TopoDS_Shape): boolean;
    isNull(): boolean;
    isPartner(_0: TopoDS_Shape): boolean;
    isSame(_0: TopoDS_Shape): boolean;
    setLocation(): TopLoc_Location;
    getLocation(_0: TopLoc_Location, _1: boolean): void;
    nbChildren(): number;
    nullify(): void;
    orientation(): TopAbs_Orientation;
    reverse(): void;
    reversed(): TopoDS_Shape;
    shapeType(): TopAbs_ShapeEnum;
    delete(): void;
}

export interface TopoDS_Vertex extends TopoDS_Shape {
    delete(): void;
}

export interface TopoDS_Edge extends TopoDS_Shape {
    length(): number;
    delete(): void;
}

export interface TopoDS_Wire extends TopoDS_Shape {
    delete(): void;
}

export interface TopoDS_Face extends TopoDS_Shape {
    delete(): void;
}

export interface TopoDS_Shell extends TopoDS_Shape {
    delete(): void;
}

export interface TopoDS_Solid extends TopoDS_Shape {
    delete(): void;
}

export interface TopoDS_Compound extends TopoDS_Shape {
    delete(): void;
}

export interface TopoDS_CompSolid extends TopoDS_Shape {
    delete(): void;
}

export interface BRep_Tool {
    delete(): void;
}

export interface Shape {
    delete(): void;
}

export interface EdgeIntersectResult {
    parameters: Array<number>;
    points: Array<gp_Pnt>;
    delete(): void;
}

export interface Edge {
    delete(): void;
}

export interface Wire {
    delete(): void;
}

export interface Face {
    delete(): void;
}

export interface ShapeFactory {
    delete(): void;
}

export type Domain = {};

interface EmbindModule {
    FaceMesher: { new (_0: TopoDS_Shape, _1: number): FaceMesher };
    EdgeMesher: { new (_0: TopoDS_Shape, _1: number): EdgeMesher };
    GeomAbs_JoinType: {
        GeomAbs_Arc: GeomAbs_JoinTypeValue<0>;
        GeomAbs_Intersection: GeomAbs_JoinTypeValue<2>;
        GeomAbs_Tangent: GeomAbs_JoinTypeValue<1>;
    };
    TopAbs_ShapeEnum: {
        TopAbs_VERTEX: TopAbs_ShapeEnumValue<7>;
        TopAbs_EDGE: TopAbs_ShapeEnumValue<6>;
        TopAbs_WIRE: TopAbs_ShapeEnumValue<5>;
        TopAbs_FACE: TopAbs_ShapeEnumValue<4>;
        TopAbs_SHELL: TopAbs_ShapeEnumValue<3>;
        TopAbs_SOLID: TopAbs_ShapeEnumValue<2>;
        TopAbs_COMPOUND: TopAbs_ShapeEnumValue<0>;
        TopAbs_COMPSOLID: TopAbs_ShapeEnumValue<1>;
        TopAbs_SHAPE: TopAbs_ShapeEnumValue<8>;
    };
    TopAbs_Orientation: {
        TopAbs_FORWARD: TopAbs_OrientationValue<0>;
        TopAbs_REVERSED: TopAbs_OrientationValue<1>;
        TopAbs_INTERNAL: TopAbs_OrientationValue<2>;
        TopAbs_EXTERNAL: TopAbs_OrientationValue<3>;
    };
    Standard_Transient: {};
    Geom_Geometry: {};
    Geom_Curve: {};
    Geom_TrimmedCurve: {};
    Geom_Surface: {};
    Handle_Geom_Curve: {};
    gp_Pnt: { new (_0: number, _1: number, _2: number): gp_Pnt };
    gp_Vec: { new (_0: number, _1: number, _2: number): gp_Vec };
    gp_Dir: { new (_0: number, _1: number, _2: number): gp_Dir };
    gp_Ax1: { new (_0: gp_Pnt, _1: gp_Dir): gp_Ax1 };
    gp_Ax2: { new (_0: gp_Pnt, _1: gp_Dir): gp_Ax2; new (_0: gp_Pnt, _1: gp_Dir, _2: gp_Dir): gp_Ax2 };
    gp_Ax3: { new (_0: gp_Pnt, _1: gp_Dir, _2: gp_Dir): gp_Ax3; new (_0: gp_Ax2): gp_Ax3 };
    gp_Trsf: { new (): gp_Trsf };
    gp_Pln: { new (_0: gp_Ax3): gp_Pln };
    TopLoc_Location: { new (_0: gp_Trsf): TopLoc_Location };
    TopoDS_Shape: {};
    TopoDS_Vertex: {};
    TopoDS_Edge: {};
    TopoDS_Wire: {};
    TopoDS_Face: {};
    TopoDS_Shell: {};
    TopoDS_Solid: {};
    TopoDS_Compound: {};
    TopoDS_CompSolid: {};
    BRep_Tool: { pnt(_0: TopoDS_Vertex): gp_Pnt };
    Shape: {
        sectionSS(_0: TopoDS_Shape, _1: TopoDS_Shape): TopoDS_Shape;
        sectionSP(_0: TopoDS_Shape, _1: gp_Pln): TopoDS_Shape;
        isClosed(_0: TopoDS_Shape): boolean;
        findAncestor(_0: TopoDS_Shape, _1: TopoDS_Shape, _2: TopAbs_ShapeEnum): Array<TopoDS_Shape>;
        findSubShapes(_0: TopoDS_Shape, _1: TopAbs_ShapeEnum): Array<TopoDS_Shape>;
    };
    EdgeIntersectResult: {};
    Edge: {
        curve(_0: TopoDS_Edge): Geom_TrimmedCurve;
        trim(_0: TopoDS_Edge, _1: number, _2: number): TopoDS_Edge;
        intersect(_0: TopoDS_Edge, _1: TopoDS_Edge): EdgeIntersectResult;
        offset(_0: TopoDS_Edge, _1: gp_Dir, _2: number): TopoDS_Edge;
    };
    Wire: { offset(_0: TopoDS_Wire, _1: number, _2: GeomAbs_JoinType): TopoDS_Shape };
    Face: { offset(_0: TopoDS_Face, _1: number, _2: GeomAbs_JoinType): TopoDS_Shape };
    ShapeFactory: { makeBox(_0: gp_Ax2, _1: number, _2: number, _3: number): TopoDS_Shape };
}

export type MainModule = WasmModule & typeof RuntimeExports & EmbindModule;
export default function MainModuleFactory(options?: unknown): Promise<MainModule>;
