// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    CancelableCommand,
    command,
    type IApplication,
    isCancelableCommand,
} from "@chili3d/core";
import type { ParametricBodyNode } from "../parametricBodyNode";

/**
 * Runs a feature-row reselect pick (see `ParametricBodyNode.reselectSession`) as a
 * proper command. The session needs its target body and feature, so it is not
 * constructed through the CommandStore's parameterless path — `start` publishes it
 * as the application's executing command instead. That registration is what makes
 * CommandService cancel the pick (awaiting its cleanup — the rollback preview and
 * the disabled history are always restored before the new command runs) when the
 * user starts any other command mid-pick, instead of stomping the viewport event
 * handler and writing model changes into the pick's disabled history.
 */
@command({ key: "feature.reselect", icon: "icon-sync-alt" })
export class ReselectFeatureCommand extends CancelableCommand {
    constructor(
        private readonly body?: ParametricBodyNode,
        private readonly featureId?: string,
    ) {
        super();
    }

    protected override async executeAsync(): Promise<void> {
        // A parameterless construction (e.g. a stray `executeCommand` publish) has
        // nothing to re-pick — the store registration exists so the command
        // context panel can resolve this command's icon and title.
        if (this.body === undefined || this.featureId === undefined) return;
        this.controller = new AsyncController();
        await this.body.reselectSession(this.featureId, this.controller);
    }

    /**
     * Launches the session outside the CommandStore. Mirrors CommandService's
     * guard: a running cancelable command (including a previous reselect) is
     * cancelled first, a non-cancelable one refuses the start. `executingCommand`
     * is cleared only when it still holds this command — a command started via
     * CommandService in the meantime (which cancelled this one and awaited its
     * cleanup) owns the slot.
     */
    static async start(body: ParametricBodyNode, featureId: string): Promise<void> {
        const app = body.document.application;
        const running = app.executingCommand;
        if (running !== undefined) {
            if (!isCancelableCommand(running)) return;
            await running.cancel();
        }
        await ReselectFeatureCommand.run(app, new ReselectFeatureCommand(body, featureId));
    }

    private static async run(app: IApplication, command: ReselectFeatureCommand): Promise<void> {
        app.executingCommand = command;
        try {
            await command.execute(app);
        } finally {
            if (app.executingCommand === command) app.executingCommand = undefined;
        }
    }
}
