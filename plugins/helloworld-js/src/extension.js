const { CommandStore, PubSub } = ChiliAPI;

class HelloWorldJSCommand {
    execute(app) {
        PubSub.default.pub("showToast", "demo.hello.message");

        return Promise.resolve();
    }
}

CommandStore.registerCommand(HelloWorldJSCommand, {
    key: "jsdemo.hello",
    icon: {
        type: "path",
        value: "icons/hello.svg",
    },
});

const DemoPlugin = {
    commands: [HelloWorldJSCommand],
    ribbons: [
        {
            tabName: "ribbon.tab.tools",
            groups: [
                {
                    groupName: "ribbon.group.other",
                    items: ["jsdemo.hello"],
                },
            ],
        },
    ],
    i18nResources: [
        {
            language: "en",
            display: "English",
            translation: {
                "command.jsdemo.hello": "JS Plugin",
                "demo.hello.message": "Hello, This is a demo plugin!",
            },
        },
        {
            language: "zh-CN",
            display: "简体中文",
            translation: {
                "command.jsdemo.hello": "JS插件",
                "demo.hello.message": "你好，这是一个演示插件！",
            },
        },
    ],
};

export default DemoPlugin;
