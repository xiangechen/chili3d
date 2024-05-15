// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { CurveType, ICircle, ICurve, IDisposable, ILine, Plane, XYZ } from "chili-core";
import { Geom_Circle, Geom_Curve, Geom_Line, Geom_TrimmedCurve } from "../occ-wasm/chili_occ";

import { OccHelps } from "./occHelps";

export class OccCurve implements ICurve, IDisposable {
    readonly curve: Geom_TrimmedCurve;
    readonly curveType: CurveType;

    constructor(curve: Geom_Curve, start: number, end: number) {
        let curveHandle = new occ.Handle_Geom_Curve_2(curve);
        this.curveType = OccHelps.getCurveType(curve);
        this.curve = new occ.Geom_TrimmedCurve(curveHandle, start, end, true, true);
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
        let api = new occ.GeomAPI_ProjectPointOnCurve_2(OccHelps.toPnt(point), this.curve.BasisCurve());
        return api.LowerDistanceParameter();
    }

    trim(start: number, end: number) {
        this.curve.SetTrim(start, end, true, true);
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
    constructor(
        private line: Geom_Line,
        start: number,
        end: number,
    ) {
        super(line, start, end);
    }

    get start(): XYZ {
        return OccHelps.toXYZ(this.curve.StartPoint());
    }

    get endPoint(): XYZ {
        return OccHelps.toXYZ(this.curve.EndPoint());
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

    constructor(
        private circle: Geom_Circle,
        start: number,
        end: number,
    ) {
        super(circle, start, end);
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
