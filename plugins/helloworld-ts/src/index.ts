// Demo Plugin for Chili3D
// This plugin demonstrates the plugin system capabilities

import type { CommandKeys, Plugin } from "chili-api";
import { HelloWorldCommand } from "./commands/hello";

const DemoPlugin: Plugin = {
    commands: [HelloWorldCommand],
    ribbons: [
        {
            tabName: "ribbon.tab.tools",
            groups: [
                {
                    groupName: "ribbon.group.other",
                    items: ["demo.hello" as CommandKeys],
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
        } as any,
        {
            language: "zh-CN",
            display: "简体中文",
            translation: {
                "command.demo.hello": "插件示例",
                "demo.hello.message": "你好，这是一个演示插件！",
            },
        } as any,
    ],
};

export default DemoPlugin;
