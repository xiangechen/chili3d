// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Config } from "../config";
import { Precision } from "../foundation";
import { Line, MathUtils, Plane, XYZ } from "../math";
import type { IView } from "./view";

export class ViewUtils {
    /**
     * Sketch-plane units per screen pixel at viewport position (x, y), measured with
     * two rays — exact for both camera types, unlike `worldToScreen` which rounds to
     * whole pixels and collapses small spans at low zoom levels. Undefined when the
     * plane is off-ray or the span collapses.
     *
     * NOTE: the on-plane measure explodes like 1/cos(grazing) as the view turns
     * edge-on to the plane. For screen-constant graphics (annotation text, arrows,
     * pick tolerances) use `viewPixelSize` instead.
     */
    static worldPerPixel(view: IView, plane: Plane, x: number, y: number): number | undefined {
        const p0 = plane.intersectRay(view.rayAt(x, y));
        const p1 = plane.intersectRay(view.rayAt(x + 1, y));
        if (p0 === undefined || p1 === undefined) return undefined;
        const size = p0.distanceTo(p1);
        return size < 1e-12 ? undefined : size;
    }

    /**
     * World units per screen pixel at `point`, measured on the plane perpendicular to
     * the center ray through that point. Unlike `worldPerPixel` on the sketch plane
     * this stays bounded at any view angle — it depends only on the camera and the
     * depth of `point` — so screen-sized graphics foreshorten naturally with the
     * tilted sketch instead of ballooning as the view turns edge-on.
     */
    static viewPixelSize(view: IView, point: XYZ): number | undefined {
        const cx = view.width / 2;
        const cy = view.height / 2;
        // the center ray, not view.direction(): the measure must come from the same
        // ray family it samples (the two agree on a real camera)
        const direction = view.rayAt(cx, cy).direction;
        let xvec = direction.cross(view.up());
        if (xvec.lengthSq() < 1e-12) {
            // looking straight along the up axis — pick any perpendicular
            xvec = direction.cross(Math.abs(direction.dot(XYZ.unitX)) < 0.9 ? XYZ.unitX : XYZ.unitY);
        }
        const facing = new Plane({ origin: point, normal: direction, xvec });
        return ViewUtils.worldPerPixel(view, facing, cx, cy);
    }

    static rayFromEye(view: IView, point: XYZ) {
        const cameraPosition = view.cameraController.cameraPosition;
        const vector = point.sub(cameraPosition);
        if (view.cameraController.cameraType === "orthographic") {
            const direction = view.direction();
            const dot = vector.dot(direction);
            const location = point.sub(direction.multiply(dot));
            return new Line({ point: location, direction });
        } else {
            return new Line({ point: cameraPosition, direction: vector });
        }
    }

    static directionAt(view: IView, point: XYZ) {
        if (view.cameraController.cameraType === "orthographic") {
            return view.direction();
        } else {
            const cameraPosition = view.cameraController.cameraPosition;
            return point.sub(cameraPosition);
        }
    }

    static ensurePlane(view: IView, plane: Plane) {
        const direction = view.direction();
        if (Math.abs(direction.dot(plane.normal)) < Precision.Float) {
            const left = direction.cross(view.up());
            return new Plane({ origin: plane.origin, normal: direction, xvec: left });
        }
        return plane;
    }

    static raycastClosestPlane(view: IView, start: XYZ, end: XYZ): Plane {
        const direction = view.direction();
        if (
            !Config.instance.dynamicWorkplane &&
            Math.abs(direction.dot(view.workplane.normal)) < Precision.Float
        ) {
            const left = direction.cross(view.up());
            return new Plane({ origin: start, normal: direction, xvec: left });
        }

        const ray = ViewUtils.rayFromEye(view, end);
        const planes = [
            new Plane({ origin: start, normal: XYZ.unitZ, xvec: XYZ.unitX }),
            new Plane({ origin: start, normal: XYZ.unitX, xvec: XYZ.unitY }),
            new Plane({ origin: start, normal: XYZ.unitY, xvec: XYZ.unitZ }),
        ];
        const absDots = planes.map((p) => Math.abs(p.normal.dot(direction)));
        const distances = planes.map((p) => p.intersectLine(ray)?.distanceTo(start));
        let result: [Plane, number | undefined, number] = [planes[0], distances[0], absDots[0]];
        for (let i = 1; i < distances.length; i++) {
            if (distances[i] === undefined) continue;

            if (
                result[1] === undefined ||
                (MathUtils.almostEqual(distances[i]!, result[1]) && absDots[i]! > result[2]) ||
                Math.abs(distances[i]!) < Math.abs(result[1])
            ) {
                result = [planes[i], distances[i], absDots[i]];
            }
        }
        return result[0];
    }
}
