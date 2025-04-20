// 定义一个异步函数来生成请求选项并发送请求
export async function send_to_llm(mycontent: String): Promise<string> {
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
        // console.log(result); // 可选：打印日志以便调试
        return result;
    } catch (error) {
        console.error("Error in send_to_llm:", error);
        throw error; // 将错误抛出以便调用方处理
    }
}
