// Demo command for the plugin
// Shows a hello world message

import { command, type I18nKeys, type IApplication, type ICommand, PubSub } from "@chili3d/core";

@command({
    key: "demo.hello" as any,
    icon: {
        type: "path",
        value: "icons/hello.svg",
    },
    helpText: "demo.hello.description" as any,
})
export class HelloWorldCommand implements ICommand {
    async execute(application: IApplication): Promise<void> {
        PubSub.default.pub("showToast", "demo.hello.message" as I18nKeys);

        const module = await import(/** webpackIgnore: true*/ "module1");
        module.module1_function1();

        return Promise.resolve();
    }
}
