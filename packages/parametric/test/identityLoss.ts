// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { identityLosses } from "../src/features/idDiagnostics";

/**
 * The identity losses recorded so far, drained.
 *
 * A test that DELIBERATELY provokes a loss — the tests of the reporters themselves, or of a
 * guard that is supposed to report — must claim what it produced here. The global guard
 * (`setup.ts`) fails every test that leaves a loss unclaimed, which is what makes it a
 * contract rather than a log line.
 */
export function claimIdentityLosses(): string[] {
    return identityLosses.splice(0);
}
