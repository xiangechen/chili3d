// Copyright 2022-2023 the Chili authors. All rights reserved. MPL-2.0 license.

import { i18n, Plane, Ray, XYZ } from "chili-core";

export class Axis extends Ray {
    constructor(location: XYZ, direction: XYZ, readonly name: string) {
        super(location, direction);
    }

    static getAxiesAtPlane(location: XYZ, plane: Plane, containsZ: boolean) {
        let axies = [
            new Axis(location, plane.x, i18n["axis.x"]),
            new Axis(location, plane.x.reverse(), i18n["axis.x"]),
            new Axis(location, plane.y, i18n["axis.y"]),
            new Axis(location, plane.y.reverse(), i18n["axis.y"]),
        ];
        if (containsZ) {
            axies.push(
                new Axis(location, plane.normal, i18n["axis.z"]),
                new Axis(location, plane.normal.reverse(), i18n["axis.z"])
            );
        }

        return axies;
    }
}
