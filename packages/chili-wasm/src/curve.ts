// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

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
    Matrix4,
    Ray,
    XYZ,
    gc,
} from "chili-core";
import {
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
} from "../lib/chili-wasm";
import { OccGeometry } from "./geometry";
import { OcctHelper } from "./helper";
import { OccEdge } from "./shape";

export class OccCurve extends OccGeometry implements ICurve, IDisposable {
    readonly curveType: CurveType;

    constructor(readonly curve: Geom_Curve) {
        super(curve);
        this.curveType = OcctHelper.getCurveType(curve);
    }

    override copy(): IGeometry {
        return gc((c) => {
            let newCurve = c(this.curve.copy());
            return OcctHelper.wrapCurve(newCurve.get() as Geom_Curve);
        });
    }

    override transformed(matrix: Matrix4): IGeometry {
        return gc((c) => {
            let newCurve = c(this.curve.transformed(OcctHelper.convertFromMatrix(matrix)));
            return OcctHelper.wrapCurve(newCurve.get() as Geom_Curve);
        });
    }

    makeEdge(): IEdge {
        return new OccEdge(wasm.Edge.fromCurve(this.curve));
    }

    nearestExtrema(curve: ICurve | Ray) {
        return gc((c) => {
            let result;
            if (curve instanceof OccCurve) {
                result = wasm.Curve.nearestExtremaCC(this.curve, curve.curve);
            } else if (curve instanceof Ray) {
                let line = c(wasm.Curve.makeLine(curve.location, curve.direction));
                result = wasm.Curve.nearestExtremaCC(this.curve, line.get());
            }

            if (!result) {
                return undefined;
            }

            return {
                ...result,
                p1: OcctHelper.toXYZ(result.p1),
                p2: OcctHelper.toXYZ(result.p2),
            };
        });
    }

    uniformAbscissaByLength(length: number): XYZ[] {
        return wasm.Curve.uniformAbscissaWithLength(this.curve, length).map((x) => OcctHelper.toXYZ(x));
    }

    uniformAbscissaByCount(curveCount: number): XYZ[] {
        return wasm.Curve.uniformAbscissaWithCount(this.curve, curveCount + 1).map((x) =>
            OcctHelper.toXYZ(x),
        );
    }

    length(): number {
        return wasm.Curve.curveLength(this.curve);
    }

    trim(u1: number, u2: number): ITrimmedCurve {
        return gc((c) => {
            let trimCurve = c(wasm.Curve.trim(this.curve, u1, u2));
            return new OccTrimmedCurve(trimCurve.get()!);
        });
    }

    reverse() {
        this.curve.reverse();
    }

    reversed(): ICurve {
        return gc((c) => {
            let newCurve = c(this.curve.reversed());
            return OcctHelper.wrapCurve(newCurve.get()!);
        });
    }

    isClosed(): boolean {
        return this.curve.isClosed();
    }

    period(): number {
        return this.curve.period();
    }

    isPeriodic(): boolean {
        return this.curve.isPeriodic();
    }

    continutity(): Continuity {
        let cni = this.curve.continutity();
        return OcctHelper.convertContinuity(cni);
    }

    nearestFromPoint(point: XYZ) {
        let res = wasm.Curve.projectOrNearest(this.curve, point);
        return {
            ...res,
            point: OcctHelper.toXYZ(res.point),
        };
    }

    value(parameter: number): XYZ {
        return OcctHelper.toXYZ(this.curve.value(parameter));
    }

    firstParameter() {
        return this.curve.firstParameter();
    }

    lastParameter() {
        return this.curve.lastParameter();
    }

    parameter(point: XYZ, tolerance: number): number | undefined {
        return wasm.Curve.parameter(this.curve, point, tolerance);
    }

    project(point: XYZ): XYZ[] {
        return wasm.Curve.projects(this.curve, point)
            .map((p) => new XYZ(p.x, p.y, p.z))
            .toSorted((a, b) => a.distanceTo(point) - b.distanceTo(point));
    }

    isCN(n: number): boolean {
        return this.curve.isCN(n);
    }

    d0(u: number) {
        return gc((c) => {
            let pnt = c(new wasm.gp_Pnt(0, 0, 0));
            this.curve.d0(u, pnt);
            return OcctHelper.toXYZ(pnt);
        });
    }

    d1(u: number) {
        return gc((c) => {
            let pnt = c(new wasm.gp_Pnt(0, 0, 0));
            let vec = c(new wasm.gp_Vec(0, 0, 0));
            this.curve.d1(u, pnt, vec);
            return {
                point: OcctHelper.toXYZ(pnt),
                vec: OcctHelper.toXYZ(vec),
            };
        });
    }

    d2(u: number) {
        return gc((c) => {
            let pnt = c(new wasm.gp_Pnt(0, 0, 0));
            let vec1 = c(new wasm.gp_Vec(0, 0, 0));
            let vec2 = c(new wasm.gp_Vec(0, 0, 0));
            this.curve.d2(u, pnt, vec1, vec2);
            return {
                point: OcctHelper.toXYZ(pnt),
                vec1: OcctHelper.toXYZ(vec1),
                vec2: OcctHelper.toXYZ(vec2),
            };
        });
    }

    d3(u: number) {
        return gc((c) => {
            let pnt = c(new wasm.gp_Pnt(0, 0, 0));
            let vec1 = c(new wasm.gp_Vec(0, 0, 0));
            let vec2 = c(new wasm.gp_Vec(0, 0, 0));
            let vec3 = c(new wasm.gp_Vec(0, 0, 0));
            this.curve.d3(u, pnt, vec1, vec2, vec3);
            return {
                point: OcctHelper.toXYZ(pnt),
                vec1: OcctHelper.toXYZ(vec1),
                vec2: OcctHelper.toXYZ(vec2),
                vec3: OcctHelper.toXYZ(vec3),
            };
        });
    }

    dn(u: number, n: number) {
        return gc((c) => {
            return OcctHelper.toXYZ(c(this.curve.dn(u, n)));
        });
    }
}

export class OccLine extends OccCurve implements ILine {
    constructor(private line: Geom_Line) {
        super(line);
    }

    get direction(): XYZ {
        return gc((c) => {
            let ax = c(this.line.position());
            return OcctHelper.toXYZ(c(ax.direction()));
        });
    }

    set direction(value: XYZ) {
        gc((c) => {
            this.line.setDirection(c(OcctHelper.toDir(value)));
        });
    }

    get location(): XYZ {
        return gc((c) => {
            let ax = c(this.line.position());
            return OcctHelper.toXYZ(c(ax.location()));
        });
    }

    set location(value: XYZ) {
        gc((c) => {
            this.line.setLocation(c(OcctHelper.toPnt(value)));
        });
    }
}

export class OccConic extends OccCurve implements IConic {
    constructor(private conioc: Geom_Conic) {
        super(conioc);
    }
    get axis(): XYZ {
        return gc((c) => {
            return OcctHelper.toXYZ(c(c(this.conioc.axis()).direction()));
        });
    }
    get xAxis(): XYZ {
        return gc((c) => {
            return OcctHelper.toXYZ(c(c(this.conioc.xAxis()).direction()));
        });
    }
    get yAxis(): XYZ {
        return gc((c) => {
            return OcctHelper.toXYZ(c(c(this.conioc.yAxis()).direction()));
        });
    }
    eccentricity(): number {
        return this.conioc.eccentricity();
    }
}

export class OccCircle extends OccConic implements ICircle {
    constructor(private circle: Geom_Circle) {
        super(circle);
    }

    get center(): XYZ {
        return gc((c) => {
            return OcctHelper.toXYZ(c(this.circle.location()));
        });
    }

    set center(value: XYZ) {
        gc((c) => {
            this.circle.setLocation(c(OcctHelper.toPnt(value)));
        });
    }

    get radius(): number {
        return this.circle.radius();
    }

    set radius(value: number) {
        this.circle.setRadius(value);
    }
}

export class OccEllipse extends OccConic implements IEllipse {
    constructor(private ellipse: Geom_Ellipse) {
        super(ellipse);
    }

    get center(): XYZ {
        return gc((c) => {
            return OcctHelper.toXYZ(c(this.ellipse.location()));
        });
    }
    set center(value: XYZ) {
        gc((c) => {
            this.ellipse.setLocation(c(OcctHelper.toPnt(value)));
        });
    }

    get focus1(): XYZ {
        return gc((c) => OcctHelper.toXYZ(c(this.ellipse.focus1())));
    }
    get focus2(): XYZ {
        return gc((c) => OcctHelper.toXYZ(c(this.ellipse.focus2())));
    }

    get majorRadius(): number {
        return this.ellipse.majorRadius();
    }
    set majorRadius(value: number) {
        this.ellipse.setMajorRadius(value);
    }

    get minorRadius(): number {
        return this.ellipse.minorRadius();
    }
    set minorRadius(value: number) {
        this.ellipse.setMinorRadius(value);
    }
}

export class OccHyperbola extends OccConic implements IHyperbola {
    constructor(private hyperbola: Geom_Hyperbola) {
        super(hyperbola);
    }
    focal(): number {
        return this.hyperbola.focal();
    }
    get location(): XYZ {
        return gc((c) => {
            return OcctHelper.toXYZ(c(this.hyperbola.location()));
        });
    }
    set location(value: XYZ) {
        gc((c) => {
            this.hyperbola.setLocation(c(OcctHelper.toPnt(value)));
        });
    }

    get focus1(): XYZ {
        return gc((c) => OcctHelper.toXYZ(c(this.hyperbola.focus1())));
    }
    get focus2(): XYZ {
        return gc((c) => OcctHelper.toXYZ(c(this.hyperbola.focus2())));
    }
    get majorRadius(): number {
        return this.hyperbola.majorRadius();
    }
    set majorRadius(value: number) {
        this.hyperbola.setMajorRadius(value);
    }

    get minorRadius(): number {
        return this.hyperbola.minorRadius();
    }
    set minorRadius(value: number) {
        this.hyperbola.setMinorRadius(value);
    }
}

export class OccParabola extends OccConic implements IParabola {
    constructor(private parabola: Geom_Parabola) {
        super(parabola);
    }
    focal(): number {
        return this.parabola.focal();
    }

    get focus(): XYZ {
        return gc((c) => OcctHelper.toXYZ(c(this.parabola.focus())));
    }

    get directrix() {
        return gc((c) => OcctHelper.toXYZ(c(c(this.parabola.directrix().location()))));
    }
}

export class OccBoundedCurve extends OccCurve implements IBoundedCurve {
    constructor(private boundedCurve: Geom_BoundedCurve) {
        super(boundedCurve);
    }

    startPoint(): XYZ {
        return gc((c) => OcctHelper.toXYZ(c(this.boundedCurve.startPoint())));
    }

    endPoint(): XYZ {
        return gc((c) => OcctHelper.toXYZ(c(this.boundedCurve.endPoint())));
    }
}

export class OccTrimmedCurve extends OccBoundedCurve implements ITrimmedCurve {
    constructor(private trimmedCurve: Geom_TrimmedCurve) {
        super(trimmedCurve);
    }

    setTrim(u1: number, u2: number): void {
        this.trimmedCurve.setTrim(u1, u2, true, true);
    }

    private _basisCurve: ICurve | undefined;
    get basisCurve(): ICurve {
        this._basisCurve ??= gc((c) => {
            let curve = c(this.trimmedCurve.basisCurve());
            return OcctHelper.wrapCurve(curve.get()!);
        });
        return this._basisCurve;
    }

    protected override disposeInternal(): void {
        super.disposeInternal();
        if (this._basisCurve) {
            this._basisCurve.dispose();
        }
    }
}

export class OccOffsetCurve extends OccCurve implements IOffsetCurve {
    constructor(private offsetCurve: Geom_OffsetCurve) {
        super(offsetCurve);
    }

    private _basisCurve: ICurve | undefined;
    get basisCurve(): ICurve {
        this._basisCurve ??= gc((c) => {
            let curve = c(this.offsetCurve.basisCurve());
            return OcctHelper.wrapCurve(curve.get()!);
        });
        return this._basisCurve;
    }

    offset(): number {
        return this.offsetCurve.offset();
    }

    direction(): XYZ {
        return gc((c) => OcctHelper.toXYZ(c(this.offsetCurve.direction())));
    }

    protected override disposeInternal(): void {
        super.disposeInternal();
        if (this._basisCurve) {
            this._basisCurve.dispose();
        }
    }
}

export class OccBezierCurve extends OccBoundedCurve implements IBezierCurve {
    constructor(private bezier: Geom_BezierCurve) {
        super(bezier);
    }

    weight(index: number): number {
        return this.bezier.weight(index);
    }

    insertPoleAfter(index: number, point: XYZ, weight: number | undefined): void {
        gc((c) => {
            if (weight === undefined) {
                this.bezier.insertPoleAfter(index, c(OcctHelper.toPnt(point)));
            } else {
                this.bezier.insertPoleAfterWithWeight(index, c(OcctHelper.toPnt(point)), weight);
            }
        });
    }

    insertPoleBefore(index: number, point: XYZ, weight: number | undefined): void {
        gc((c) => {
            if (weight === undefined) {
                this.bezier.insertPoleBefore(index, c(OcctHelper.toPnt(point)));
            } else {
                this.bezier.insertPoleBeforeWithWeight(index, c(OcctHelper.toPnt(point)), weight);
            }
        });
    }

    removePole(index: number): void {
        this.bezier.removePole(index);
    }

    setPole(index: number, point: XYZ, weight: number | undefined): void {
        gc((c) => {
            if (weight === undefined) {
                this.bezier.setPole(index, c(OcctHelper.toPnt(point)));
            } else {
                this.bezier.setPoleWithWeight(index, c(OcctHelper.toPnt(point)), weight);
            }
        });
    }

    setWeight(index: number, weight: number): void {
        this.setWeight(index, weight);
    }

    nbPoles(): number {
        return this.bezier.nbPoles();
    }

    pole(index: number): XYZ {
        return gc((c) => OcctHelper.toXYZ(c(this.bezier.pole(index))));
    }

    degree(): number {
        return this.bezier.degree();
    }

    poles(): XYZ[] {
        return gc((c) => {
            let result: XYZ[] = [];
            let pls = c(this.bezier.getPoles());
            for (let i = 1; i <= pls.length(); i++) {
                result.push(OcctHelper.toXYZ(c(pls.value(i))));
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
        return this.bspline.nbKnots();
    }
    knot(index: number): number {
        return this.bspline.knot(index);
    }
    setKnot(index: number, value: number): void {
        this.bspline.setKnot(index, value);
    }
    nbPoles(): number {
        return this.bspline.nbPoles();
    }
    pole(index: number): XYZ {
        return gc((c) => OcctHelper.toXYZ(c(this.bspline.pole(index))));
    }
    poles(): XYZ[] {
        return gc((c) => {
            let result: XYZ[] = [];
            let pls = c(this.bspline.getPoles());
            for (let i = 1; i <= pls.length(); i++) {
                result.push(OcctHelper.toXYZ(c(pls.value(i))));
            }
            return result;
        });
    }
    weight(index: number): number {
        return this.bspline.weight(index);
    }
    setWeight(index: number, value: number): void {
        this.bspline.setWeight(index, value);
    }

    degree(): number {
        return this.bspline.degree();
    }
}
