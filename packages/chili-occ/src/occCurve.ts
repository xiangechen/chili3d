// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    Continuity,
    CurveType,
    IBSplineCurve,
    IBezierCurve,
    IBoundedCurve,
    ICircle,
    IConic,
    ICurve,
    IDisposable,
    IEdge,
    IEllipse,
    IGeometry,
    IHyperbola,
    ILine,
    IOffsetCurve,
    IParabola,
    ITrimmedCurve,
    Ray,
    XYZ,
    gc,
} from "chili-core";
import {
    GCPnts_UniformAbscissa,
    GeomAdaptor_Curve,
    Geom_BSplineCurve,
    Geom_BezierCurve,
    Geom_BoundedCurve,
    Geom_Circle,
    Geom_Conic,
    Geom_Curve,
    Geom_Ellipse,
    Geom_Hyperbola,
    Geom_Line,
    Geom_OffsetCurve,
    Geom_Parabola,
    Geom_TrimmedCurve,
} from "../occ-wasm/chili_occ";
import { OccGeometry } from "./occGeometry";
import { OccHelps } from "./occHelps";
import { OccEdge } from "./occShape";

export class OccCurve extends OccGeometry implements ICurve, IDisposable {
    readonly curveType: CurveType;

    constructor(readonly curve: Geom_Curve) {
        super(curve);
        this.curveType = OccHelps.getCurveType(curve);
    }

    override copy(): IGeometry {
        return OccHelps.wrapCurve(this.curve);
    }

    makeEdge(): IEdge {
        return gc((c) => {
            let curve = new occ.Handle_Geom_Curve_2(this.curve);
            let builder = c(new occ.BRepBuilderAPI_MakeEdge_24(curve));
            return new OccEdge(builder.Edge());
        });
    }

    nearestExtrema(curve: ICurve | Ray):
        | {
              isParallel: boolean;
              distance: number;
              p1: XYZ;
              p2: XYZ;
              u1: number;
              u2: number;
          }
        | undefined {
        return gc((c) => {
            if (curve instanceof Ray) {
                let pnt = c(OccHelps.toPnt(curve.location));
                let dir = c(OccHelps.toDir(curve.direction));
                curve = c(new OccLine(new occ.Geom_Line_3(pnt, dir)));
            } else if (!(curve instanceof OccCurve)) {
                throw new Error("nearestFromCurve: curve is not an OccCurve");
            }

            return this.nearestExtremaCurve(curve as OccCurve);
        });
    }

    private nearestExtremaCurve(curve: OccCurve) {
        return gc((c) => {
            let curve1 = new occ.Handle_Geom_Curve_2(this.curve);
            let curve2 = new occ.Handle_Geom_Curve_2(curve.curve);
            let cc = c(new occ.GeomAPI_ExtremaCurveCurve_2(curve1, curve2));
            if (cc.NbExtrema() === 0) {
                return undefined;
            }
            let distance = cc.LowerDistance();
            let isParallel = cc.IsParallel();
            let u1: any = { current: 0 };
            let u2: any = { current: 0 };
            let p1 = c(new occ.gp_Pnt_1());
            let p2 = c(new occ.gp_Pnt_1());
            cc.NearestPoints(p1, p2);
            cc.LowerDistanceParameters(u1, u2);
            return {
                isParallel,
                distance,
                p1: OccHelps.toXYZ(p1),
                p2: OccHelps.toXYZ(p2),
                u1: u1.current,
                u2: u2.current,
            };
        });
    }

    private adaptorCurve(curve: Geom_Curve) {
        let geom_curve = new occ.Handle_Geom_Curve_2(curve);
        return new occ.GeomAdaptor_Curve_2(geom_curve);
    }

    private uniformAbscissa(ctor: (adaptor: GeomAdaptor_Curve) => GCPnts_UniformAbscissa) {
        return gc((c) => {
            let adaptor = c(this.adaptorCurve(this.curve));
            let gc = c(ctor(adaptor));
            let points: XYZ[] = [];
            if (gc.IsDone()) {
                for (let i = 1; i <= gc.NbPoints(); i++) {
                    let pnt = c(this.curve.Value(gc.Parameter(i)));
                    points.push(OccHelps.toXYZ(pnt));
                }
            }
            return points;
        });
    }

    uniformAbscissaByLength(length: number): XYZ[] {
        return gc((c) => {
            return this.uniformAbscissa((adaptor) =>
                c(new occ.GCPnts_UniformAbscissa_2(adaptor, length, 1e-3)),
            );
        });
    }

    uniformAbscissaByCount(curveCount: number): XYZ[] {
        return gc((c) => {
            return this.uniformAbscissa((adaptor) =>
                c(new occ.GCPnts_UniformAbscissa_2(adaptor, curveCount + 1, 1e-3)),
            );
        });
    }

    length(): number {
        return gc((c) => {
            let curve = c(this.adaptorCurve(this.curve));
            return occ.GCPnts_AbscissaPoint.Length_1(curve);
        });
    }

    trim(u1: number, u2: number): ITrimmedCurve {
        let curve = new occ.Handle_Geom_Curve_2(this.curve);
        let trimmedCurve = new occ.Geom_TrimmedCurve(curve, u1, u2, true, true);
        return new OccTrimmedCurve(trimmedCurve);
    }

    reverse() {
        this.curve.Reverse();
    }

    reversed(): ICurve {
        return OccHelps.wrapCurve(this.curve.Reversed().get());
    }

    isClosed(): boolean {
        return this.curve.IsClosed();
    }

    period(): number {
        return this.curve.Period();
    }

    isPeriodic(): boolean {
        return this.curve.IsPeriodic();
    }

    continutity(): Continuity {
        let cni = this.curve.Continuity();
        return OccHelps.convertContinuity(cni);
    }

    nearestFromPoint(point: XYZ) {
        return gc((c) => {
            let api = c(
                new occ.GeomAPI_ProjectPointOnCurve_2(
                    c(OccHelps.toPnt(point)),
                    new occ.Handle_Geom_Curve_2(this.curve),
                ),
            );
            if (api.NbPoints() > 0) {
                return {
                    point: OccHelps.toXYZ(c(api.NearestPoint())),
                    distance: api.LowerDistance(),
                    parameter: api.LowerDistanceParameter(),
                };
            }

            let start = this.value(this.curve.FirstParameter());
            let end = this.value(this.curve.LastParameter());
            let distStart = point.distanceTo(start);
            let distEnd = point.distanceTo(end);
            if (distStart < distEnd) {
                return {
                    point: start,
                    distance: distStart,
                    parameter: this.curve.FirstParameter(),
                };
            } else {
                return {
                    point: end,
                    distance: distEnd,
                    parameter: this.curve.LastParameter(),
                };
            }
        });
    }

    value(parameter: number): XYZ {
        return gc((c) => {
            let p = c(this.curve.Value(parameter));
            return OccHelps.toXYZ(p);
        });
    }

    firstParameter() {
        return this.curve.FirstParameter();
    }

    lastParameter() {
        return this.curve.LastParameter();
    }

    parameter(point: XYZ, tolerance: number): number | undefined {
        return gc((c) => {
            let parameter: any = { current: 0 };
            if (
                occ.GeomLib_Tool.Parameter_1(
                    new occ.Handle_Geom_Curve_2(this.curve),
                    c(OccHelps.toPnt(point)),
                    tolerance,
                    parameter,
                )
            ) {
                return parameter.current;
            }

            return undefined;
        });
    }

    project(point: XYZ): XYZ[] {
        return gc((c) => {
            let result = new Array<XYZ>();
            let api = c(
                new occ.GeomAPI_ProjectPointOnCurve_2(
                    c(OccHelps.toPnt(point)),
                    new occ.Handle_Geom_Curve_2(this.curve),
                ),
            );
            for (let i = 1; i <= api.NbPoints(); i++) {
                let point = c(api.Point(i));
                result.push(OccHelps.toXYZ(point));
            }

            result.sort((a, b) => a.distanceTo(point) - b.distanceTo(point));
            return result;
        });
    }

    isCN(n: number): boolean {
        return this.curve.IsCN(n);
    }

    d0(u: number) {
        return gc((c) => {
            let pnt = c(new occ.gp_Pnt_1());
            this.curve.D0(u, pnt);
            return OccHelps.toXYZ(pnt);
        });
    }

    d1(u: number) {
        return gc((c) => {
            let pnt = c(new occ.gp_Pnt_1());
            let vec = c(new occ.gp_Vec_1());
            this.curve.D1(u, pnt, vec);
            return {
                point: OccHelps.toXYZ(pnt),
                vec: OccHelps.toXYZ(vec),
            };
        });
    }

    d2(u: number) {
        return gc((c) => {
            let pnt = c(new occ.gp_Pnt_1());
            let vec1 = c(new occ.gp_Vec_1());
            let vec2 = c(new occ.gp_Vec_1());
            this.curve.D2(u, pnt, vec1, vec2);
            return {
                point: OccHelps.toXYZ(pnt),
                vec1: OccHelps.toXYZ(vec1),
                vec2: OccHelps.toXYZ(vec2),
            };
        });
    }

    d3(u: number) {
        return gc((c) => {
            let pnt = c(new occ.gp_Pnt_1());
            let vec1 = c(new occ.gp_Vec_1());
            let vec2 = c(new occ.gp_Vec_1());
            let vec3 = c(new occ.gp_Vec_1());
            this.curve.D3(u, pnt, vec1, vec2, vec3);
            return {
                point: OccHelps.toXYZ(pnt),
                vec1: OccHelps.toXYZ(vec1),
                vec2: OccHelps.toXYZ(vec2),
                vec3: OccHelps.toXYZ(vec3),
            };
        });
    }

    dn(u: number, n: number) {
        return gc((c) => {
            return OccHelps.toXYZ(c(this.curve.DN(u, n)));
        });
    }
}

export class OccLine extends OccCurve implements ILine {
    constructor(private line: Geom_Line) {
        super(line);
    }

    get direction(): XYZ {
        return gc((c) => {
            let lin = c(this.lin());
            return OccHelps.toXYZ(c(lin.Direction()));
        });
    }

    set direction(value: XYZ) {
        gc((c) => {
            this.line.SetDirection(c(OccHelps.toDir(value)));
        });
    }

    get location(): XYZ {
        return gc((c) => {
            let lin = c(this.lin());
            return OccHelps.toXYZ(c(lin.Location()));
        });
    }

    set location(value: XYZ) {
        gc((c) => {
            this.line.SetLocation(c(OccHelps.toPnt(value)));
        });
    }

    private lin() {
        return this.line.Lin();
    }
}

export class OccConic extends OccCurve implements IConic {
    constructor(private conion: Geom_Conic) {
        super(conion);
    }
    get axis(): XYZ {
        return gc((c) => {
            return OccHelps.toXYZ(c(c(this.conion.Axis()).Direction()));
        });
    }
    get xAxis(): XYZ {
        return gc((c) => {
            return OccHelps.toXYZ(c(c(this.conion.XAxis()).Direction()));
        });
    }
    get yAxis(): XYZ {
        return gc((c) => {
            return OccHelps.toXYZ(c(c(this.conion.YAxis()).Direction()));
        });
    }
    eccentricity(): number {
        return this.conion.Eccentricity();
    }
}

export class OccCircle extends OccConic implements ICircle {
    constructor(private circle: Geom_Circle) {
        super(circle);
    }

    get center(): XYZ {
        return gc((c) => {
            return OccHelps.toXYZ(c(this.circle.Location()));
        });
    }

    set center(value: XYZ) {
        gc((c) => {
            this.circle.SetLocation(c(OccHelps.toPnt(value)));
        });
    }

    get radius(): number {
        return this.circle.Radius();
    }

    set radius(value: number) {
        this.circle.SetRadius(value);
    }
}

export class OccEllipse extends OccConic implements IEllipse {
    constructor(private ellipse: Geom_Ellipse) {
        super(ellipse);
    }

    get center(): XYZ {
        return gc((c) => {
            return OccHelps.toXYZ(c(this.ellipse.Location()));
        });
    }
    set center(value: XYZ) {
        gc((c) => {
            this.ellipse.SetLocation(c(OccHelps.toPnt(value)));
        });
    }

    get focus1(): XYZ {
        return gc((c) => OccHelps.toXYZ(c(this.ellipse.Focus1())));
    }
    get focus2(): XYZ {
        return gc((c) => OccHelps.toXYZ(c(this.ellipse.Focus2())));
    }

    get majorRadius(): number {
        return this.ellipse.MajorRadius();
    }
    set majorRadius(value: number) {
        this.ellipse.SetMajorRadius(value);
    }

    get minorRadius(): number {
        return this.ellipse.MinorRadius();
    }
    set minorRadius(value: number) {
        this.ellipse.SetMinorRadius(value);
    }

    area(): number {
        return gc((c) => {
            return c(this.ellipse.Elips()).Area();
        });
    }
}

export class OccHyperbola extends OccConic implements IHyperbola {
    constructor(private hyperbola: Geom_Hyperbola) {
        super(hyperbola);
    }
    focal(): number {
        return this.hyperbola.Focal();
    }
    get location(): XYZ {
        return gc((c) => {
            return OccHelps.toXYZ(c(this.hyperbola.Location()));
        });
    }
    set location(value: XYZ) {
        gc((c) => {
            this.hyperbola.SetLocation(c(OccHelps.toPnt(value)));
        });
    }

    get focus1(): XYZ {
        return gc((c) => OccHelps.toXYZ(c(this.hyperbola.Focus1())));
    }
    get focus2(): XYZ {
        return gc((c) => OccHelps.toXYZ(c(this.hyperbola.Focus2())));
    }
    get majorRadius(): number {
        return this.hyperbola.MajorRadius();
    }
    set majorRadius(value: number) {
        this.hyperbola.SetMajorRadius(value);
    }

    get minorRadius(): number {
        return this.hyperbola.MinorRadius();
    }
    set minorRadius(value: number) {
        this.hyperbola.SetMinorRadius(value);
    }
}

export class OccParabola extends OccConic implements IParabola {
    constructor(private parabola: Geom_Parabola) {
        super(parabola);
    }
    focal(): number {
        return this.parabola.Focal();
    }

    get focus(): XYZ {
        return gc((c) => OccHelps.toXYZ(c(this.parabola.Focus())));
    }

    get directrix() {
        return gc((c) => OccHelps.toXYZ(c(c(this.parabola.Directrix().Location()))));
    }
}

export class OccBoundedCurve extends OccCurve implements IBoundedCurve {
    constructor(private boundedCurve: Geom_BoundedCurve) {
        super(boundedCurve);
    }

    startPoint(): XYZ {
        return gc((c) => OccHelps.toXYZ(c(this.boundedCurve.StartPoint())));
    }

    endPoint(): XYZ {
        return gc((c) => OccHelps.toXYZ(c(this.boundedCurve.EndPoint())));
    }
}

export class OccTrimmedCurve extends OccBoundedCurve implements ITrimmedCurve {
    constructor(private trimmedCurve: Geom_TrimmedCurve) {
        super(trimmedCurve);
    }

    setTrim(u1: number, u2: number): void {
        this.trimmedCurve.SetTrim(u1, u2, true, true);
    }

    basisCurve(): ICurve {
        return OccHelps.wrapCurve(this.trimmedCurve.BasisCurve().get());
    }
}

export class OccOffsetCurve extends OccCurve implements IOffsetCurve {
    constructor(private offsetCurve: Geom_OffsetCurve) {
        super(offsetCurve);
    }

    basisCurve(): ICurve {
        return OccHelps.wrapCurve(this.offsetCurve.BasisCurve().get());
    }

    offset(): number {
        return this.offsetCurve.Offset();
    }

    direction(): XYZ {
        return gc((c) => OccHelps.toXYZ(c(this.offsetCurve.Direction())));
    }
}

export class OccBezierCurve extends OccBoundedCurve implements IBezierCurve {
    constructor(private bezier: Geom_BezierCurve) {
        super(bezier);
    }

    weight(index: number): number {
        return this.bezier.Weight(index);
    }

    insertPoleAfter(index: number, point: XYZ, weight: number | undefined): void {
        gc((c) => {
            if (weight === undefined) {
                this.bezier.InsertPoleAfter_1(index, c(OccHelps.toPnt(point)));
            } else {
                this.bezier.InsertPoleAfter_2(index, c(OccHelps.toPnt(point)), weight);
            }
        });
    }

    insertPoleBefore(index: number, point: XYZ, weight: number | undefined): void {
        gc((c) => {
            if (weight === undefined) {
                this.bezier.InsertPoleBefore_1(index, c(OccHelps.toPnt(point)));
            } else {
                this.bezier.InsertPoleBefore_2(index, c(OccHelps.toPnt(point)), weight);
            }
        });
    }

    removePole(index: number): void {
        this.bezier.RemovePole(index);
    }

    setPole(index: number, point: XYZ, weight: number | undefined): void {
        gc((c) => {
            if (weight === undefined) {
                this.bezier.SetPole_1(index, c(OccHelps.toPnt(point)));
            } else {
                this.bezier.SetPole_2(index, c(OccHelps.toPnt(point)), weight);
            }
        });
    }

    setWeight(index: number, weight: number): void {
        this.setWeight(index, weight);
    }

    nbPoles(): number {
        return this.bezier.NbPoles();
    }

    pole(index: number): XYZ {
        return gc((c) => OccHelps.toXYZ(c(this.bezier.Pole(index))));
    }

    degree(): number {
        return this.bezier.Degree();
    }

    poles(): XYZ[] {
        return gc((c) => {
            let result: XYZ[] = [];
            let pls = c(this.bezier.Poles_2());
            for (let i = 1; i <= pls.Length(); i++) {
                result.push(OccHelps.toXYZ(c(pls.Value(i))));
            }
            return result;
        });
    }
}

export class OccBSplineCurve extends OccBoundedCurve implements IBSplineCurve {
    constructor(private bspline: Geom_BSplineCurve) {
        super(bspline);
    }
    nbKnots(): number {
        return this.bspline.NbKnots();
    }
    knot(index: number): number {
        return this.bspline.Knot(index);
    }
    setKnot(index: number, value: number): void {
        this.bspline.SetKnot_1(index, value);
    }
    nbPoles(): number {
        return this.bspline.NbPoles();
    }
    pole(index: number): XYZ {
        return gc((c) => OccHelps.toXYZ(c(this.bspline.Pole(index))));
    }
    poles(): XYZ[] {
        return gc((c) => {
            let result: XYZ[] = [];
            let pls = c(this.bspline.Poles_2());
            for (let i = 1; i <= pls.Length(); i++) {
                result.push(OccHelps.toXYZ(c(pls.Value(i))));
            }
            return result;
        });
    }
    weight(index: number): number {
        return this.bspline.Weight(index);
    }
    setWeight(index: number, value: number): void {
        this.bspline.SetWeight(index, value);
    }

    degree(): number {
        return this.bspline.Degree();
    }
}
