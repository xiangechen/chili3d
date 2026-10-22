// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { ConstraintKind, datumIsSigned } from "../../src/sketch/sketchModel";

describe("datumIsSigned", () => {
    // The dialogs refuse a minus sign for everything else, so this is the one place that
    // decides it — the tools used to write the set of kinds out for themselves.
    test.each([
        [ConstraintKind.P2LDistance, true],
        [ConstraintKind.HorizontalDistance, true],
        [ConstraintKind.VerticalDistance, true],
        [ConstraintKind.Fix, true],
        [ConstraintKind.P2PDistance, false],
        [ConstraintKind.Radius, false],
        [ConstraintKind.Angle, false],
    ])("%s is signed: %s", (kind, signed) => {
        expect(datumIsSigned(kind)).toBe(signed);
    });
});
