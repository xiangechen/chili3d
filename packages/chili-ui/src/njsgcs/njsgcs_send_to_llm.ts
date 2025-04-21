import { Logger } from "chili-core";
export class njsgcs_Send_to_llm {
    static async send_to_llm(mycontent: string, callback: (backresult: string) => void): Promise<void> {
        Logger.info("llm接收到点击事件，参数：" + mycontent);
        const myHeaders = new Headers();
        myHeaders.append("Authorization", "Bearer sk-240e8a769152439594a0c4c17618db9c");
        myHeaders.append("Content-Type", "application/json");

        const raw = JSON.stringify({
            messages: [
                { content: mycontent, role: "user" },
                { content: "you are a helpful assistant", role: "system" },
            ],
            model: "deepseek-chat",
        });

        const requestOptions: RequestInit = {
            method: "POST",
            headers: myHeaders,
            body: raw,
            redirect: "follow" as RequestRedirect,
        };

        try {
            const response = await fetch("https://api.deepseek.com/v1/chat/completions", requestOptions);
            if (!response.ok) {
                throw new Error(`HTTP error! Status: ${response.status}`);
            }

            const result = await response.text();
            const jsonResponse = JSON.parse(result);
            let content_response: string = jsonResponse.choices[0].message.content;
            Logger.info("llm返回结果:" + content_response);
            // 调用 callback 并返回其结果
            callback(content_response);
        } catch (error) {
            console.error("Error in send_to_llm:", error);
            throw error; // 将错误抛出以便调用方处理
        }
    }
}
