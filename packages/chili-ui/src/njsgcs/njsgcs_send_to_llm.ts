import { Logger } from "chili-core";
import { API_KEY } from "./api_key";
export async function send_to_llm(bodystring: string): Promise<string> {
    Logger.info("llm接收到请求" + bodystring);
    const myHeaders = new Headers();
    myHeaders.append("Authorization", API_KEY);
    myHeaders.append("Content-Type", "application/json");

    const requestOptions: RequestInit = {
        method: "POST",
        headers: myHeaders,
        body: bodystring,
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
        return content_response;
    } catch (error) {
        console.error("Error in send_to_llm:", error);
        throw error; // 将错误抛出以便调用方处理
    }
}
