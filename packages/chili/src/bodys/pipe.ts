// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    type I18nKeys,
    type IDocument,
    type IEdge,
    type IShape,
    type IWire,
    ParameterShapeNode,
    Plane,
    Precision,
    property,
    Result,
    ShapeType,
    serializable,
    serialze,
} from "chili-core";
import { WireFilletBuilder } from "./utils/WireFilletBuilder";

@serializable(["document", "radius", "path", "bendRadius", "thickness"])
export class PipeNode extends ParameterShapeNode {
    override display(): I18nKeys {
        return "body.pipe" as I18nKeys;
    }

    @serialze()
    @property("circle.radius")
    get radius() {
        return this.getPrivateValue("radius");
    }
    set radius(value: number) {
        this.setPropertyEmitShapeChanged("radius", value);
    }

    @serialze()
    get path() {
        return this.getPrivateValue("path");
    }
    set path(value: IWire) {
        this.setPropertyEmitShapeChanged("path", value);
    }

    @serialze()
    @property("pipe.bendRadius")
    get bendRadius() {
        return this.getPrivateValue("bendRadius", 0);
    }
    set bendRadius(value: number) {
        this.setPropertyEmitShapeChanged("bendRadius", value);
    }

    @serialze()
    @property("option.command.thickness")
    get thickness() {
        return this.getPrivateValue("thickness", 0);
    }
    set thickness(value: number) {
        this.setPropertyEmitShapeChanged("thickness", value);
    }

    constructor(document: IDocument, radius: number, path: IWire | IEdge) {
        super(document);
        if (!path) console.error("PipeNode: path is null");
        if (radius <= 0) console.error("PipeNode: radius must be > 0", radius);
        this.setPrivateValue("radius", radius);
        this.setPrivateValue("path", this.ensureWire(path));
    }

    private ensureWire(path: IEdge | IWire) {
        let wire = path as IWire;
        if (path.shapeType !== ShapeType.Wire) {
            wire = this.document.application.shapeFactory.wire([path as unknown as IEdge]).value;
        }
        return wire;
    }

    override generateShape(): Result<IShape> {
        const path = this.path;
        if (!path) return Result.err("Path is null");
        const edges = path.edgeLoop();
        if (edges.length === 0) return Result.err("Path has no edges");

        let bendR = this.bendRadius;
        const isNative = bendR === -1;

        if (!isNative && bendR > 0 && bendR < this.radius + Precision.Distance) {
            bendR = this.radius + 1.0; // Minimal buffer
        }

        let pathForSweep = path;
        if (!isNative && bendR > 0 && path.edgeLoop().length >= 2) {
            const builder = new WireFilletBuilder(this.document.application.shapeFactory);
            const filleted = builder.build(path, bendR);

            if (filleted.isOk) {
                pathForSweep = filleted.value;
            } else {
                console.error("Path fillet failed", filleted.error);
            }
        }

        const firstEdge = edges[0];
        const curve = firstEdge.curve;
        const u0 = curve.firstParameter();
        const d1 = curve.d1(u0);
        const start = d1.point;
        const dir = d1.vec.normalize();

        if (!dir) return Result.err("Invalid path direction");

        // Calculate X, Y for plane
        let xVec = dir.cross(Plane.XY.normal).normalize();
        if (dir.isParallelTo(Plane.XY.normal) || !xVec) {
            xVec = Plane.ZX.normal;
        }

        const plane = new Plane(start, dir, xVec!);

        const profileResult = this.document.application.shapeFactory.circle(
            plane.normal,
            plane.origin,
            this.radius,
        );
        if (!profileResult.isOk) return profileResult;

        const profileEdge = profileResult.value;
        const profileWireResult = this.document.application.shapeFactory.wire([profileEdge]);
        if (!profileWireResult.isOk) return profileWireResult;

        const profile = profileWireResult.value;
        const sweepResult = this.document.application.shapeFactory.sweep([profile], pathForSweep, isNative);
        if (!sweepResult.isOk) {
            return sweepResult;
        }
        const thickness = this.thickness;
        if (thickness > 0) {
            if (thickness >= this.radius) {
                return Result.err("Thickness must be less than Radius");
            }

            const innerRadius = this.radius - thickness;

            const innerCircleResult = this.document.application.shapeFactory.circle(
                plane.normal,
                plane.origin,
                innerRadius,
            );
            if (!innerCircleResult.isOk) {
                return sweepResult;
            }

            const innerWireResult = this.document.application.shapeFactory.wire([innerCircleResult.value]);
            if (!innerWireResult.isOk) {
                return sweepResult;
            }

            const innerSweepResult = this.document.application.shapeFactory.sweep(
                [innerWireResult.value],
                pathForSweep,
                isNative,
            );
            if (!innerSweepResult.isOk) {
                return sweepResult; // Fallback to solid
            }

            console.log("PipeNode: Performing boolean cut (outer - inner)");
            const hollowResult = this.document.application.shapeFactory.booleanCut(
                [sweepResult.value],
                [innerSweepResult.value],
            );
            if (hollowResult.isOk) {
                return hollowResult;
            }
        }

        return sweepResult;
    }
}
