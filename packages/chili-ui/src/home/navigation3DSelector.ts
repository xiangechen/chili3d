// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { type HTMLProps, option, select } from "chili-controls";
import { Config, Navigation3D } from "chili-core";

export const Navigation3DSelector = (props: HTMLProps<HTMLElement>) => {
    const nav3DTypes: HTMLOptionElement[] = [];
    Navigation3D.types.forEach((nav3DType, index) =>
        nav3DTypes.push(
            option({
                selected: index === Config.instance.navigation3DIndex,
                textContent: nav3DType,
            }),
        ),
    );
    return select(
        {
            onchange: (e) => {
                const nav3DType = (e.target as HTMLSelectElement).selectedIndex;
                Config.instance.navigation3DIndex = nav3DType;
            },
            ...props,
        },
        ...nav3DTypes,
    );
};
