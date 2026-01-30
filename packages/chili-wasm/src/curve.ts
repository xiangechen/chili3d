// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type Continuity,
    type CurveType,
    gc,
    type IBezierCurve,
    type IBoundedCurve,
    type IBSplineCurve,
    type ICircle,
    type IConic,
    type ICurve,
    type IDisposable,
    type IEdge,
    type IEllipse,
    type IGeometry,
    type IHyperbola,
    type ILine,
    type IOffsetCurve,
    type IParabola,
    type ITrimmedCurve,
    Line,
    type Matrix4,
    XYZ,
} from "chili-core";
import type {
    Geom_BezierCurve,
    Geom_BoundedCurve,
    Geom_BSplineCurve,
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
import { convertFromMatrix, convertToContinuity, getCurveType, toDir, toPnt, toXYZ } from "./helper";

export class OccCurve extends OccGeometry implements ICurve, IDisposable {
    readonly curveType: CurveType;

    constructor(readonly curve: Geom_Curve) {
        super(curve);
        this.curveType = getCurveType(curve);
    }

    static wrap(curve: Geom_Curve): ICurve {
        const isType = (type: string) => wasm.Transient.isInstance(curve, type);
        if (isType("Geom_Line")) return new OccLine(curve as Geom_Line);
        else if (isType("Geom_Circle")) return new OccCircle(curve as Geom_Circle);
        else if (isType("Geom_Ellipse")) return new OccEllipse(curve as Geom_Ellipse);
        else if (isType("Geom_Hyperbola")) return new OccHyperbola(curve as Geom_Hyperbola);
        else if (isType("Geom_Parabola")) return new OccParabola(curve as Geom_Parabola);
        else if (isType("Geom_BezierCurve")) return new OccBezierCurve(curve as Geom_BezierCurve);
        else if (isType("Geom_BSplineCurve")) return new OccBSplineCurve(curve as Geom_BSplineCurve);
        else if (isType("Geom_OffsetCurve")) return new OccOffsetCurve(curve as Geom_OffsetCurve);
        else if (isType("Geom_TrimmedCurve")) return new OccTrimmedCurve(curve as Geom_TrimmedCurve);

        throw new Error("Unknown curve type: " + String(curve));
    }

    override copy(): IGeometry {
        return gc((c) => {
            const newCurve = c(this.curve.copy());
            return OccCurve.wrap(newCurve.get() as Geom_Curve);
        });
    }

    override transformed(matrix: Matrix4): IGeometry {
        return gc((c) => {
            const newCurve = c(this.curve.transformed(convertFromMatrix(matrix)));
            return OccCurve.wrap(newCurve.get() as Geom_Curve);
        });
    }

    nearestExtrema(curve: ICurve | Line) {
        return gc((c) => {
            let result;
            if (curve instanceof OccCurve) {
                result = wasm.Curve.nearestExtremaCC(this.curve, curve.curve);
            } else if (curve instanceof Line) {
                const line = c(wasm.Curve.makeLine(curve.point, curve.direction));
                result = wasm.Curve.nearestExtremaCC(this.curve, line.get());
            }

            if (!result) {
                return undefined;
            }

            return {
                ...result,
                p1: toXYZ(result.p1),
                p2: toXYZ(result.p2),
            };
        });
    }

    uniformAbscissaByLength(length: number): XYZ[] {
        return wasm.Curve.uniformAbscissaWithLength(this.curve, length).map((x) => toXYZ(x));
    }

    uniformAbscissaByCount(curveCount: number): XYZ[] {
        return wasm.Curve.uniformAbscissaWithCount(this.curve, curveCount + 1).map((x) => toXYZ(x));
    }

    length(): number {
        return wasm.Curve.curveLength(this.curve);
    }

    trim(u1: number, u2: number): ITrimmedCurve {
        return gc((c) => {
            const trimCurve = c(wasm.Curve.trim(this.curve, u1, u2));
            return new OccTrimmedCurve(trimCurve.get()!);
        });
    }

    reverse() {
        this.curve.reverse();
    }

    reversed(): ICurve {
        return gc((c) => {
            const newCurve = c(this.curve.reversed());
            return OccCurve.wrap(newCurve.get()!);
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
        const cni = this.curve.continutity();
        return convertToContinuity(cni);
    }

    nearestFromPoint(point: XYZ) {
        const res = wasm.Curve.projectOrNearest(this.curve, point);
        return {
            ...res,
            point: toXYZ(res.point),
        };
    }

    value(parameter: number): XYZ {
        return toXYZ(this.curve.value(parameter));
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
            const pnt = c(new wasm.gp_Pnt(0, 0, 0));
            this.curve.d0(u, pnt);
            return toXYZ(pnt);
        });
    }

    d1(u: number) {
        return gc((c) => {
            const pnt = c(new wasm.gp_Pnt(0, 0, 0));
            const vec = c(new wasm.gp_Vec(0, 0, 0));
            this.curve.d1(u, pnt, vec);
            return {
                point: toXYZ(pnt),
                vec: toXYZ(vec),
            };
        });
    }

    d2(u: number) {
        return gc((c) => {
            const pnt = c(new wasm.gp_Pnt(0, 0, 0));
            const vec1 = c(new wasm.gp_Vec(0, 0, 0));
            const vec2 = c(new wasm.gp_Vec(0, 0, 0));
            this.curve.d2(u, pnt, vec1, vec2);
            return {
                point: toXYZ(pnt),
                vec1: toXYZ(vec1),
                vec2: toXYZ(vec2),
            };
        });
    }

    d3(u: number) {
        return gc((c) => {
            const pnt = c(new wasm.gp_Pnt(0, 0, 0));
            const vec1 = c(new wasm.gp_Vec(0, 0, 0));
            const vec2 = c(new wasm.gp_Vec(0, 0, 0));
            const vec3 = c(new wasm.gp_Vec(0, 0, 0));
            this.curve.d3(u, pnt, vec1, vec2, vec3);
            return {
                point: toXYZ(pnt),
                vec1: toXYZ(vec1),
                vec2: toXYZ(vec2),
                vec3: toXYZ(vec3),
            };
        });
    }

    dn(u: number, n: number) {
        return gc((c) => {
            const vec = c(this.curve.dn(u, n));
            return toXYZ(vec);
        });
    }
}

export class OccLine extends OccCurve implements ILine {
    constructor(private line: Geom_Line) {
        super(line);
    }

    get direction(): XYZ {
        return gc((c) => {
            const ax = c(this.line.position());
            return toXYZ(c(ax.direction()));
        });
    }

    set direction(value: XYZ) {
        gc((c) => {
            this.line.setDirection(c(toDir(value)));
        });
    }

    get location(): XYZ {
        return gc((c) => {
            const ax = c(this.line.position());
            return toXYZ(c(ax.location()));
        });
    }

    set location(value: XYZ) {
        gc((c) => {
            this.line.setLocation(c(toPnt(value)));
        });
    }
}

export class OccConic extends OccCurve implements IConic {
    constructor(private conioc: Geom_Conic) {
        super(conioc);
    }
    get axis(): XYZ {
        return gc((c) => {
            return toXYZ(c(c(this.conioc.axis()).direction()));
        });
    }
    get xAxis(): XYZ {
        return gc((c) => {
            return toXYZ(c(c(this.conioc.xAxis()).direction()));
        });
    }
    get yAxis(): XYZ {
        return gc((c) => {
            return toXYZ(c(c(this.conioc.yAxis()).direction()));
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
            return toXYZ(c(this.circle.location()));
        });
    }

    set center(value: XYZ) {
        gc((c) => {
            this.circle.setLocation(c(toPnt(value)));
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
            return toXYZ(c(this.ellipse.location()));
        });
    }
    set center(value: XYZ) {
        gc((c) => {
            this.ellipse.setLocation(c(toPnt(value)));
        });
    }

    get focus1(): XYZ {
        return gc((c) => toXYZ(c(this.ellipse.focus1())));
    }
    get focus2(): XYZ {
        return gc((c) => toXYZ(c(this.ellipse.focus2())));
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
            return toXYZ(c(this.hyperbola.location()));
        });
    }
    set location(value: XYZ) {
        gc((c) => {
            this.hyperbola.setLocation(c(toPnt(value)));
        });
    }

    get focus1(): XYZ {
        return gc((c) => toXYZ(c(this.hyperbola.focus1())));
    }
    get focus2(): XYZ {
        return gc((c) => toXYZ(c(this.hyperbola.focus2())));
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
        return gc((c) => toXYZ(c(this.parabola.focus())));
    }

    get directrix() {
        return gc((c) => toXYZ(c(c(this.parabola.directrix().location()))));
    }
}

export class OccBoundedCurve extends OccCurve implements IBoundedCurve {
    constructor(private boundedCurve: Geom_BoundedCurve) {
        super(boundedCurve);
    }

    startPoint(): XYZ {
        return gc((c) => toXYZ(c(this.boundedCurve.startPoint())));
    }

    endPoint(): XYZ {
        return gc((c) => toXYZ(c(this.boundedCurve.endPoint())));
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
            const curve = c(this.trimmedCurve.basisCurve());
            return OccCurve.wrap(curve.get()!);
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
            const curve = c(this.offsetCurve.basisCurve());
            return OccCurve.wrap(curve.get()!);
        });
        return this._basisCurve;
    }

    offset(): number {
        return this.offsetCurve.offset();
    }

    direction(): XYZ {
        return gc((c) => toXYZ(c(this.offsetCurve.direction())));
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
                this.bezier.insertPoleAfter(index, c(toPnt(point)));
            } else {
                this.bezier.insertPoleAfterWithWeight(index, c(toPnt(point)), weight);
            }
        });
    }

    insertPoleBefore(index: number, point: XYZ, weight: number | undefined): void {
        gc((c) => {
            if (weight === undefined) {
                this.bezier.insertPoleBefore(index, c(toPnt(point)));
            } else {
                this.bezier.insertPoleBeforeWithWeight(index, c(toPnt(point)), weight);
            }
        });
    }

    removePole(index: number): void {
        this.bezier.removePole(index);
    }

    setPole(index: number, point: XYZ, weight: number | undefined): void {
        gc((c) => {
            if (weight === undefined) {
                this.bezier.setPole(index, c(toPnt(point)));
            } else {
                this.bezier.setPoleWithWeight(index, c(toPnt(point)), weight);
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
        return gc((c) => toXYZ(c(this.bezier.pole(index))));
    }

    degree(): number {
        return this.bezier.degree();
    }

    poles(): XYZ[] {
        return gc((c) => {
            const result: XYZ[] = [];
            const pls = c(this.bezier.getPoles());
            for (let i = 1; i <= pls.length(); i++) {
                result.push(toXYZ(c(pls.value(i))));
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
        return gc((c) => toXYZ(c(this.bspline.pole(index))));
    }
    poles(): XYZ[] {
        return gc((c) => {
            const result: XYZ[] = [];
            const pls = c(this.bspline.getPoles());
            for (let i = 1; i <= pls.length(); i++) {
                result.push(toXYZ(c(pls.value(i))));
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
