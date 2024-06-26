// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import {
    Continuity,
    IBSplineSurface,
    IBezierSurface,
    IBoundedSurface,
    ICompositeSurface,
    IConicalSurface,
    ICurve,
    ICylindricalSurface,
    IElementarySurface,
    IOffsetSurface,
    IPlaneSurface,
    IPlateSurface,
    IRectangularTrimmedSurface,
    ISphericalSurface,
    ISurface,
    ISurfaceOfLinearExtrusion,
    ISurfaceOfRevolution,
    ISweptSurface,
    IToroidalSurface,
    Plane,
    XYZ,
} from "chili-core";
import {
    Extrema_ExtAlgo,
    GeomPlate_Surface,
    Geom_BSplineSurface,
    Geom_BezierSurface,
    Geom_ConicalSurface,
    Geom_CylindricalSurface,
    Geom_ElementarySurface,
    Geom_OffsetSurface,
    Geom_Plane,
    Geom_RectangularTrimmedSurface,
    Geom_SphericalSurface,
    Geom_Surface,
    Geom_SurfaceOfLinearExtrusion,
    Geom_SurfaceOfRevolution,
    Geom_SweptSurface,
    Geom_ToroidalSurface,
    ShapeExtend_CompositeSurface,
} from "../occ-wasm/chili_occ";
import { OccCurve } from "./occCurve";
import { OccGeometry } from "./occGeometry";
import { OccHelps } from "./occHelps";
import { OccFace } from "./occShape";

export class OccSurface extends OccGeometry implements ISurface {
    constructor(readonly surface: Geom_Surface) {
        super(surface);
    }

    projectCurve(curve: ICurve): ICurve | undefined {
        if (!(curve instanceof OccCurve)) return undefined;
        let surface = new occ.Handle_Geom_Surface_2(this.surface);
        let testCurve = new occ.Handle_Geom_Curve_2(curve.curve);
        let result = occ.GeomProjLib.Project(testCurve, surface);
        if (result.IsNull()) return undefined;
        return OccHelps.wrapCurve(result.get());
    }

    project(point: XYZ): XYZ[] {
        let api = new occ.GeomAPI_ProjectPointOnSurf_2(
            OccHelps.toPnt(point),
            new occ.Handle_Geom_Surface_2(this.surface),
            occ.Extrema_ExtAlgo.Extrema_ExtAlgo_Grad as Extrema_ExtAlgo,
        );

        let result = new Array<XYZ>();
        for (let i = 1; i <= api.NbPoints(); i++) {
            let point = api.Point(i);
            result.push(OccHelps.toXYZ(point));
        }
        result.sort((a, b) => a.distanceTo(point) - b.distanceTo(point));
        return result;
    }

    isPlanar(): boolean {
        let surface = new occ.Handle_Geom_Surface_2(this.surface);
        let lib = new occ.GeomLib_IsPlanarSurface(surface, 1e-7);
        return lib.IsPlanar();
    }

    parameter(point: XYZ, maxDistance: number): { u: number; v: number } | undefined {
        let u: any = { current: 0 };
        let v: any = { current: 0 };
        if (
            occ.GeomLib_Tool.Parameters(
                new occ.Handle_Geom_Surface_2(this.surface),
                OccHelps.toPnt(point),
                maxDistance,
                u,
                v,
            )
        ) {
            return {
                u: u.current,
                v: v.current,
            };
        }

        return undefined;
    }

    nearestPoint(point: XYZ): [XYZ, number] | undefined {
        let api = new occ.GeomAPI_ProjectPointOnSurf_2(
            OccHelps.toPnt(point),
            new occ.Handle_Geom_Surface_2(this.surface),
            occ.Extrema_ExtAlgo.Extrema_ExtAlgo_Grad as Extrema_ExtAlgo,
        );
        if (api.IsDone()) {
            return [OccHelps.toXYZ(api.NearestPoint()), api.LowerDistance()];
        }
        return undefined;
    }

    continuity(): Continuity {
        return OccHelps.convertContinuity(this.surface.Continuity());
    }

    uIso(u: number): ICurve {
        let curve = this.surface.UIso(u);
        return OccHelps.wrapCurve(curve.get());
    }
    vIso(v: number): ICurve {
        let curve = this.surface.VIso(v);
        return OccHelps.wrapCurve(curve.get());
    }
    isUClosed(): boolean {
        return this.surface.IsUClosed();
    }
    isVClosed(): boolean {
        return this.surface.IsVClosed();
    }
    isUPreiodic(): boolean {
        return this.surface.IsUPeriodic();
    }
    isVPreiodic(): boolean {
        return this.surface.IsVPeriodic();
    }
    vPeriod(): number {
        return this.surface.VPeriod();
    }
    uPeriod(): number {
        return this.surface.UPeriod();
    }
    bounds() {
        let u1: any = { current: 0 };
        let u2: any = { current: 0 };
        let v1: any = { current: 0 };
        let v2: any = { current: 0 };
        this.surface.Bounds(u1, u2, v1, v2);
        return {
            u1: u1.current,
            u2: u2.current,
            v1: v1.current,
            v2: v2.current,
        };
    }
    isCNu(n: number): boolean {
        return this.surface.IsCNu(n);
    }
    isCNv(n: number): boolean {
        return this.surface.IsCNv(n);
    }
    d0(u: number, v: number): XYZ {
        let pnt = new occ.gp_Pnt_1();
        this.surface.D0(u, v, pnt);
        return OccHelps.toXYZ(pnt);
    }
    d1(
        u: number,
        v: number,
    ): {
        point: XYZ;
        d1u: XYZ;
        d1v: XYZ;
    } {
        let pnt = new occ.gp_Pnt_1();
        let d1u = new occ.gp_Vec_1();
        let d1v = new occ.gp_Vec_1();
        this.surface.D1(u, v, pnt, d1u, d1v);
        return {
            point: OccHelps.toXYZ(pnt),
            d1u: OccHelps.toXYZ(d1u),
            d1v: OccHelps.toXYZ(d1v),
        };
    }
    d2(u: number, v: number) {
        let pnt = new occ.gp_Pnt_1();
        let d1u = new occ.gp_Vec_1();
        let d1v = new occ.gp_Vec_1();
        let d2u = new occ.gp_Vec_1();
        let d2v = new occ.gp_Vec_1();
        let d2uv = new occ.gp_Vec_1();
        this.surface.D2(u, v, pnt, d1u, d1v, d2u, d2v, d2uv);

        return {
            point: OccHelps.toXYZ(pnt),
            d1u: OccHelps.toXYZ(d1u),
            d1v: OccHelps.toXYZ(d1v),
            d2u: OccHelps.toXYZ(d2u),
            d2v: OccHelps.toXYZ(d2v),
            d2uv: OccHelps.toXYZ(d2uv),
        };
    }
    d3(u: number, v: number) {
        let pnt = new occ.gp_Pnt_1();
        let d1u = new occ.gp_Vec_1();
        let d1v = new occ.gp_Vec_1();
        let d2u = new occ.gp_Vec_1();
        let d2v = new occ.gp_Vec_1();
        let d2uv = new occ.gp_Vec_1();
        let d3u = new occ.gp_Vec_1();
        let d3v = new occ.gp_Vec_1();
        let d3uuv = new occ.gp_Vec_1();
        let d3uvv = new occ.gp_Vec_1();
        this.surface.D3(u, v, pnt, d1u, d1v, d2u, d2v, d2uv, d3u, d3v, d3uuv, d3uvv);

        return {
            point: OccHelps.toXYZ(pnt),
            d1u: OccHelps.toXYZ(d1u),
            d1v: OccHelps.toXYZ(d1v),
            d2u: OccHelps.toXYZ(d2u),
            d2v: OccHelps.toXYZ(d2v),
            d2uv: OccHelps.toXYZ(d2uv),
            d3u: OccHelps.toXYZ(d3u),
            d3v: OccHelps.toXYZ(d3v),
            d3uuv: OccHelps.toXYZ(d3uuv),
            d3uvv: OccHelps.toXYZ(d3uvv),
        };
    }
    dn(u: number, v: number, nu: number, nv: number): XYZ {
        let vec = this.surface.DN(u, v, nu, nv);
        return OccHelps.toXYZ(vec);
    }
    value(u: number, v: number): XYZ {
        let pnt = this.surface.Value(u, v);
        return OccHelps.toXYZ(pnt);
    }
    makeFace() {
        let surface = new occ.Handle_Geom_Surface_2(this.surface);
        let builder = new occ.BRepBuilderAPI_MakeFace_8(surface, 1e-3);
        return new OccFace(builder.Face());
    }
}

export class OccPlateSurface extends OccSurface implements IPlateSurface {
    constructor(private plateSurface: GeomPlate_Surface) {
        super(plateSurface);
    }

    setBounds(u1: number, u2: number, v1: number, v2: number): void {
        this.plateSurface.SetBounds(u1, u2, v1, v2);
    }
}

export class OccBoundedSurface extends OccSurface implements IBoundedSurface {}

export class OccElementarySurface extends OccSurface implements IElementarySurface {
    constructor(private elementarySurface: Geom_ElementarySurface) {
        super(elementarySurface);
    }

    get location() {
        return OccHelps.toXYZ(this.elementarySurface.Location());
    }
    set location(value: XYZ) {
        this.elementarySurface.SetLocation(OccHelps.toPnt(value));
    }

    get axis() {
        return OccHelps.toXYZ(this.elementarySurface.Axis().Direction());
    }
    set axis(value: XYZ) {
        let pnt = this.elementarySurface.Location();
        let axis = new occ.gp_Ax1_2(pnt, OccHelps.toDir(value));
        this.elementarySurface.SetAxis(axis);
    }
    get coordinates() {
        return OccHelps.fromAx23(this.elementarySurface.Position());
    }
    set coordinates(value: Plane) {
        this.elementarySurface.SetPosition(OccHelps.toAx3(value));
    }
}

export class OccOffsetSurface extends OccSurface implements IOffsetSurface {
    constructor(private offsetSurface: Geom_OffsetSurface) {
        super(offsetSurface);
    }
    get offset(): number {
        return this.offsetSurface.Offset();
    }
    set offset(value: number) {
        this.offsetSurface.SetOffsetValue(value);
    }
    get basisSurface() {
        return OccHelps.wrapSurface(this.offsetSurface.BasisSurface().get());
    }
    set basisSurface(value: ISurface) {
        if (value instanceof OccSurface) {
            let surface = new occ.Handle_Geom_Surface_2(value.surface);
            this.offsetSurface.SetBasisSurface(surface, true);
        }
        throw new Error("Invalid surface type");
    }
}

export class OccSweptSurface extends OccSurface implements ISweptSurface {
    constructor(private sweptSurface: Geom_SweptSurface) {
        super(sweptSurface);
    }
    direction(): XYZ {
        return OccHelps.toXYZ(this.sweptSurface.Direction());
    }
    basisCurve(): ICurve {
        return OccHelps.wrapCurve(this.sweptSurface.BasisCurve().get());
    }
}

export class OccCompositeSurface extends OccSurface implements ICompositeSurface {
    constructor(compositeSurface: ShapeExtend_CompositeSurface) {
        super(compositeSurface as any);
    }
}

export class OccBSplineSurface extends OccSurface implements IBSplineSurface {
    constructor(private bsplineSurface: Geom_BSplineSurface) {
        super(bsplineSurface);
    }
}

export class OccBezierSurface extends OccSurface implements IBezierSurface {
    constructor(private bezierSurface: Geom_BezierSurface) {
        super(bezierSurface);
    }
}

export class OccRectangularSurface extends OccSurface implements IRectangularTrimmedSurface {
    constructor(private rectangularSurface: Geom_RectangularTrimmedSurface) {
        super(rectangularSurface);
    }
    basisSurface(): ISurface {
        return OccHelps.wrapSurface(this.rectangularSurface.BasisSurface().get());
    }
    setUTrim(u1: number, u2: number): void {
        this.rectangularSurface.SetTrim_2(u1, u2, true, true);
    }
    setVTrim(v1: number, v2: number): void {
        this.rectangularSurface.SetTrim_2(v1, v2, false, true);
    }
    setTrim(u1: number, u2: number, v1: number, v2: number): void {
        this.rectangularSurface.SetTrim_1(u1, u2, v1, v2, true, true);
    }
}

export class OccConicalSurface extends OccElementarySurface implements IConicalSurface {
    constructor(private conicalSurface: Geom_ConicalSurface) {
        super(conicalSurface);
    }
    get semiAngle(): number {
        return this.conicalSurface.SemiAngle();
    }
    set semiAngle(value: number) {
        this.conicalSurface.SetSemiAngle(value);
    }
    setRadius(value: number) {
        return this.conicalSurface.SetRadius(value);
    }
    apex(): XYZ {
        return OccHelps.toXYZ(this.conicalSurface.Apex());
    }
    refRadius(): number {
        return this.conicalSurface.RefRadius();
    }
}

export class OccCylindricalSurface extends OccElementarySurface implements ICylindricalSurface {
    constructor(private cylindricalSurface: Geom_CylindricalSurface) {
        super(cylindricalSurface);
    }
    get radius(): number {
        return this.cylindricalSurface.Radius();
    }
    set radius(value: number) {
        this.cylindricalSurface.SetRadius(value);
    }
}

export class OccPlane extends OccElementarySurface implements IPlaneSurface {
    constructor(private geom_plane: Geom_Plane) {
        super(geom_plane);
    }
    get plane(): Plane {
        return OccHelps.fromPln(this.geom_plane.Pln());
    }
    set plane(value: Plane) {
        this.geom_plane.SetPln(OccHelps.toPln(value));
    }
}

export class OccSphericalSurface extends OccElementarySurface implements ISphericalSurface {
    constructor(private sphericalSurface: Geom_SphericalSurface) {
        super(sphericalSurface);
    }
    get radius(): number {
        return this.sphericalSurface.Radius();
    }
    set radius(value: number) {
        this.sphericalSurface.SetRadius(value);
    }
    area(): number {
        return this.sphericalSurface.Area();
    }
    volume(): number {
        return this.sphericalSurface.Volume();
    }
}

export class OccToroidalSurface extends OccElementarySurface implements IToroidalSurface {
    constructor(private toroidalSurface: Geom_ToroidalSurface) {
        super(toroidalSurface);
    }
    area(): number {
        return this.toroidalSurface.Area();
    }
    volume(): number {
        return this.toroidalSurface.Volume();
    }
    get majorRadius(): number {
        return this.toroidalSurface.MajorRadius();
    }
    set majorRadius(value: number) {
        this.toroidalSurface.SetMajorRadius(value);
    }
    get minorRadius(): number {
        return this.toroidalSurface.MinorRadius();
    }
    set minorRadius(value: number) {
        this.toroidalSurface.SetMinorRadius(value);
    }
}

export class OccSurfaceOfLinearExtrusion extends OccSweptSurface implements ISurfaceOfLinearExtrusion {
    constructor(private surfaceOfLinearExtrusion: Geom_SurfaceOfLinearExtrusion) {
        super(surfaceOfLinearExtrusion);
    }
    setDirection(direction: XYZ) {
        this.surfaceOfLinearExtrusion.SetDirection(OccHelps.toDir(direction));
    }
    setBasisCurve(curve: ICurve) {
        if (!(curve instanceof OccCurve)) {
            throw new Error("curve must be an OccCurve");
        }
        this.surfaceOfLinearExtrusion.SetBasisCurve(new occ.Handle_Geom_Curve_2(curve.curve));
    }
}

export class OccSurfaceOfRevolution extends OccSweptSurface implements ISurfaceOfRevolution {
    constructor(private surfaceOfRevolution: Geom_SurfaceOfRevolution) {
        super(surfaceOfRevolution);
    }
    get location(): XYZ {
        return OccHelps.toXYZ(this.surfaceOfRevolution.Location());
    }
    set location(value: XYZ) {
        this.surfaceOfRevolution.SetLocation(OccHelps.toPnt(value));
    }
    referencePlane(): Plane {
        return OccHelps.fromAx23(this.surfaceOfRevolution.ReferencePlane());
    }
    setDirection(direction: XYZ) {
        this.surfaceOfRevolution.SetDirection(OccHelps.toDir(direction));
    }
    setBasisCurve(curve: ICurve) {
        if (!(curve instanceof OccCurve)) {
            throw new Error("curve must be an OccCurve");
        }
        this.surfaceOfRevolution.SetBasisCurve(new occ.Handle_Geom_Curve_2(curve.curve));
    }
}
