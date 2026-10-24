// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { AsyncController } from "@chili3d/core";

/**
 * A FRESH controller for one pick/drag round run under `controller`. A settled controller
 * replays its result to every listener registered later (`AsyncController.addListener`), so
 * running a second pick on the caller's own controller would resolve instantly with whatever
 * the previous round left — answering an empty pick the user never made. The round bridges
 * cancel and fail from the caller; success stays the round's own to give.
 *
 * No off() exists: the bridges live as long as the caller's controller and fire into the
 * settled round, doing nothing.
 */
export function bridgedRound(controller: AsyncController): AsyncController {
    const round = new AsyncController();
    controller.onCancelled(() => round.cancel());
    controller.onFailed(() => round.fail());
    return round;
}
