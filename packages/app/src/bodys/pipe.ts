// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type I18nKeys,
    type IDocument,
    type IEdge,
    type IShape,
    type IWire,
    MathUtils,
    ParameterShapeNode,
    Plane,
    Precision,
    property,
    Result,
    ShapeTypes,
    serializable,
    serialize,
    type XYZ,
} from "@chili3d/core";

export interface PipeOptions {
    document: IDocument;
    radius: number;
    path: IWire | IEdge;
    bendRadius?: number;
    thickness?: number;
}

@serializable()
export class PipeNode extends ParameterShapeNode {
    override display(): I18nKeys {
        return "body.pipe" as I18nKeys;
    }

    @serialize()
    @property("circle.radius")
    get radius() {
        return this.getPrivateValue("radius");
    }
    set radius(value: number) {
        this.setPropertyEmitShapeChanged("radius", value);
    }

    @serialize()
    get path() {
        return this.getPrivateValue("path");
    }
    set path(value: IWire) {
        this.setPropertyEmitShapeChanged("path", value);
    }

    @serialize()
    @property("pipe.bendRadius")
    get bendRadius() {
        return this.getPrivateValue("bendRadius", 0);
    }
    set bendRadius(value: number) {
        this.setPropertyEmitShapeChanged("bendRadius", value);
    }

    @serialize()
    @property("option.command.thickness")
    get thickness() {
        return this.getPrivateValue("thickness", 0);
    }
    set thickness(value: number) {
        this.setPropertyEmitShapeChanged("thickness", value);
    }

    constructor(options: PipeOptions) {
        super(options);
        if (!options.path) console.error("PipeNode: path is null");
        if (options.radius <= 0) console.error("PipeNode: radius must be > 0", options.radius);
        this.setPrivateValue("radius", options.radius);
        this.setPrivateValue("path", this.ensureWire(options.path));
        if (options.bendRadius !== undefined) {
            this.setPrivateValue("bendRadius", options.bendRadius);
        }
        if (options.thickness !== undefined) {
            this.setPrivateValue("thickness", options.thickness);
        }
    }

    override generateShape(): Result<IShape> {
        const path = this.path;
        if (!path) return Result.err("Path is null");

        const edges = path.edgeLoop();
        if (edges.length === 0) return Result.err("Path has no edges");

        const { bendR, isNative } = this.resolveBendRadius();
        const pathForSweep = this.createFilletedPath(path, bendR);

        const planeResult = this.createSweepPlane(pathForSweep);
        if (!planeResult.isOk) return Result.err(planeResult.error);
        const plane = planeResult.value;

        const profileWire = this.createProfileWire(plane);
        if (!profileWire.isOk) return profileWire;

        const sweepResult = shapeFactory.sweep([profileWire.value], pathForSweep, isNative);
        if (!sweepResult.isOk) return sweepResult;

        return this.applyHollow(sweepResult, plane, pathForSweep, isNative);
    }

    private resolveBendRadius(): { bendR: number; isNative: boolean } {
        let bendR = this.bendRadius;
        const isNative = bendR === -1;

        if (!isNative && bendR > 0 && bendR < this.radius + Precision.Distance) {
            bendR = this.radius + 1.0;
        }
        return { bendR, isNative };
    }

    private createFilletedPath(path: IWire, bendR: number): IWire {
        if (bendR <= 0 || path.edgeLoop().length < 2) {
            return path;
        }

        const builder = new WireFilletBuilder();
        const filleted = builder.build(path, bendR);
        if (filleted.isOk) {
            return filleted.value;
        }

        console.error("Path fillet failed", filleted.error);
        return path;
    }

    private createSweepPlane(path: IWire): Result<Plane> {
        const firstEdge = path.edgeLoop()[0];
        const curve = firstEdge.curve;
        const d1 = curve.d1(curve.firstParameter());
        const dir = d1.vec.normalize();

        if (!dir) {
            return Result.err("Invalid path direction");
        }

        let xVec = dir.cross(Plane.XY.normal).normalize();
        if (!xVec || dir.isParallelTo(Plane.XY.normal)) {
            xVec = Plane.ZX.normal;
        }

        const plane = new Plane({ origin: d1.point, normal: dir, xvec: xVec });
        return Result.ok(plane);
    }

    private createProfileWire(plane: Plane): Result<IWire> {
        const profileResult = shapeFactory.circle(plane.normal, plane.origin, this.radius);
        if (!profileResult.isOk) return Result.err(profileResult.error);

        const profileWireResult = shapeFactory.wire([profileResult.value]);
        if (!profileWireResult.isOk) return Result.err(profileWireResult.error);

        return profileWireResult;
    }

    private applyHollow(
        solidResult: Result<IShape>,
        plane: Plane,
        pathForSweep: IWire,
        isNative: boolean,
    ): Result<IShape> {
        const thickness = this.thickness;
        if (thickness <= 0) return solidResult;
        if (!solidResult.isOk) return solidResult;

        if (thickness >= this.radius) {
            return Result.err("Thickness must be less than Radius");
        }

        const innerRadius = this.radius - thickness;
        const innerCircleRes = shapeFactory.circle(plane.normal, plane.origin, innerRadius);
        if (!innerCircleRes.isOk) return solidResult;

        const innerWireRes = shapeFactory.wire([innerCircleRes.value]);
        if (!innerWireRes.isOk) return solidResult;

        const innerSweepRes = shapeFactory.sweep([innerWireRes.value], pathForSweep, isNative);
        if (!innerSweepRes.isOk) return solidResult;

        const hollowResult = shapeFactory.booleanCut([solidResult.value], [innerSweepRes.value]);
        return hollowResult.isOk ? hollowResult : solidResult;
    }

    private ensureWire(path: IEdge | IWire) {
        let wire = path as IWire;
        if (path.shapeType !== ShapeTypes.wire) {
            wire = shapeFactory.wire([path as unknown as IEdge]).value;
        }
        return wire;
    }
}

export class WireFilletBuilder {
    build(path: IWire, radius: number): Result<IWire> {
        const edges = path.edgeLoop();
        if (edges.length < 2 || radius <= Precision.Distance) {
            return Result.ok(path);
        }

        const vertices = this.extractVertices(edges);
        const filletedEdges: IEdge[] = [];
        let prevPoint = vertices[0];

        for (let i = 1; i < vertices.length - 1; i++) {
            const geom = this.tryComputeFillet(vertices[i], vertices[i - 1], vertices[i + 1], radius);
            if (geom) {
                prevPoint = this.buildFilletArc(prevPoint, vertices[i], geom, filletedEdges);
            } else {
                this.addLineSegment(prevPoint, vertices[i], filletedEdges);
                prevPoint = vertices[i];
            }
        }

        this.addLineSegment(prevPoint, vertices[vertices.length - 1], filletedEdges);
        return shapeFactory.wire(filletedEdges);
    }

    private extractVertices(edges: IEdge[]): XYZ[] {
        const vertices: XYZ[] = [];
        const firstCurve = edges[0].curve;
        vertices.push(firstCurve.value(firstCurve.firstParameter()));
        for (const e of edges) {
            const c = e.curve;
            vertices.push(c.value(c.lastParameter()));
        }
        return vertices;
    }

    private computeCornerDirs(
        V: XYZ,
        P_prev: XYZ,
        P_next: XYZ,
    ): { u: XYZ; v: XYZ; angle: number; halfAngle: number } | null {
        const u = P_prev.sub(V).normalize();
        const v = P_next.sub(V).normalize();

        if (!u || !v || u.isParallelTo(v) || u.isOppositeTo(v, Precision.Angle)) {
            return null;
        }

        const angle = u.angleTo(v);
        if (!angle || Math.abs(angle - Math.PI) < Precision.Angle) {
            return null;
        }

        return { u, v, angle, halfAngle: angle / 2 };
    }

    private tryComputeFillet(V: XYZ, P_prev: XYZ, P_next: XYZ, radius: number): FilletCornerGeometry | null {
        const dirs = this.computeCornerDirs(V, P_prev, P_next);
        if (!dirs) return null;

        const { u, v, angle, halfAngle } = dirs;
        let tangentLen = radius / Math.tan(halfAngle);

        // Clamp to prevent self-intersection
        const maxLen = Math.min(V.distanceTo(P_prev), V.distanceTo(P_next)) / 2.05;
        if (tangentLen > maxLen) tangentLen = maxLen;

        const arcStart = V.add(u.multiply(tangentLen));
        const distCenter = tangentLen / Math.cos(halfAngle);
        const bisector = u.add(v).normalize();
        if (!bisector) return null;
        const center = V.add(bisector.multiply(distCenter));

        const normal = v.cross(u).normalize();
        if (!normal) return null;

        const arcAngleDeg = 180 - MathUtils.radToDeg(angle);
        return { u, v, angle, halfAngle, tangentLen, arcStart, center, normal, arcAngleDeg };
    }

    private buildFilletArc(prevPoint: XYZ, V: XYZ, geom: FilletCornerGeometry, outEdges: IEdge[]): XYZ {
        this.addLineSegment(prevPoint, geom.arcStart, outEdges);

        const arcRes = shapeFactory.arc(geom.normal, geom.center, geom.arcStart, geom.arcAngleDeg);
        if (arcRes.isOk) {
            outEdges.push(arcRes.value);
            const arcCurve = arcRes.value.curve;
            return arcCurve.value(arcCurve.lastParameter());
        }

        // Fallback: connect to corner vertex
        this.addLineSegment(prevPoint, V, outEdges);
        return V;
    }

    private addLineSegment(from: XYZ, to: XYZ, outEdges: IEdge[]): void {
        if (from.distanceTo(to) > Precision.Distance) {
            const lineRes = shapeFactory.line(from, to);
            if (lineRes.isOk) {
                outEdges.push(lineRes.value);
            }
        }
    }
}

interface FilletCornerGeometry {
    u: XYZ;
    v: XYZ;
    angle: number;
    halfAngle: number;
    tangentLen: number;
    arcStart: XYZ;
    center: XYZ;
    normal: XYZ;
    arcAngleDeg: number;
}
