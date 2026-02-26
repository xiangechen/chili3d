// Demo command for the plugin
// Shows a hello world message

import { command, type I18nKeys, type IApplication, type ICommand, PubSub } from "chili-api";

@command({
    key: "demo.hello" as any,
    icon: "icons/hello.svg",
    helpText: "demo.hello.description" as any,
})
export class HelloWorldCommand implements ICommand {
    execute(application: IApplication): Promise<void> {
        PubSub.default.pub("showToast", "demo.hello.message" as I18nKeys);

        return Promise.resolve();
    }
}
