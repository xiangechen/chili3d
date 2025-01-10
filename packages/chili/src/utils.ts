// Copyright 2022-2023 the Chili authors. All rights reserved. AGPL-3.0 license.

import { I18n, IApplication, PubSub, Transaction } from "chili-core";

export async function importFiles(application: IApplication, files: File[] | FileList) {
    let document = application.activeView?.document ?? (await application.newDocument("Untitled"));
    PubSub.default.pub(
        "showPermanent",
        async () => {
            await Transaction.excuteAsync(document, "import model", async () => {
                await document.application.dataExchange.import(document, files);
            });
            await document.application.activeView?.fitContent();
        },
        "toast.excuting{0}",
        I18n.translate("command.import"),
    );
}
