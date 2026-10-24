// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { I18nKeys } from "@chili3d/core";

/**
 * The protcol between a command that carries a pick of its own (Press Pull) and the command it
 * hands over to.
 *
 * Press Pull's gesture makes the pick AND the confirm, so the target must not ask for both a second
 * time — it reads the selection as settled and builds. What "settled" means for the target's size is
 * the opener's business too: where it could translate the drag into that command's size it hands one
 * over (through the property cache, `CancelableCommand.seedOptions`), and the target then leaves that
 * size alone; where it could not, it opens the pick instead and the target fills the size in from
 * what it is editing.
 */
export interface PickSettledCommand {
    pickSettled?: boolean;
}

/**
 * The second half of the hand-off: the target was opened by Press Pull, so the drag it is
 * given IS the push-pull and its end decides the boolean operation.
 *
 * `pickSettled` cannot carry this. It says the target's own pick was answered, which is true
 * for a face drag — but false when a whole sketch was picked as a NODE, where the target still
 * runs its own depth drag. That drag is the push-pull all the same, so the opener marks it
 * separately rather than reusing a flag whose other meaning would also skip the drag.
 */
export interface PressPullHandoffCommand {
    pressPull: boolean;
    /**
     * The boolean operation the hand-off's own drag already judged, where it made one (a
     * sketch profile's push). Instance-side ON PURPOSE, not a seeded option: the option
     * cache outlives the gesture, and a cached join/cut would keep deciding later, unrelated
     * extrudes whose own reading never runs to correct it.
     */
    handoffOperation?: I18nKeys;
}

/** Whether `command` speaks the hand-off protocol. */
export function isPressPullHandoff(command: object): command is PressPullHandoffCommand {
    return "pressPull" in command;
}

/** Marks `command` as Press Pull's hand-off when it speaks the protocol. */
export function markPressPullHandoff(command: object): void {
    if (isPressPullHandoff(command)) command.pressPull = true;
}
