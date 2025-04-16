// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { I18n, I18nKeys, Plane, Ray, XYZ } from "chili-core";

export class Axis extends Ray {
    constructor(
        location: XYZ,
        direction: XYZ,
        readonly name: string,
    ) {
        super(location, direction);
    }

    static getAxiesAtPlane(location: XYZ, plane: Plane, containsZ: boolean) {
        const createAxis = (direction: XYZ, name: I18nKeys) =>
            new Axis(location, direction, I18n.translate(name));

        const axies = [
            createAxis(plane.xvec, "axis.x"),
            createAxis(plane.xvec.reverse(), "axis.x"),
            createAxis(plane.yvec, "axis.y"),
            createAxis(plane.yvec.reverse(), "axis.y"),
        ];

        if (containsZ) {
            axies.push(createAxis(plane.normal, "axis.z"), createAxis(plane.normal.reverse(), "axis.z"));
        }

        return axies;
    }
}
