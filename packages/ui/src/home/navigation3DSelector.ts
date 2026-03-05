// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Config, Navigation3DTypes } from "@chili3d/core";
import { type HTMLProps, option, select } from "@chili3d/element";

export const Navigation3DSelector = (props: HTMLProps<HTMLElement>) => {
    const nav3DTypes: HTMLOptionElement[] = [];
    Navigation3DTypes.forEach((nav3DType) =>
        nav3DTypes.push(
            option({
                selected: nav3DType === Config.instance.navigation3D,
                textContent: nav3DType,
            }),
        ),
    );
    return select(
        {
            onchange: (e) => {
                const index = (e.target as HTMLSelectElement).selectedIndex;
                Config.instance.navigation3D = Navigation3DTypes[index];
            },
            ...props,
        },
        ...nav3DTypes,
    );
};
