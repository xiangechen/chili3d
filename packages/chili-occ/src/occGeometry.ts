// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    CurveType,
    IBezierCurve,
    IBoundedCurve,
    ICircle,
    ICurve,
    IDisposable,
    ILine,
    IOffsetCurve,
    ITrimmedCurve,
    Plane,
    XYZ,
} from "chili-core";
import {
    Geom_BezierCurve,
    Geom_BoundedCurve,
    Geom_Circle,
    Geom_Curve,
    Geom_Line,
    Geom_OffsetCurve,
    Geom_TrimmedCurve,
} from "../occ-wasm/chili_occ";

import { OccHelps } from "./occHelps";

export class OccCurve implements ICurve, IDisposable {
    readonly curveType: CurveType;

    constructor(readonly curve: Geom_Curve) {
        this.curveType = OccHelps.getCurveType(curve);
    }

    nearestPoint(point: XYZ): XYZ {
        let api = new occ.GeomAPI_ProjectPointOnCurve_2(
            OccHelps.toPnt(point),
            new occ.Handle_Geom_Curve_2(this.curve),
        );
        if (api.NbPoints() == 0) {
            let start = this.point(this.curve.FirstParameter());
            let end = this.point(this.curve.LastParameter());
            let distStart = point.distanceTo(start);
            let distEnd = point.distanceTo(end);
            return distStart < distEnd ? start : end;
        }

        let pnt = api.NearestPoint();
        return OccHelps.toXYZ(pnt);
    }

    point(parameter: number): XYZ {
        let p = this.curve.Value(parameter);
        return OccHelps.toXYZ(p);
    }

    firstParameter() {
        return this.curve.FirstParameter();
    }

    lastParameter() {
        return this.curve.LastParameter();
    }

    parameter(point: XYZ): number {
        let api = new occ.GeomAPI_ProjectPointOnCurve_2(
            OccHelps.toPnt(point),
            new occ.Handle_Geom_Curve_2(this.curve),
        );
        return api.LowerDistanceParameter();
    }

    project(point: XYZ): XYZ[] {
        let result = new Array<XYZ>();
        let api = new occ.GeomAPI_ProjectPointOnCurve_2(
            OccHelps.toPnt(point),
            new occ.Handle_Geom_Curve_2(this.curve),
        );
        for (let i = 1; i <= api.NbPoints(); i++) {
            let point = api.Point(i);
            result.push(OccHelps.toXYZ(point));
        }

        result.sort((a, b) => a.distanceTo(point) - b.distanceTo(point));
        return result;
    }

    isCN(n: number): boolean {
        return this.curve.IsCN(n);
    }

    d0(u: number) {
        let pnt = new occ.gp_Pnt_1();
        this.curve.D0(u, pnt);
        return OccHelps.toXYZ(pnt);
    }

    d1(u: number) {
        let pnt = new occ.gp_Pnt_1();
        let vec = new occ.gp_Vec_1();
        this.curve.D1(u, pnt, vec);
        return {
            point: OccHelps.toXYZ(pnt),
            vec: OccHelps.toXYZ(vec),
        };
    }

    d2(u: number) {
        let pnt = new occ.gp_Pnt_1();
        let vec1 = new occ.gp_Vec_1();
        let vec2 = new occ.gp_Vec_1();
        this.curve.D2(u, pnt, vec1, vec2);
        return {
            point: OccHelps.toXYZ(pnt),
            vec1: OccHelps.toXYZ(vec1),
            vec2: OccHelps.toXYZ(vec2),
        };
    }

    d3(u: number) {
        let pnt = new occ.gp_Pnt_1();
        let vec1 = new occ.gp_Vec_1();
        let vec2 = new occ.gp_Vec_1();
        let vec3 = new occ.gp_Vec_1();
        this.curve.D3(u, pnt, vec1, vec2, vec3);
        return {
            point: OccHelps.toXYZ(pnt),
            vec1: OccHelps.toXYZ(vec1),
            vec2: OccHelps.toXYZ(vec2),
            vec3: OccHelps.toXYZ(vec3),
        };
    }

    dn(u: number, n: number) {
        return OccHelps.toXYZ(this.curve.DN(u, n));
    }

    dispose() {
        this.curve.delete();
    }
}

export class OccLine extends OccCurve implements ILine {
    constructor(private line: Geom_Line) {
        super(line);
    }

    get direction(): XYZ {
        return OccHelps.toXYZ(this.lin().Direction());
    }

    set direction(value: XYZ) {
        this.line.SetDirection(OccHelps.toDir(value));
    }

    get location(): XYZ {
        return OccHelps.toXYZ(this.lin().Location());
    }

    set location(value: XYZ) {
        this.line.SetLocation(OccHelps.toPnt(value));
    }

    private lin() {
        return this.line.Lin();
    }
}

export class OccCircle extends OccCurve implements ICircle {
    get plane(): Plane {
        return OccHelps.fromAx2(this.circle.Position());
    }
    set plane(value: Plane) {
        this.circle.SetPosition(OccHelps.toAx2(value));
    }

    constructor(private circle: Geom_Circle) {
        super(circle);
    }

    get center(): XYZ {
        return OccHelps.toXYZ(this.circle.Location());
    }

    set center(value: XYZ) {
        this.circle.SetLocation(OccHelps.toPnt(value));
    }

    get radius(): number {
        return this.circle.Radius();
    }

    set radius(value: number) {
        this.circle.SetRadius(value);
    }
}

export class OccBoundedCurve extends OccCurve implements IBoundedCurve {
    constructor(private boundedCurve: Geom_BoundedCurve) {
        super(boundedCurve);
    }

    startPoint(): XYZ {
        return OccHelps.toXYZ(this.boundedCurve.StartPoint());
    }

    endPoint(): XYZ {
        return OccHelps.toXYZ(this.boundedCurve.EndPoint());
    }
}

export class OccTrimmedCurve extends OccBoundedCurve implements ITrimmedCurve {
    constructor(private trimmedCurve: Geom_TrimmedCurve) {
        super(trimmedCurve);
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
        return OccHelps.toXYZ(this.offsetCurve.Direction());
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
        if (weight === undefined) {
            this.bezier.InsertPoleAfter_1(index, OccHelps.toPnt(point));
        } else {
            this.bezier.InsertPoleAfter_2(index, OccHelps.toPnt(point), weight);
        }
    }

    insertPoleBefore(index: number, point: XYZ, weight: number | undefined): void {
        if (weight === undefined) {
            this.bezier.InsertPoleBefore_1(index, OccHelps.toPnt(point));
        } else {
            this.bezier.InsertPoleBefore_2(index, OccHelps.toPnt(point), weight);
        }
    }

    removePole(index: number): void {
        this.bezier.RemovePole(index);
    }

    setPole(index: number, point: XYZ, weight: number | undefined): void {
        if (weight === undefined) {
            this.bezier.SetPole_1(index, OccHelps.toPnt(point));
        } else {
            this.bezier.SetPole_2(index, OccHelps.toPnt(point), weight);
        }
    }

    setWeight(index: number, weight: number): void {
        this.setWeight(index, weight);
    }

    nbPoles(): number {
        return this.bezier.NbPoles();
    }

    pole(index: number): XYZ {
        return OccHelps.toXYZ(this.bezier.Pole(index));
    }

    degree(): number {
        return this.bezier.Degree();
    }

    poles(): XYZ[] {
        let result: XYZ[] = [];
        let pls = this.bezier.Poles_2();
        for (let i = 1; i <= pls.Length(); i++) {
            result.push(OccHelps.toXYZ(pls.Value(i)));
        }
        return result;
    }
}
