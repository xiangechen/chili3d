// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { identityLosses } from "../src/features/idDiagnostics";

// Rstest global setup file — registered in rstest.config.ts beside the core one, so the
// contract holds for every test file rather than only the parametric ones.

/**
 * Every identity loss recorded during a test fails that test.
 *
 * A loss means a reference that had to fall back to geometric matching because the sub-shape
 * it named carries no stable id — the tracking chain failed to name something it built. In
 * the app that is a console warning nobody reads; here it is a red suite. So an operation
 * that cannot name what it builds (a new feature, a new kernel channel that stopped
 * reporting history) shows up immediately, instead of surfacing later as a reference that
 * mysteriously stops following an edit.
 *
 * The sink is drained per test, so the failure is attributed to the test that caused it.
 * A diagnostic is NOT the same as an untracked chain: a chain that cannot track at all
 * reports nothing (see `reportSilentIdLoss`), which is a designed degradation, not a loss.
 */
afterEach(() => {
    expect(identityLosses.splice(0)).toEqual([]);
});
