// TypeScript bindings for emscripten-generated code.  Automatically generated at compile time.
interface WasmModule {}

type EmbindString = ArrayBuffer | Uint8Array | Uint8ClampedArray | Int8Array | string;
export interface ClassHandle {
    isAliasOf(other: ClassHandle): boolean;
    delete(): void;
    deleteLater(): this;
    isDeleted(): boolean;
    clone(): this;
}
export interface ShapeNode extends ClassHandle {
    get name(): string;
    set name(value: EmbindString);
    shape: TopoDS_Shape | undefined;
    color: EmbindString | undefined;
    getChildren(): Array<ShapeNode>;
}

export interface Converter extends ClassHandle {}

export interface ShapeResult extends ClassHandle {
    isOk: boolean;
    get error(): string;
    set error(value: EmbindString);
    shape: TopoDS_Shape;
}

export interface ShapeFactory extends ClassHandle {}

export interface Curve extends ClassHandle {}

export type SurfaceBounds = {
    u1: number;
    u2: number;
    v1: number;
    v2: number;
};

export interface Surface extends ClassHandle {}

export interface Mesher extends ClassHandle {
    mesh(): MeshData;
    edgesMeshPosition(): Array<number>;
}

export interface EdgeMeshData extends ClassHandle {
    position: Array<number>;
    group: Array<number>;
    edges: Array<TopoDS_Edge>;
}

export interface FaceMeshData extends ClassHandle {
    position: Array<number>;
    normal: Array<number>;
    uv: Array<number>;
    index: Array<number>;
    group: Array<number>;
    faces: Array<TopoDS_Face>;
}

export interface MeshData extends ClassHandle {
    edgeMeshData: EdgeMeshData;
    faceMeshData: FaceMeshData;
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

export interface Standard_Transient extends ClassHandle {
    getRefCount(): number;
}

export interface Geom_Geometry extends Standard_Transient {
    copy(): Handle_Geom_Geometry;
    transform(_0: gp_Trsf): void;
    transformed(_0: gp_Trsf): Handle_Geom_Geometry;
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
}

export interface Geom_Circle extends Geom_Conic {
    radius(): number;
    setRadius(_0: number): void;
}

export interface Geom_Ellipse extends Geom_Conic {
    majorRadius(): number;
    minorRadius(): number;
    setMajorRadius(_0: number): void;
    setMinorRadius(_0: number): void;
    focus1(): gp_Pnt;
    focus2(): gp_Pnt;
}

export interface Geom_Hyperbola extends Geom_Conic {
    majorRadius(): number;
    minorRadius(): number;
    setMajorRadius(_0: number): void;
    setMinorRadius(_0: number): void;
    focal(): number;
    focus1(): gp_Pnt;
    focus2(): gp_Pnt;
}

export interface Geom_Parabola extends Geom_Conic {
    focal(): number;
    setFocal(_0: number): void;
    focus(): gp_Pnt;
    directrix(): gp_Ax1;
}

export interface Geom_BoundedCurve extends Geom_Curve {
    startPoint(): gp_Pnt;
    endPoint(): gp_Pnt;
}

export interface Geom_Line extends Geom_Curve {
    setLocation(_0: gp_Pnt): void;
    setDirection(_0: gp_Dir): void;
    position(): gp_Ax1;
    setPosition(_0: gp_Ax1): void;
}

export interface Geom_TrimmedCurve extends Geom_BoundedCurve {
    setTrim(_0: number, _1: number, _2: boolean, _3: boolean): void;
    basisCurve(): Handle_Geom_Curve;
}

export interface Geom_OffsetCurve extends Geom_Curve {
    offset(): number;
    basisCurve(): Handle_Geom_Curve;
    direction(): gp_Dir;
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
}

export interface GeomPlate_Surface extends Geom_Surface {
    setBounds(_0: number, _1: number, _2: number, _3: number): void;
}

export interface Geom_ElementarySurface extends Geom_Surface {
    setLocation(_0: gp_Pnt): void;
    location(): gp_Pnt;
    setAxis(_0: gp_Ax1): void;
    axis(): gp_Ax1;
    position(): gp_Ax3;
    setPosition(_0: gp_Ax3): void;
}

export interface Geom_OffsetSurface extends Geom_Surface {
    offset(): number;
    setOffsetValue(_0: number): void;
    basisSurface(): Handle_Geom_Surface;
    setBasisSurface(_0: Handle_Geom_Surface, _1: boolean): void;
}

export interface Geom_SweptSurface extends Geom_Surface {
    basisCurve(): Handle_Geom_Curve;
    direction(): gp_Dir;
    direction(): gp_Dir;
    direction(): gp_Dir;
}

export interface ShapeExtend_CompositeSurface extends Geom_Surface {}

export interface Geom_BSplineSurface extends Geom_Surface {}

export interface Geom_BezierSurface extends Geom_Surface {}

export interface Geom_BoundedSurface extends Geom_Surface {}

export interface Geom_RectangularTrimmedSurface extends Geom_BoundedSurface {
    setTrim(_0: number, _1: number, _2: number, _3: number, _4: boolean, _5: boolean): void;
    setTrim2(_0: number, _1: number, _2: boolean, _3: boolean): void;
    basisSurface(): Handle_Geom_Surface;
}

export interface Geom_ConicalSurface extends Geom_ElementarySurface {
    semiAngle(): number;
    setSemiAngle(_0: number): void;
    setRadius(_0: number): void;
    refRadius(): number;
    apex(): gp_Pnt;
}

export interface Geom_CylindricalSurface extends Geom_ElementarySurface {
    radius(): number;
    setRadius(_0: number): void;
}

export interface Geom_Plane extends Geom_ElementarySurface {
    pln(): gp_Pln;
    setPln(_0: gp_Pln): void;
}

export interface Geom_SphericalSurface extends Geom_ElementarySurface {
    radius(): number;
    setRadius(_0: number): void;
    area(): number;
    volume(): number;
}

export interface Geom_ToroidalSurface extends Geom_ElementarySurface {
    majorRadius(): number;
    minorRadius(): number;
    setMajorRadius(_0: number): void;
    setMinorRadius(_0: number): void;
    area(): number;
    volume(): number;
}

export interface Geom_SurfaceOfLinearExtrusion extends Geom_SweptSurface {
    setBasisCurve(_0: Handle_Geom_Curve): void;
    setDirection(_0: gp_Dir): void;
}

export interface Geom_SurfaceOfRevolution extends Geom_SweptSurface {
    setBasisCurve(_0: Handle_Geom_Curve): void;
    location(): gp_Pnt;
    setLocation(_0: gp_Pnt): void;
    setDirection(_0: gp_Dir): void;
    referencePlane(): gp_Ax2;
}

export interface Handle_Standard_Transient extends ClassHandle {
    get(): Standard_Transient | null;
    isNull(): boolean;
}

export interface Handle_Geom_Geometry extends ClassHandle {
    get(): Geom_Geometry | null;
    isNull(): boolean;
}

export interface Handle_Geom_Curve extends ClassHandle {
    get(): Geom_Curve | null;
    isNull(): boolean;
}

export interface Handle_Geom_Line extends ClassHandle {
    get(): Geom_Line | null;
    isNull(): boolean;
}

export interface Handle_Geom_TrimmedCurve extends ClassHandle {
    get(): Geom_TrimmedCurve | null;
    isNull(): boolean;
}

export interface Handle_Geom_Surface extends ClassHandle {
    get(): Geom_Surface | null;
    isNull(): boolean;
}

export interface gp_Pnt extends ClassHandle {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}

export interface gp_Vec extends ClassHandle {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}

export interface gp_Dir extends ClassHandle {
    readonly x: number;
    readonly y: number;
    readonly z: number;
}

export interface gp_Ax1 extends ClassHandle {
    location(): gp_Pnt;
    direction(): gp_Dir;
}

export interface gp_Ax2 extends ClassHandle {
    location(): gp_Pnt;
    direction(): gp_Dir;
    xDirection(): gp_Dir;
    yDirection(): gp_Dir;
}

export interface gp_Ax3 extends ClassHandle {
    location(): gp_Pnt;
    direction(): gp_Dir;
    xDirection(): gp_Dir;
    yDirection(): gp_Dir;
    direct(): boolean;
}

export interface gp_Pln extends ClassHandle {
    location(): gp_Pnt;
    position(): gp_Ax3;
    axis(): gp_Ax1;
    xAxis(): gp_Ax1;
    yAxis(): gp_Ax1;
}

export interface gp_Trsf extends ClassHandle {
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
}

export interface TopLoc_Location extends ClassHandle {
    transformation(): gp_Trsf;
    inverted(): TopLoc_Location;
}

export interface TopoDS extends ClassHandle {}

export interface TopoDS_Shape extends ClassHandle {
    infinite(): boolean;
    isEqual(_0: TopoDS_Shape): boolean;
    isNull(): boolean;
    isPartner(_0: TopoDS_Shape): boolean;
    isSame(_0: TopoDS_Shape): boolean;
    getLocation(): TopLoc_Location;
    setLocation(_0: TopLoc_Location, _1: boolean): void;
    nbChildren(): number;
    nullify(): void;
    getOrientation(): TopAbs_Orientation;
    setOrientation(_0: TopAbs_Orientation): void;
    reverse(): void;
    reversed(): TopoDS_Shape;
    shapeType(): TopAbs_ShapeEnum;
    located(_0: TopLoc_Location, _1: boolean): TopoDS_Shape;
    move(_0: TopLoc_Location, _1: boolean): void;
    moved(_0: TopLoc_Location, _1: boolean): TopoDS_Shape;
}

export interface TColgp_Array1OfPnt extends ClassHandle {
    value(_0: number): gp_Pnt;
    setValue(_0: number, _1: gp_Pnt): void;
    length(): number;
}

export interface TopoDS_Vertex extends TopoDS_Shape {}

export interface TopoDS_Edge extends TopoDS_Shape {}

export interface TopoDS_Wire extends TopoDS_Shape {}

export interface TopoDS_Face extends TopoDS_Shape {}

export interface TopoDS_Shell extends TopoDS_Shape {}

export interface TopoDS_Solid extends TopoDS_Shape {}

export interface TopoDS_Compound extends TopoDS_Shape {}

export interface TopoDS_CompSolid extends TopoDS_Shape {}

export interface Shape extends ClassHandle {}

export interface Vertex extends ClassHandle {}

export interface Edge extends ClassHandle {}

export interface Wire extends ClassHandle {}

export interface Face extends ClassHandle {}

export interface Solid extends ClassHandle {}

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

export type Pln = {
    location: Vector3;
    direction: Vector3;
    xDirection: Vector3;
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

export interface Transient extends ClassHandle {}

interface EmbindModule {
    ShapeNode: {};
    Converter: {
        convertToBrep(_0: TopoDS_Shape): string;
        convertFromBrep(_0: EmbindString): TopoDS_Shape;
        convertFromStep(_0: Uint8Array): ShapeNode | undefined;
        convertFromIges(_0: Uint8Array): ShapeNode | undefined;
        convertFromStl(_0: Uint8Array): ShapeNode | undefined;
        convertToStep(_0: Array<TopoDS_Shape>): string;
        convertToIges(_0: Array<TopoDS_Shape>): string;
    };
    ShapeResult: {};
    ShapeFactory: {
        makeThickSolidBySimple(_0: TopoDS_Shape, _1: number): ShapeResult;
        polygon(_0: Array<Vector3>): ShapeResult;
        bezier(_0: Array<Vector3>, _1: Array<number>): ShapeResult;
        fillet(_0: TopoDS_Shape, _1: Array<number>, _2: number): ShapeResult;
        chamfer(_0: TopoDS_Shape, _1: Array<number>, _2: number): ShapeResult;
        sweep(_0: Array<TopoDS_Shape>, _1: TopoDS_Wire, _2: boolean, _3: boolean): ShapeResult;
        makeThickSolidByJoin(_0: TopoDS_Shape, _1: Array<TopoDS_Shape>, _2: number): ShapeResult;
        booleanCommon(_0: Array<TopoDS_Shape>, _1: Array<TopoDS_Shape>): ShapeResult;
        booleanCut(_0: Array<TopoDS_Shape>, _1: Array<TopoDS_Shape>): ShapeResult;
        booleanFuse(_0: Array<TopoDS_Shape>, _1: Array<TopoDS_Shape>): ShapeResult;
        combine(_0: Array<TopoDS_Shape>): ShapeResult;
        wire(_0: Array<TopoDS_Edge>): ShapeResult;
        shell(_0: Array<TopoDS_Face>): ShapeResult;
        face(_0: Array<TopoDS_Wire>): ShapeResult;
        solid(_0: Array<TopoDS_Shell>): ShapeResult;
        cone(_0: Vector3, _1: Vector3, _2: number, _3: number, _4: number): ShapeResult;
        sphere(_0: Vector3, _1: number): ShapeResult;
        ellipsoid(_0: Vector3, _1: Vector3, _2: Vector3, _3: number, _4: number, _5: number): ShapeResult;
        ellipse(_0: Vector3, _1: Vector3, _2: Vector3, _3: number, _4: number): ShapeResult;
        cylinder(_0: Vector3, _1: Vector3, _2: number, _3: number): ShapeResult;
        prism(_0: TopoDS_Shape, _1: Vector3): ShapeResult;
        circle(_0: Vector3, _1: Vector3, _2: number): ShapeResult;
        arc(_0: Vector3, _1: Vector3, _2: Vector3, _3: number): ShapeResult;
        point(_0: Vector3): ShapeResult;
        line(_0: Vector3, _1: Vector3): ShapeResult;
        revolve(_0: TopoDS_Shape, _1: Ax1, _2: number): ShapeResult;
        box(_0: Pln, _1: number, _2: number, _3: number): ShapeResult;
        pyramid(_0: Pln, _1: number, _2: number, _3: number): ShapeResult;
        rect(_0: Pln, _1: number, _2: number): ShapeResult;
    };
    Curve: {
        curveLength(_0: Geom_Curve | null): number;
        trim(_0: Geom_Curve | null, _1: number, _2: number): Handle_Geom_TrimmedCurve;
        uniformAbscissaWithCount(_0: Geom_Curve | null, _1: number): Array<Vector3>;
        uniformAbscissaWithLength(_0: Geom_Curve | null, _1: number): Array<Vector3>;
        makeLine(_0: Vector3, _1: Vector3): Handle_Geom_Line;
        parameter(_0: Geom_Curve | null, _1: Vector3, _2: number): number | undefined;
        projects(_0: Geom_Curve | null, _1: Vector3): Array<Vector3>;
        projectOrNearest(_0: Geom_Curve | null, _1: Vector3): ProjectPointResult;
        nearestExtremaCC(_0: Geom_Curve | null, _1: Geom_Curve | null): ExtremaCCResult | undefined;
    };
    Surface: {
        isPlanar(_0: Geom_Surface | null): boolean;
        bounds(_0: Geom_Surface | null): SurfaceBounds;
        projectCurve(_0: Geom_Surface | null, _1: Geom_Curve | null): Handle_Geom_Curve;
        projectPoint(_0: Geom_Surface | null, _1: Vector3): Array<Vector3>;
        parameters(_0: Geom_Surface | null, _1: Vector3, _2: number): UV | undefined;
        nearestPoint(_0: Geom_Surface | null, _1: Vector3): PointAndParameter | undefined;
    };
    Mesher: {
        new (_0: TopoDS_Shape, _1: number): Mesher;
    };
    EdgeMeshData: {};
    FaceMeshData: {};
    MeshData: {};
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
    Handle_Standard_Transient: {
        new (_0: Standard_Transient | null): Handle_Standard_Transient;
    };
    Handle_Geom_Geometry: {
        new (_0: Geom_Geometry | null): Handle_Geom_Geometry;
    };
    Handle_Geom_Curve: {
        new (_0: Geom_Curve | null): Handle_Geom_Curve;
    };
    Handle_Geom_Line: {
        new (_0: Geom_Line | null): Handle_Geom_Line;
    };
    Handle_Geom_TrimmedCurve: {
        new (_0: Geom_TrimmedCurve | null): Handle_Geom_TrimmedCurve;
    };
    Handle_Geom_Surface: {
        new (_0: Geom_Surface | null): Handle_Geom_Surface;
    };
    gp_Pnt: {
        new (_0: number, _1: number, _2: number): gp_Pnt;
    };
    gp_Vec: {
        new (_0: number, _1: number, _2: number): gp_Vec;
    };
    gp_Dir: {
        new (_0: number, _1: number, _2: number): gp_Dir;
    };
    gp_Ax1: {
        new (_0: gp_Pnt, _1: gp_Dir): gp_Ax1;
    };
    gp_Ax2: {
        new (_0: gp_Pnt, _1: gp_Dir): gp_Ax2;
        new (_0: gp_Pnt, _1: gp_Dir, _2: gp_Dir): gp_Ax2;
    };
    gp_Ax3: {
        new (_0: gp_Pnt, _1: gp_Dir, _2: gp_Dir): gp_Ax3;
        new (_0: gp_Ax2): gp_Ax3;
    };
    gp_Pln: {
        new (_0: gp_Ax3): gp_Pln;
        new (_0: gp_Pnt, _1: gp_Dir): gp_Pln;
    };
    gp_Trsf: {
        new (): gp_Trsf;
    };
    TopLoc_Location: {
        new (_0: gp_Trsf): TopLoc_Location;
    };
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
    TColgp_Array1OfPnt: {
        new (_0: number, _1: number): TColgp_Array1OfPnt;
    };
    TopoDS_Vertex: {};
    TopoDS_Edge: {};
    TopoDS_Wire: {};
    TopoDS_Face: {};
    TopoDS_Shell: {};
    TopoDS_Solid: {};
    TopoDS_Compound: {};
    TopoDS_CompSolid: {};
    Shape: {
        clone(_0: TopoDS_Shape): TopoDS_Shape;
        sectionSS(_0: TopoDS_Shape, _1: TopoDS_Shape): TopoDS_Shape;
        isClosed(_0: TopoDS_Shape): boolean;
        replaceSubShape(_0: TopoDS_Shape, _1: TopoDS_Shape, _2: TopoDS_Shape): TopoDS_Shape;
        sewing(_0: TopoDS_Shape, _1: TopoDS_Shape): TopoDS_Shape;
        findAncestor(_0: TopoDS_Shape, _1: TopoDS_Shape, _2: TopAbs_ShapeEnum): Array<TopoDS_Shape>;
        findSubShapes(_0: TopoDS_Shape, _1: TopAbs_ShapeEnum): Array<TopoDS_Shape>;
        iterShape(_0: TopoDS_Shape): Array<TopoDS_Shape>;
        splitByEdgeOrWires(_0: TopoDS_Shape, _1: Array<TopoDS_Shape>): TopoDS_Shape;
        removeFeature(_0: TopoDS_Shape, _1: Array<TopoDS_Shape>): TopoDS_Shape;
        removeSubShape(_0: TopoDS_Shape, _1: Array<TopoDS_Shape>): TopoDS_Shape;
        sectionSP(_0: TopoDS_Shape, _1: Pln): TopoDS_Shape;
    };
    Vertex: {
        point(_0: TopoDS_Vertex): Vector3;
    };
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
        edgeLoop(_0: TopoDS_Wire): Array<TopoDS_Edge>;
    };
    Face: {
        area(_0: TopoDS_Face): number;
        offset(_0: TopoDS_Face, _1: number, _2: GeomAbs_JoinType): TopoDS_Shape;
        outerWire(_0: TopoDS_Face): TopoDS_Wire;
        surface(_0: TopoDS_Face): Handle_Geom_Surface;
        normal(_0: TopoDS_Face, _1: number, _2: number, _3: gp_Pnt, _4: gp_Vec): void;
        curveOnSurface(_0: TopoDS_Face, _1: TopoDS_Edge): Domain;
    };
    Solid: {
        volume(_0: TopoDS_Solid): number;
    };
    Transient: {
        isKind(_0: Standard_Transient | null, _1: EmbindString): boolean;
        isInstance(_0: Standard_Transient | null, _1: EmbindString): boolean;
    };
}

export type MainModule = WasmModule & EmbindModule;
export default function MainModuleFactory(options?: unknown): Promise<MainModule>;
