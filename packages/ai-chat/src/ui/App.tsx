import { useState } from "react";
import { ApiKeyGate } from "./ApiKeyGate";
import { ChatPanel } from "./ChatPanel";
import { type ApiKey, loadApiKey } from "./storage";

export function App() {
    const [apiKey, setApiKey] = useState<ApiKey | null>(() => loadApiKey());
    if (!apiKey) {
        return <ApiKeyGate onSaved={setApiKey} />;
    }
    return <ChatPanel apiKey={apiKey} onApiKeyChange={setApiKey} />;
}
