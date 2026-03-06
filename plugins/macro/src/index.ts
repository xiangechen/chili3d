// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import type { CommandKeys, Plugin } from "@chili3d/core";
import { MacroCommand } from "./commands/macro";

const MacroPlugin: Plugin = {
    commands: [MacroCommand],
    ribbons: [
        {
            tabName: "ribbon.tab.tools",
            groups: [
                {
                    groupName: "ribbon.group.other",
                    items: ["macro.open" as CommandKeys],
                },
            ],
        },
    ],
    i18nResources: [
        {
            language: "en",
            display: "English",
            translation: {
                "command.macro.open": "Macro",
                "macro.description": "Open macro manager",
                "macro.manager.title": "Macro Manager",
                "macro.manager.new": "New",
                "macro.manager.edit": "Edit",
                "macro.manager.run": "Run",
                "macro.manager.delete": "Delete",
                "macro.manager.empty": "No macros yet. Click New to create one.",
                "macro.manager.executed": "Macro executed successfully",
                "macro.manager.error": "Macro execution error: ",
                "macro.editor.titleNew": "New Macro",
                "macro.editor.titleEdit": "Edit Macro",
                "macro.editor.name": "Name:",
                "macro.editor.namePlaceholder": "Enter macro name",
                "macro.editor.code": "Code:",
                "macro.editor.codePlaceholder": "Enter your macro code here...",
                "macro.editor.run": "Run",
                "macro.editor.nameRequired": "Macro name is required",
                "macro.editor.emptyCode": "Macro code is empty",
                "macro.editor.executed": "Macro executed successfully",
                "macro.editor.error": "Execution error: ",
            },
        } as any,
        {
            language: "zh-CN",
            display: "简体中文",
            translation: {
                "command.macro.open": "宏",
                "macro.description": "打开宏管理器",
                "macro.manager.title": "宏管理器",
                "macro.manager.new": "新建",
                "macro.manager.edit": "编辑",
                "macro.manager.run": "运行",
                "macro.manager.delete": "删除",
                "macro.manager.empty": "暂无宏，点击新建创建",
                "macro.manager.executed": "宏执行成功",
                "macro.manager.error": "宏执行错误: ",
                "macro.editor.titleNew": "新建宏",
                "macro.editor.titleEdit": "编辑宏",
                "macro.editor.name": "名称:",
                "macro.editor.namePlaceholder": "输入宏名称",
                "macro.editor.code": "代码:",
                "macro.editor.codePlaceholder": "在此输入宏代码...",
                "macro.editor.run": "运行",
                "macro.editor.nameRequired": "宏名称不能为空",
                "macro.editor.emptyCode": "宏代码不能为空",
                "macro.editor.executed": "宏执行成功",
                "macro.editor.error": "执行错误: ",
            },
        } as any,
    ],
};

export default MacroPlugin;
