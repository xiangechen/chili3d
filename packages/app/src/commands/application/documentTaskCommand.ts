// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { I18n, type I18nKeys, type IApplication, type ICommand, type IDocument, PubSub } from "@chili3d/core";

/**
 * A command that works on the active document under the permanent spinner, one run at a time.
 *
 * The in-flight guard belongs to the command rather than to `CommandService`: a subclass's
 * `execute` returns as soon as the spinner is published, while the work runs in the action
 * `Permanent` invokes later — a window the service's queue cannot see. A fresh instance is
 * created per execution, so the guard is keyed by the command class.
 */
export abstract class DocumentTaskCommand implements ICommand {
    private static readonly running = new Set<object>();

    /** The command's own name, shown while it runs (`command.*`). */
    protected abstract readonly message: I18nKeys;

    protected abstract run(document: IDocument): Promise<void>;

    async execute(app: IApplication): Promise<void> {
        const document = app.activeView?.document;
        if (!document) {
            PubSub.default.pub("showToast", "toast.document.noActivated");
            return;
        }

        // Set inside the action, not here: with no `showPermanent` subscriber the action never
        // runs, and a guard set here would never be released.
        const task: object = this.constructor;
        if (DocumentTaskCommand.running.has(task)) return;

        PubSub.default.pub(
            "showPermanent",
            async () => {
                DocumentTaskCommand.running.add(task);
                try {
                    await this.run(document);
                } finally {
                    DocumentTaskCommand.running.delete(task);
                }
            },
            "toast.excuting{0}",
            I18n.translate(this.message),
        );
    }
}
