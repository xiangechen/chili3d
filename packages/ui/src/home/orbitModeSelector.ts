// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Config, type I18nKeys, Localize, type OrbitMode, OrbitModes } from "@chili3d/core";
import { type HTMLProps, option, select } from "@chili3d/element";

const OrbitModeLabels: Record<OrbitMode, I18nKeys> = {
    turntable: "common.orbitMode.turntable",
    trackball: "common.orbitMode.trackball",
};

export const OrbitModeSelector = (props: HTMLProps<HTMLElement>) => {
    const orbitModes: HTMLOptionElement[] = [];
    for (const orbitMode of OrbitModes) {
        orbitModes.push(
            option({
                selected: orbitMode === Config.instance.orbitMode,
                textContent: new Localize(OrbitModeLabels[orbitMode]),
                value: orbitMode,
            }),
        );
    }
    return select(
        {
            onchange: (e) => {
                const orbitMode = (e.target as HTMLSelectElement).value as OrbitMode;
                Config.instance.orbitMode = orbitMode;
            },
            ...props,
        },
        ...orbitModes,
    );
};
