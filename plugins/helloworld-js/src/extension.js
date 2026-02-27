const { CommandStore, PubSub } = ChiliAPI;

class HelloWorldCommand {
    execute(app) {
        PubSub.default.pub("showToast", "demo.hello.message");

        return Promise.resolve();
    }
}

CommandStore.registerCommand(HelloWorldCommand, {
    key: "demo.hello",
    icon: {
        type: "plugin",
        path: "icons/hello.svg",
    },
});

const DemoPlugin = {
    commands: [HelloWorldCommand],
    ribbons: [
        {
            tabName: "ribbon.tab.tools",
            groups: [
                {
                    groupName: "ribbon.group.other",
                    items: ["demo.hello"],
                },
            ],
        },
    ],
    i18nResources: [
        {
            language: "en",
            display: "English",
            translation: {
                "command.demo.hello": "Plugin Demo",
                "demo.hello.message": "Hello, This is a demo plugin!",
            },
        },
        {
            language: "zh-CN",
            display: "简体中文",
            translation: {
                "command.demo.hello": "插件示例",
                "demo.hello.message": "你好，这是一个演示插件！",
            },
        },
    ],
};

export default DemoPlugin;
