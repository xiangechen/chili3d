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

type EmbindString = ArrayBuffer | Uint8Array | Uint8ClampedArray | Int8Array | string;
export interface ShapeNode {
    name: EmbindString;
    shape: TopoDS_Shape | undefined;
    color: EmbindString | undefined;
    getChildren(): Array<ShapeNode>;
    delete(): void;
}

export interface Converter {
    delete(): void;
}

export interface ShapeResult {
    isOk: boolean;
    error: EmbindString;
    shape: TopoDS_Shape;
    delete(): void;
}

export interface ShapeFactory {
    delete(): void;
}

export interface Curve {
    delete(): void;
}

export type SurfaceBounds = {
    u1: number;
    u2: number;
    v1: number;
    v2: number;
};

export interface Surface {
    delete(): void;
}

export interface FaceMesher {
    getFaceSize(): number;
    getFace(_0: number): TopoDS_Face;
    getPosition(): Array<number>;
    getNormal(): Array<number>;
    getUV(): Array<number>;
    getIndex(): Array<number>;
    getGroups(): Array<number>;
    getFaces(): Array<TopoDS_Face>;
    delete(): void;
}

export interface EdgeMesher {
    getEdgeSize(): number;
    getEdge(_0: number): TopoDS_Edge;
    getPosition(): Array<number>;
    getGroups(): Array<number>;
    getEdges(): Array<TopoDS_Edge>;
    delete(): void;
}

export interface GeomAbs_ShapeValue<T extends number> {
    value: T;
}
export type GeomAbs_Shape =
    | GeomAbs_ShapeValue<0>
    | GeomAbs_ShapeValue<2>
    | GeomAbs_ShapeValue<4>
    | GeomAbs_ShapeValue<5>
    | GeomAbs_ShapeValue<6>
    | GeomAbs_ShapeValue<1>
    | GeomAbs_ShapeValue<3>;

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
    getRefCount(): number;
    delete(): void;
}

export interface Geom_Geometry extends Standard_Transient {
    copy(): Handle_Geom_Geometry;
    delete(): void;
}

export interface Geom_Curve extends Geom_Geometry {
    isClosed(): boolean;
    isPeriodic(): boolean;
    period(): number;
    reverse(): void;
    isCN(_0: number): boolean;
    firstParameter(): number;
    lastParameter(): number;
    continutity(): GeomAbs_Shape;
    reversed(): Handle_Geom_Curve;
    d0(_0: number, _1: gp_Pnt): void;
    value(_0: number): gp_Pnt;
    d1(_0: number, _1: gp_Pnt, _2: gp_Vec): void;
    d2(_0: number, _1: gp_Pnt, _2: gp_Vec, _3: gp_Vec): void;
    d3(_0: number, _1: gp_Pnt, _2: gp_Vec, _3: gp_Vec, _4: gp_Vec): void;
    dn(_0: number, _1: number): gp_Vec;
    delete(): void;
}

export interface Geom_Conic extends Geom_Curve {
    eccentricity(): number;
    location(): gp_Pnt;
    setLocation(_0: gp_Pnt): void;
    location(): gp_Pnt;
    setLocation(_0: gp_Pnt): void;
    location(): gp_Pnt;
    setLocation(_0: gp_Pnt): void;
    axis(): gp_Ax1;
    xAxis(): gp_Ax1;
    yAxis(): gp_Ax1;
    delete(): void;
}

export interface Geom_Circle extends Geom_Conic {
    radius(): number;
    setRadius(_0: number): void;
    delete(): void;
}

export interface Geom_Ellipse extends Geom_Conic {
    majorRadius(): number;
    minorRadius(): number;
    setMajorRadius(_0: number): void;
    setMinorRadius(_0: number): void;
    focus1(): gp_Pnt;
    focus2(): gp_Pnt;
    delete(): void;
}

export interface Geom_Hyperbola extends Geom_Conic {
    majorRadius(): number;
    minorRadius(): number;
    setMajorRadius(_0: number): void;
    setMinorRadius(_0: number): void;
    focal(): number;
    focus1(): gp_Pnt;
    focus2(): gp_Pnt;
    delete(): void;
}

export interface Geom_Parabola extends Geom_Conic {
    focal(): number;
    setFocal(_0: number): void;
    focus(): gp_Pnt;
    directrix(): gp_Ax1;
    delete(): void;
}

export interface Geom_BoundedCurve extends Geom_Curve {
    startPoint(): gp_Pnt;
    endPoint(): gp_Pnt;
    delete(): void;
}

export interface Geom_Line extends Geom_Curve {
    setLocation(_0: gp_Pnt): void;
    setDirection(_0: gp_Dir): void;
    position(): gp_Ax1;
    setPosition(_0: gp_Ax1): void;
    delete(): void;
}

export interface Geom_TrimmedCurve extends Geom_BoundedCurve {
    setTrim(_0: number, _1: number, _2: boolean, _3: boolean): void;
    basisCurve(): Handle_Geom_Curve;
    delete(): void;
}

export interface Geom_OffsetCurve extends Geom_Curve {
    offset(): number;
    basisCurve(): Handle_Geom_Curve;
    direction(): gp_Dir;
    delete(): void;
}

export interface Geom_BezierCurve extends Geom_BoundedCurve {
    degree(): number;
    weight(_0: number): number;
    setWeight(_0: number, _1: number): void;
    nbPoles(): number;
    removePole(_0: number): void;
    insertPoleAfter(_0: number, _1: gp_Pnt): void;
    insertPoleAfterWithWeight(_0: number, _1: gp_Pnt, _2: number): void;
    insertPoleBefore(_0: number, _1: gp_Pnt): void;
    insertPoleBeforeWithWeight(_0: number, _1: gp_Pnt, _2: number): void;
    pole(_0: number): gp_Pnt;
    setPole(_0: number, _1: gp_Pnt): void;
    setPoleWithWeight(_0: number, _1: gp_Pnt, _2: number): void;
    getPoles(): TColgp_Array1OfPnt;
    setPoles(_0: TColgp_Array1OfPnt): void;
    delete(): void;
}

export interface Geom_BSplineCurve extends Geom_BoundedCurve {
    insertKnot(_0: number, _1: number, _2: number, _3: boolean): void;
    degree(): number;
    nbPoles(): number;
    nbKnots(): number;
    knot(_0: number): number;
    setKnot(_0: number, _1: number): void;
    weight(_0: number): number;
    setWeight(_0: number, _1: number): void;
    pole(_0: number): gp_Pnt;
    setPole(_0: number, _1: gp_Pnt): void;
    setPoleWithWeight(_0: number, _1: gp_Pnt, _2: number): void;
    getPoles(): TColgp_Array1OfPnt;
    setPoles(_0: TColgp_Array1OfPnt): void;
    delete(): void;
}

export interface Geom_Surface extends Geom_Geometry {
    continuity(): GeomAbs_Shape;
    uPeriod(): number;
    vPeriod(): number;
    isUClosed(): boolean;
    isVClosed(): boolean;
    isUPeriodic(): boolean;
    isVPeriodic(): boolean;
    isCNu(_0: number): boolean;
    isCNv(_0: number): boolean;
    uIso(_0: number): Handle_Geom_Curve;
    vIso(_0: number): Handle_Geom_Curve;
    d0(_0: number, _1: number, _2: gp_Pnt): void;
    value(_0: number, _1: number): gp_Pnt;
    d1(_0: number, _1: number, _2: gp_Pnt, _3: gp_Vec, _4: gp_Vec): void;
    d2(_0: number, _1: number, _2: gp_Pnt, _3: gp_Vec, _4: gp_Vec, _5: gp_Vec, _6: gp_Vec, _7: gp_Vec): void;
    d3(
        _0: number,
        _1: number,
        _2: gp_Pnt,
        _3: gp_Vec,
        _4: gp_Vec,
        _5: gp_Vec,
        _6: gp_Vec,
        _7: gp_Vec,
        _8: gp_Vec,
        _9: gp_Vec,
        _10: gp_Vec,
        _11: gp_Vec,
    ): void;
    dn(_0: number, _1: number, _2: number, _3: number): gp_Vec;
    delete(): void;
}

export interface GeomPlate_Surface extends Geom_Surface {
    setBounds(_0: number, _1: number, _2: number, _3: number): void;
    delete(): void;
}

export interface Geom_ElementarySurface extends Geom_Surface {
    setLocation(_0: gp_Pnt): void;
    location(): gp_Pnt;
    setAxis(_0: gp_Ax1): void;
    axis(): gp_Ax1;
    position(): gp_Ax3;
    setPosition(_0: gp_Ax3): void;
    delete(): void;
}

export interface Geom_OffsetSurface extends Geom_Surface {
    offset(): number;
    setOffsetValue(_0: number): void;
    basisSurface(): Handle_Geom_Surface;
    setBasisSurface(_0: Handle_Geom_Surface, _1: boolean): void;
    delete(): void;
}

export interface Geom_SweptSurface extends Geom_Surface {
    basisCurve(): Handle_Geom_Curve;
    direction(): gp_Dir;
    direction(): gp_Dir;
    direction(): gp_Dir;
    delete(): void;
}

export interface ShapeExtend_CompositeSurface extends Geom_Surface {
    delete(): void;
}

export interface Geom_BSplineSurface extends Geom_Surface {
    delete(): void;
}

export interface Geom_BezierSurface extends Geom_Surface {
    delete(): void;
}

export interface Geom_BoundedSurface extends Geom_Surface {
    delete(): void;
}

export interface Geom_RectangularTrimmedSurface extends Geom_BoundedSurface {
    setTrim(_0: number, _1: number, _2: number, _3: number, _4: boolean, _5: boolean): void;
    setTrim2(_0: number, _1: number, _2: boolean, _3: boolean): void;
    basisSurface(): Handle_Geom_Surface;
    delete(): void;
}

export interface Geom_ConicalSurface extends Geom_ElementarySurface {
    semiAngle(): number;
    setSemiAngle(_0: number): void;
    setRadius(_0: number): void;
    refRadius(): number;
    apex(): gp_Pnt;
    delete(): void;
}

export interface Geom_CylindricalSurface extends Geom_ElementarySurface {
    radius(): number;
    setRadius(_0: number): void;
    delete(): void;
}

export interface Geom_Plane extends Geom_ElementarySurface {
    pln(): gp_Pln;
    setPln(_0: gp_Pln): void;
    delete(): void;
}

export interface Geom_SphericalSurface extends Geom_ElementarySurface {
    radius(): number;
    setRadius(_0: number): void;
    area(): number;
    volume(): number;
    delete(): void;
}

export interface Geom_ToroidalSurface extends Geom_ElementarySurface {
    majorRadius(): number;
    minorRadius(): number;
    setMajorRadius(_0: number): void;
    setMinorRadius(_0: number): void;
    area(): number;
    volume(): number;
    delete(): void;
}

export interface Geom_SurfaceOfLinearExtrusion extends Geom_SweptSurface {
    setBasisCurve(_0: Handle_Geom_Curve): void;
    setDirection(_0: gp_Dir): void;
    delete(): void;
}

export interface Geom_SurfaceOfRevolution extends Geom_SweptSurface {
    setBasisCurve(_0: Handle_Geom_Curve): void;
    location(): gp_Pnt;
    setLocation(_0: gp_Pnt): void;
    setDirection(_0: gp_Dir): void;
    referencePlane(): gp_Ax2;
    delete(): void;
}

export interface Handle_Standard_Transient {
    get(): Standard_Transient | null;
    isNull(): boolean;
    delete(): void;
}

export interface Handle_Geom_Geometry {
    get(): Geom_Geometry | null;
    isNull(): boolean;
    delete(): void;
}

export interface Handle_Geom_Curve {
    get(): Geom_Curve | null;
    isNull(): boolean;
    delete(): void;
}

export interface Handle_Geom_Line {
    get(): Geom_Line | null;
    isNull(): boolean;
    delete(): void;
}

export interface Handle_Geom_TrimmedCurve {
    get(): Geom_TrimmedCurve | null;
    isNull(): boolean;
    delete(): void;
}

export interface Handle_Geom_Surface {
    get(): Geom_Surface | null;
    isNull(): boolean;
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

export interface gp_Pln {
    readonly location: gp_Pnt;
    readonly position: gp_Ax3;
    readonly axis: gp_Ax1;
    readonly xAxis: gp_Ax1;
    readonly yAxis: gp_Ax1;
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

export interface TopLoc_Location {
    transformation(): gp_Trsf;
    inverted(): TopLoc_Location;
    delete(): void;
}

export interface TopoDS {
    delete(): void;
}

export interface TopoDS_Shape {
    infinite(): boolean;
    isEqual(_0: TopoDS_Shape): boolean;
    isNull(): boolean;
    isPartner(_0: TopoDS_Shape): boolean;
    isSame(_0: TopoDS_Shape): boolean;
    getLocation(): TopLoc_Location;
    setLocation(_0: TopLoc_Location, _1: boolean): void;
    nbChildren(): number;
    nullify(): void;
    orientation(): TopAbs_Orientation;
    reverse(): void;
    reversed(): TopoDS_Shape;
    shapeType(): TopAbs_ShapeEnum;
    delete(): void;
}

export interface TColgp_Array1OfPnt {
    value(_0: number): gp_Pnt;
    setValue(_0: number, _1: gp_Pnt): void;
    length(): number;
    delete(): void;
}

export interface TopoDS_Vertex extends TopoDS_Shape {
    delete(): void;
}

export interface TopoDS_Edge extends TopoDS_Shape {
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

export interface Shape {
    delete(): void;
}

export interface Vertex {
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

export type Domain = {
    start: number;
    end: number;
};

export type UV = {
    u: number;
    v: number;
};

export type Vector3 = {
    x: number;
    y: number;
    z: number;
};

export type ProjectPointResult = {
    point: Vector3;
    distance: number;
    parameter: number;
};

export type ExtremaCCResult = {
    distance: number;
    p1: Vector3;
    p2: Vector3;
    isParallel: boolean;
    u1: number;
    u2: number;
};

export type PointAndParameter = {
    point: Vector3;
    parameter: number;
};

export type Ax1 = {
    location: Vector3;
    direction: Vector3;
};

export type Ax2 = {
    location: Vector3;
    direction: Vector3;
    xDirection: Vector3;
};

export type Ax3 = {
    location: Vector3;
    direction: Vector3;
    xDirection: Vector3;
};

export interface Transient {
    delete(): void;
}

interface EmbindModule {
    ShapeNode: {};
    Converter: {
        convertToBrep(_0: TopoDS_Shape): string;
        convertFromBrep(_0: EmbindString): TopoDS_Shape;
        convertFromStep(_0: Uint8Array): ShapeNode | undefined;
        convertFromIges(_0: Uint8Array): ShapeNode | undefined;
        convertToStep(_0: Array<TopoDS_Shape>): string;
        convertToIges(_0: Array<TopoDS_Shape>): string;
    };
    ShapeResult: {};
    ShapeFactory: {
        makeThickSolidBySimple(_0: TopoDS_Shape, _1: number): ShapeResult;
        sweep(_0: TopoDS_Shape, _1: TopoDS_Wire): ShapeResult;
        polygon(_0: Array<Vector3>): ShapeResult;
        bezier(_0: Array<Vector3>, _1: Array<number>): ShapeResult;
        makeThickSolidByJoin(_0: TopoDS_Shape, _1: Array<TopoDS_Shape>, _2: number): ShapeResult;
        booleanCommon(_0: Array<TopoDS_Shape>, _1: Array<TopoDS_Shape>): ShapeResult;
        booleanCut(_0: Array<TopoDS_Shape>, _1: Array<TopoDS_Shape>): ShapeResult;
        booleanFuse(_0: Array<TopoDS_Shape>, _1: Array<TopoDS_Shape>): ShapeResult;
        combine(_0: Array<TopoDS_Shape>): ShapeResult;
        wire(_0: Array<TopoDS_Edge>): ShapeResult;
        face(_0: Array<TopoDS_Wire>): ShapeResult;
        prism(_0: TopoDS_Shape, _1: Vector3): ShapeResult;
        circle(_0: Vector3, _1: Vector3, _2: number): ShapeResult;
        arc(_0: Vector3, _1: Vector3, _2: Vector3, _3: number): ShapeResult;
        point(_0: Vector3): ShapeResult;
        line(_0: Vector3, _1: Vector3): ShapeResult;
        revolve(_0: TopoDS_Shape, _1: Ax1, _2: number): ShapeResult;
        box(_0: Ax3, _1: number, _2: number, _3: number): ShapeResult;
        rect(_0: Ax3, _1: number, _2: number): ShapeResult;
    };
    Curve: {
        curveLength(_0: Geom_Curve | null): number;
        trim(_0: Geom_Curve | null, _1: number, _2: number): Handle_Geom_TrimmedCurve;
        uniformAbscissaWithCount(_0: Geom_Curve | null, _1: number): Array<Vector3>;
        uniformAbscissaWithLength(_0: Geom_Curve | null, _1: number): Array<Vector3>;
        nearestExtremaCC(_0: Geom_Curve | null, _1: Geom_Curve | null): ExtremaCCResult | undefined;
        makeLine(_0: Vector3, _1: Vector3): Handle_Geom_Line;
        projectOrNearest(_0: Geom_Curve | null, _1: Vector3): ProjectPointResult;
        parameter(_0: Geom_Curve | null, _1: Vector3, _2: number): number | undefined;
        projects(_0: Geom_Curve | null, _1: Vector3): Array<Vector3>;
    };
    Surface: {
        isPlanar(_0: Geom_Surface | null): boolean;
        bounds(_0: Geom_Surface | null): SurfaceBounds;
        projectCurve(_0: Geom_Surface | null, _1: Geom_Curve | null): Handle_Geom_Curve;
        projectPoint(_0: Geom_Surface | null, _1: Vector3): Array<Vector3>;
        parameters(_0: Geom_Surface | null, _1: Vector3, _2: number): UV | undefined;
        nearestPoint(_0: Geom_Surface | null, _1: Vector3): PointAndParameter | undefined;
    };
    FaceMesher: { new (_0: TopoDS_Shape, _1: number): FaceMesher };
    EdgeMesher: { new (_0: TopoDS_Shape, _1: number): EdgeMesher };
    GeomAbs_Shape: {
        GeomAbs_C0: GeomAbs_ShapeValue<0>;
        GeomAbs_C1: GeomAbs_ShapeValue<2>;
        GeomAbs_C2: GeomAbs_ShapeValue<4>;
        GeomAbs_C3: GeomAbs_ShapeValue<5>;
        GeomAbs_CN: GeomAbs_ShapeValue<6>;
        GeomAbs_G1: GeomAbs_ShapeValue<1>;
        GeomAbs_G2: GeomAbs_ShapeValue<3>;
    };
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
    Geom_Conic: {};
    Geom_Circle: {};
    Geom_Ellipse: {};
    Geom_Hyperbola: {};
    Geom_Parabola: {};
    Geom_BoundedCurve: {};
    Geom_Line: {};
    Geom_TrimmedCurve: {};
    Geom_OffsetCurve: {};
    Geom_BezierCurve: {};
    Geom_BSplineCurve: {};
    Geom_Surface: {};
    GeomPlate_Surface: {};
    Geom_ElementarySurface: {};
    Geom_OffsetSurface: {};
    Geom_SweptSurface: {};
    ShapeExtend_CompositeSurface: {};
    Geom_BSplineSurface: {};
    Geom_BezierSurface: {};
    Geom_BoundedSurface: {};
    Geom_RectangularTrimmedSurface: {};
    Geom_ConicalSurface: {};
    Geom_CylindricalSurface: {};
    Geom_Plane: {};
    Geom_SphericalSurface: {};
    Geom_ToroidalSurface: {};
    Geom_SurfaceOfLinearExtrusion: {};
    Geom_SurfaceOfRevolution: {};
    Handle_Standard_Transient: { new (_0: Standard_Transient | null): Handle_Standard_Transient };
    Handle_Geom_Geometry: { new (_0: Geom_Geometry | null): Handle_Geom_Geometry };
    Handle_Geom_Curve: { new (_0: Geom_Curve | null): Handle_Geom_Curve };
    Handle_Geom_Line: { new (_0: Geom_Line | null): Handle_Geom_Line };
    Handle_Geom_TrimmedCurve: { new (_0: Geom_TrimmedCurve | null): Handle_Geom_TrimmedCurve };
    Handle_Geom_Surface: { new (_0: Geom_Surface | null): Handle_Geom_Surface };
    gp_Pnt: { new (_0: number, _1: number, _2: number): gp_Pnt };
    gp_Vec: { new (_0: number, _1: number, _2: number): gp_Vec };
    gp_Dir: { new (_0: number, _1: number, _2: number): gp_Dir };
    gp_Ax1: { new (_0: gp_Pnt, _1: gp_Dir): gp_Ax1 };
    gp_Ax2: { new (_0: gp_Pnt, _1: gp_Dir): gp_Ax2; new (_0: gp_Pnt, _1: gp_Dir, _2: gp_Dir): gp_Ax2 };
    gp_Ax3: { new (_0: gp_Pnt, _1: gp_Dir, _2: gp_Dir): gp_Ax3; new (_0: gp_Ax2): gp_Ax3 };
    gp_Pln: { new (_0: gp_Ax3): gp_Pln; new (_0: gp_Pnt, _1: gp_Dir): gp_Pln };
    gp_Trsf: { new (): gp_Trsf };
    TopLoc_Location: { new (_0: gp_Trsf): TopLoc_Location };
    TopoDS: {
        vertex(_0: TopoDS_Shape): TopoDS_Vertex;
        edge(_0: TopoDS_Shape): TopoDS_Edge;
        wire(_0: TopoDS_Shape): TopoDS_Wire;
        face(_0: TopoDS_Shape): TopoDS_Face;
        shell(_0: TopoDS_Shape): TopoDS_Shell;
        solid(_0: TopoDS_Shape): TopoDS_Solid;
        compound(_0: TopoDS_Shape): TopoDS_Compound;
        compsolid(_0: TopoDS_Shape): TopoDS_CompSolid;
    };
    TopoDS_Shape: {};
    boundingBoxRatio(_0: TopoDS_Shape, _1: number): number;
    TColgp_Array1OfPnt: { new (_0: number, _1: number): TColgp_Array1OfPnt };
    TopoDS_Vertex: {};
    TopoDS_Edge: {};
    TopoDS_Wire: {};
    TopoDS_Face: {};
    TopoDS_Shell: {};
    TopoDS_Solid: {};
    TopoDS_Compound: {};
    TopoDS_CompSolid: {};
    Shape: {
        sectionSS(_0: TopoDS_Shape, _1: TopoDS_Shape): TopoDS_Shape;
        isClosed(_0: TopoDS_Shape): boolean;
        findAncestor(_0: TopoDS_Shape, _1: TopoDS_Shape, _2: TopAbs_ShapeEnum): Array<TopoDS_Shape>;
        findSubShapes(_0: TopoDS_Shape, _1: TopAbs_ShapeEnum): Array<TopoDS_Shape>;
        splitByEdgeOrWires(_0: TopoDS_Shape, _1: Array<TopoDS_Shape>): TopoDS_Shape;
        sectionSP(_0: TopoDS_Shape, _1: Ax3): TopoDS_Shape;
    };
    Vertex: { point(_0: TopoDS_Vertex): Vector3 };
    Edge: {
        fromCurve(_0: Geom_Curve | null): TopoDS_Edge;
        curve(_0: TopoDS_Edge): Handle_Geom_TrimmedCurve;
        curveLength(_0: TopoDS_Edge): number;
        trim(_0: TopoDS_Edge, _1: number, _2: number): TopoDS_Edge;
        offset(_0: TopoDS_Edge, _1: gp_Dir, _2: number): TopoDS_Edge;
        intersect(_0: TopoDS_Edge, _1: TopoDS_Edge): Array<PointAndParameter>;
    };
    Wire: {
        offset(_0: TopoDS_Wire, _1: number, _2: GeomAbs_JoinType): TopoDS_Shape;
        makeFace(_0: TopoDS_Wire): TopoDS_Face;
    };
    Face: {
        offset(_0: TopoDS_Face, _1: number, _2: GeomAbs_JoinType): TopoDS_Shape;
        outerWire(_0: TopoDS_Face): TopoDS_Wire;
        surface(_0: TopoDS_Face): Handle_Geom_Surface;
        normal(_0: TopoDS_Face, _1: number, _2: number, _3: gp_Pnt, _4: gp_Vec): void;
        curveOnSurface(_0: TopoDS_Face, _1: TopoDS_Edge): Domain;
    };
    Transient: {
        isKind(_0: Standard_Transient | null, _1: EmbindString): boolean;
        isInstance(_0: Standard_Transient | null, _1: EmbindString): boolean;
    };
}

export type MainModule = WasmModule & typeof RuntimeExports & EmbindModule;
export default function MainModuleFactory(options?: unknown): Promise<MainModule>;
