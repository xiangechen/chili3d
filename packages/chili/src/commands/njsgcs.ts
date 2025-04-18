import { command, IApplication, ICommand, Logger, PubSub } from "chili-core";

// 定义类并实现 ICommand 接口
@command({
    name: "njsgcs.test",
    display: "njsgcs.test", // 替换为合法的枚举值或扩展枚举
    icon: "njsqcs-test",
})
export class TestMy implements ICommand {
    // 实现 execute 方法
    async execute(app: IApplication): Promise<void> {
        Logger.info("njsqcs.test!!!!!!!!!!!!!!!");
        PubSub.default.pub("njsgcs_showDialog");
    }
}
