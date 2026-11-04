// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { capacityAt, KIT } from "../modules/craneModel";

export type LiftCase = {
    boomLengthM: number;
    radiusM: number;
};

export function createLiftSummary(lift: LiftCase): string {
    const capacityT = capacityAt(lift.boomLengthM, lift.radiusM);
    const capacityText = capacityT === null ? "not permitted / outside chart" : `${capacityT.toFixed(1)} t`;
    return (
        `${KIT.name}: ${capacityText} at ${lift.boomLengthM} m boom / ${lift.radiusM} m radius. ` +
        "Planning aid, not a certified lift plan."
    );
}
