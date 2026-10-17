// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

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
