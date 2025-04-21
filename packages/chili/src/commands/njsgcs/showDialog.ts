import { command, IApplication, ICommand, Logger, PubSub } from "chili-core";
// 定义类并实现 ICommand 接口
@command({
    name: "njsgcs_showDialog",
    display: "njsgcs_showDialog", // 替换为合法的枚举值或扩展枚举
    icon: "njsgcs_showDialog",
})
export class showDialog implements ICommand {
    // 实现 execute 方法
    async execute(app: IApplication): Promise<void> {
        Logger.info("njsqcs.test!!!!!!!!!!!!!!!");

        PubSub.default.pub("njsgcs_showDialog");
    }
}
