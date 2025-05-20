// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

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
    IGeometry,
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
    Matrix4,
    Plane,
    XYZ,
    gc,
} from "chili-core";
import {
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
} from "../lib/chili-wasm";
import { OccCurve } from "./curve";
import { OccGeometry } from "./geometry";
import { OcctHelper } from "./helper";

export class OccSurface extends OccGeometry implements ISurface {
    constructor(readonly surface: Geom_Surface) {
        super(surface);
    }

    override copy(): IGeometry {
        return gc((c) => {
            let s = c(this.surface.copy());
            return OcctHelper.wrapSurface(s.get() as Geom_Surface);
        });
    }

    override transformed(matrix: Matrix4): IGeometry {
        return gc((c) => {
            let s = c(this.surface.transformed(OcctHelper.convertFromMatrix(matrix)));
            return OcctHelper.wrapSurface(s.get() as Geom_Surface);
        });
    }

    projectCurve(curve: ICurve): ICurve | undefined {
        return gc((c) => {
            if (!(curve instanceof OccCurve)) return undefined;
            let handleCurve = c(wasm.Surface.projectCurve(this.surface, curve.curve));
            return OcctHelper.wrapCurve(handleCurve.get()!);
        });
    }

    project(point: XYZ): XYZ[] {
        return wasm.Surface.projectPoint(this.surface, point)
            .map((p) => new XYZ(p.x, p.y, p.z))
            .toSorted((a, b) => a.distanceTo(point) - b.distanceTo(point));
    }

    isPlanar(): boolean {
        return wasm.Surface.isPlanar(this.surface);
    }

    parameter(point: XYZ, maxDistance: number): { u: number; v: number } | undefined {
        return wasm.Surface.parameters(this.surface, point, maxDistance);
    }

    nearestPoint(point: XYZ): [XYZ, number] | undefined {
        let result = wasm.Surface.nearestPoint(this.surface, point);
        if (result) {
            return [OcctHelper.toXYZ(result.point), result.parameter];
        }
        return undefined;
    }

    continuity(): Continuity {
        return OcctHelper.convertContinuity(this.surface.continuity());
    }

    uIso(u: number): ICurve {
        return gc((c) => {
            let curve = c(this.surface.uIso(u));
            return OcctHelper.wrapCurve(curve.get()!);
        });
    }
    vIso(v: number): ICurve {
        return gc((c) => {
            let curve = c(this.surface.vIso(v));
            return OcctHelper.wrapCurve(curve.get()!);
        });
    }
    isUClosed(): boolean {
        return this.surface.isUClosed();
    }
    isVClosed(): boolean {
        return this.surface.isVClosed();
    }
    isUPreiodic(): boolean {
        return this.surface.isUPeriodic();
    }
    isVPreiodic(): boolean {
        return this.surface.isVPeriodic();
    }
    vPeriod(): number {
        return this.surface.vPeriod();
    }
    uPeriod(): number {
        return this.surface.uPeriod();
    }
    bounds() {
        return wasm.Surface.bounds(this.surface);
    }
    isCNu(n: number): boolean {
        return this.surface.isCNu(n);
    }
    isCNv(n: number): boolean {
        return this.surface.isCNv(n);
    }
    d0(u: number, v: number): XYZ {
        return gc((c) => {
            let pnt = c(new wasm.gp_Pnt(0, 0, 0));
            this.surface.d0(u, v, pnt);
            return OcctHelper.toXYZ(pnt);
        });
    }
    d1(
        u: number,
        v: number,
    ): {
        point: XYZ;
        d1u: XYZ;
        d1v: XYZ;
    } {
        return gc((c) => {
            let pnt = c(new wasm.gp_Pnt(0, 0, 0));
            let d1u = c(new wasm.gp_Vec(0, 0, 0));
            let d1v = c(new wasm.gp_Vec(0, 0, 0));
            this.surface.d1(u, v, pnt, d1u, d1v);
            return {
                point: OcctHelper.toXYZ(pnt),
                d1u: OcctHelper.toXYZ(d1u),
                d1v: OcctHelper.toXYZ(d1v),
            };
        });
    }
    d2(u: number, v: number) {
        return gc((c) => {
            let pnt = c(new wasm.gp_Pnt(0, 0, 0));
            let d1u = c(new wasm.gp_Vec(0, 0, 0));
            let d1v = c(new wasm.gp_Vec(0, 0, 0));
            let d2u = c(new wasm.gp_Vec(0, 0, 0));
            let d2v = c(new wasm.gp_Vec(0, 0, 0));
            let d2uv = c(new wasm.gp_Vec(0, 0, 0));
            this.surface.d2(u, v, pnt, d1u, d1v, d2u, d2v, d2uv);

            return {
                point: OcctHelper.toXYZ(pnt),
                d1u: OcctHelper.toXYZ(d1u),
                d1v: OcctHelper.toXYZ(d1v),
                d2u: OcctHelper.toXYZ(d2u),
                d2v: OcctHelper.toXYZ(d2v),
                d2uv: OcctHelper.toXYZ(d2uv),
            };
        });
    }
    d3(u: number, v: number) {
        return gc((c) => {
            let pnt = c(new wasm.gp_Pnt(0, 0, 0));
            let d1u = c(new wasm.gp_Vec(0, 0, 0));
            let d1v = c(new wasm.gp_Vec(0, 0, 0));
            let d2u = c(new wasm.gp_Vec(0, 0, 0));
            let d2v = c(new wasm.gp_Vec(0, 0, 0));
            let d2uv = c(new wasm.gp_Vec(0, 0, 0));
            let d3u = c(new wasm.gp_Vec(0, 0, 0));
            let d3v = c(new wasm.gp_Vec(0, 0, 0));
            let d3uuv = c(new wasm.gp_Vec(0, 0, 0));
            let d3uvv = c(new wasm.gp_Vec(0, 0, 0));
            this.surface.d3(u, v, pnt, d1u, d1v, d2u, d2v, d2uv, d3u, d3v, d3uuv, d3uvv);

            return {
                point: OcctHelper.toXYZ(pnt),
                d1u: OcctHelper.toXYZ(d1u),
                d1v: OcctHelper.toXYZ(d1v),
                d2u: OcctHelper.toXYZ(d2u),
                d2v: OcctHelper.toXYZ(d2v),
                d2uv: OcctHelper.toXYZ(d2uv),
                d3u: OcctHelper.toXYZ(d3u),
                d3v: OcctHelper.toXYZ(d3v),
                d3uuv: OcctHelper.toXYZ(d3uuv),
                d3uvv: OcctHelper.toXYZ(d3uvv),
            };
        });
    }
    dn(u: number, v: number, nu: number, nv: number): XYZ {
        return gc((c) => {
            let vec = c(this.surface.dn(u, v, nu, nv));
            return OcctHelper.toXYZ(vec);
        });
    }
    value(u: number, v: number): XYZ {
        return gc((c) => {
            let pnt = c(this.surface.value(u, v));
            return OcctHelper.toXYZ(pnt);
        });
    }
}

export class OccPlateSurface extends OccSurface implements IPlateSurface {
    constructor(private plateSurface: GeomPlate_Surface) {
        super(plateSurface);
    }

    setBounds(u1: number, u2: number, v1: number, v2: number): void {
        this.plateSurface.setBounds(u1, u2, v1, v2);
    }
}

export class OccBoundedSurface extends OccSurface implements IBoundedSurface {}

export class OccElementarySurface extends OccSurface implements IElementarySurface {
    constructor(private elementarySurface: Geom_ElementarySurface) {
        super(elementarySurface);
    }

    get location() {
        return gc((c) => OcctHelper.toXYZ(c(this.elementarySurface.location())));
    }
    set location(value: XYZ) {
        gc((c) => {
            this.elementarySurface.setLocation(c(OcctHelper.toPnt(value)));
        });
    }

    get axis() {
        return gc((c) => {
            return OcctHelper.toXYZ(c(c(this.elementarySurface.axis()).direction()));
        });
    }
    set axis(value: XYZ) {
        gc((c) => {
            let pnt = c(this.elementarySurface.location());
            let axis = c(new wasm.gp_Ax1(pnt, c(OcctHelper.toDir(value))));
            this.elementarySurface.setAxis(axis);
        });
    }
    get coordinates() {
        return gc((c) => {
            return OcctHelper.fromAx23(c(this.elementarySurface.position()));
        });
    }
    set coordinates(value: Plane) {
        gc((c) => {
            this.elementarySurface.setPosition(c(OcctHelper.toAx3(value)));
        });
    }
}

export class OccOffsetSurface extends OccSurface implements IOffsetSurface {
    constructor(private offsetSurface: Geom_OffsetSurface) {
        super(offsetSurface);
    }
    get offset(): number {
        return this.offsetSurface.offset();
    }
    set offset(value: number) {
        this.offsetSurface.setOffsetValue(value);
    }
    get basisSurface() {
        return gc((c) => {
            let handleSurface = c(this.offsetSurface.basisSurface());
            return OcctHelper.wrapSurface(handleSurface.get()!);
        });
    }
    set basisSurface(value: ISurface) {
        gc((c) => {
            if (value instanceof OccSurface) {
                let handleSurface = c(new wasm.Handle_Geom_Surface(value.surface));
                this.offsetSurface.setBasisSurface(handleSurface, true);
            }
            throw new Error("Invalid surface type");
        });
    }
}

export class OccSweptSurface extends OccSurface implements ISweptSurface {
    constructor(private sweptSurface: Geom_SweptSurface) {
        super(sweptSurface);
    }
    direction(): XYZ {
        return gc((c) => {
            return OcctHelper.toXYZ(c(this.sweptSurface.direction()));
        });
    }
    basisCurve(): ICurve {
        return gc((c) => {
            let handleCurve = this.sweptSurface.basisCurve();
            return OcctHelper.wrapCurve(handleCurve.get()!);
        });
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
        return gc((c) => {
            let handleSurface = c(this.rectangularSurface.basisSurface());
            return OcctHelper.wrapSurface(handleSurface.get()!);
        });
    }
    setUTrim(u1: number, u2: number): void {
        this.rectangularSurface.setTrim2(u1, u2, true, true);
    }
    setVTrim(v1: number, v2: number): void {
        this.rectangularSurface.setTrim2(v1, v2, false, true);
    }
    setTrim(u1: number, u2: number, v1: number, v2: number): void {
        this.rectangularSurface.setTrim(u1, u2, v1, v2, true, true);
    }
}

export class OccConicalSurface extends OccElementarySurface implements IConicalSurface {
    constructor(private conicalSurface: Geom_ConicalSurface) {
        super(conicalSurface);
    }
    get semiAngle(): number {
        return this.conicalSurface.semiAngle();
    }
    set semiAngle(value: number) {
        this.conicalSurface.setSemiAngle(value);
    }
    setRadius(value: number) {
        return this.conicalSurface.setRadius(value);
    }
    apex(): XYZ {
        return gc((c) => {
            return OcctHelper.toXYZ(c(this.conicalSurface.apex()));
        });
    }
    refRadius(): number {
        return this.conicalSurface.refRadius();
    }
}

export class OccCylindricalSurface extends OccElementarySurface implements ICylindricalSurface {
    constructor(private cylindricalSurface: Geom_CylindricalSurface) {
        super(cylindricalSurface);
    }
    get radius(): number {
        return this.cylindricalSurface.radius();
    }
    set radius(value: number) {
        this.cylindricalSurface.setRadius(value);
    }
}

export class OccPlane extends OccElementarySurface implements IPlaneSurface {
    constructor(private geom_plane: Geom_Plane) {
        super(geom_plane);
    }
    get plane(): Plane {
        return gc((c) => {
            return OcctHelper.fromPln(c(this.geom_plane.pln()));
        });
    }
    set plane(value: Plane) {
        gc((c) => {
            this.geom_plane.setPln(c(OcctHelper.toPln(value)));
        });
    }
}

export class OccSphericalSurface extends OccElementarySurface implements ISphericalSurface {
    constructor(private sphericalSurface: Geom_SphericalSurface) {
        super(sphericalSurface);
    }
    get radius(): number {
        return this.sphericalSurface.radius();
    }
    set radius(value: number) {
        this.sphericalSurface.setRadius(value);
    }
    area(): number {
        return this.sphericalSurface.area();
    }
    volume(): number {
        return this.sphericalSurface.volume();
    }
}

export class OccToroidalSurface extends OccElementarySurface implements IToroidalSurface {
    constructor(private toroidalSurface: Geom_ToroidalSurface) {
        super(toroidalSurface);
    }
    area(): number {
        return this.toroidalSurface.area();
    }
    volume(): number {
        return this.toroidalSurface.volume();
    }
    get majorRadius(): number {
        return this.toroidalSurface.majorRadius();
    }
    set majorRadius(value: number) {
        this.toroidalSurface.setMajorRadius(value);
    }
    get minorRadius(): number {
        return this.toroidalSurface.minorRadius();
    }
    set minorRadius(value: number) {
        this.toroidalSurface.setMinorRadius(value);
    }
}

export class OccSurfaceOfLinearExtrusion extends OccSweptSurface implements ISurfaceOfLinearExtrusion {
    constructor(private surfaceOfLinearExtrusion: Geom_SurfaceOfLinearExtrusion) {
        super(surfaceOfLinearExtrusion);
    }
    setDirection(direction: XYZ) {
        gc((c) => {
            this.surfaceOfLinearExtrusion.setDirection(c(OcctHelper.toDir(direction)));
        });
    }
    setBasisCurve(curve: ICurve) {
        if (!(curve instanceof OccCurve)) {
            throw new Error("curve must be an OccCurve");
        }
        let handleCurve = new wasm.Handle_Geom_Curve(curve.curve);
        this.surfaceOfLinearExtrusion.setBasisCurve(handleCurve);
        handleCurve.delete();
    }
}

export class OccSurfaceOfRevolution extends OccSweptSurface implements ISurfaceOfRevolution {
    constructor(private surfaceOfRevolution: Geom_SurfaceOfRevolution) {
        super(surfaceOfRevolution);
    }
    get location(): XYZ {
        return gc((c) => {
            return OcctHelper.toXYZ(c(this.surfaceOfRevolution.location()));
        });
    }
    set location(value: XYZ) {
        gc((c) => {
            this.surfaceOfRevolution.setLocation(c(OcctHelper.toPnt(value)));
        });
    }
    referencePlane(): Plane {
        return gc((c) => {
            return OcctHelper.fromAx23(c(this.surfaceOfRevolution.referencePlane()));
        });
    }
    setDirection(direction: XYZ) {
        gc((c) => {
            this.surfaceOfRevolution.setDirection(c(OcctHelper.toDir(direction)));
        });
    }
    setBasisCurve(curve: ICurve) {
        if (!(curve instanceof OccCurve)) {
            throw new Error("curve must be an OccCurve");
        }
        let handleCurve = new wasm.Handle_Geom_Curve(curve.curve);
        this.surfaceOfRevolution.setBasisCurve(handleCurve);
        handleCurve.delete();
    }
}
