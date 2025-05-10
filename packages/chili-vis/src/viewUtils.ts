// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { IView, Plane, Precision, Ray, XYZ } from "chili-core";

export class ViewUtils {
    static rayFromEye(view: IView, point: XYZ) {
        const cameraPosition = view.cameraController.cameraPosition;
        const vector = point.sub(cameraPosition);
        if (view.cameraController.cameraType === "orthographic") {
            const direction = view.direction();
            const dot = vector.dot(direction);
            const location = point.sub(direction.multiply(dot));
            return new Ray(location, direction);
        } else {
            return new Ray(cameraPosition, vector);
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
            return new Plane(plane.origin, direction, left);
        }
        return plane;
    }

    static raycastClosestPlane(view: IView, start: XYZ, end: XYZ): Plane {
        const direction = view.direction();
        if (Math.abs(direction.dot(view.workplane.normal)) < Precision.Float) {
            const left = direction.cross(view.up());
            return new Plane(start, direction, left);
        }

        const ray = ViewUtils.rayFromEye(view, end);
        const planes = [
            new Plane(start, XYZ.unitZ, XYZ.unitX),
            new Plane(start, XYZ.unitX, XYZ.unitY),
            new Plane(start, XYZ.unitY, XYZ.unitZ),
        ];

        const distances = planes.map((p) => p.intersect(ray)?.distanceTo(start));
        let result: [Plane, number | undefined] = [planes[0], distances[0]];
        for (let i = 1; i < distances.length; i++) {
            if (distances[i] === undefined) continue;

            if (result[1] === undefined || Math.abs(distances[i]!) < Math.abs(result[1])) {
                result = [planes[i], distances[i]];
            }
        }

        return result[0];
    }
}
