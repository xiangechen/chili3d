import { useState } from "react";
import { type ApiKey, defaultModel, type Provider, saveApiKey } from "./storage";

export function ApiKeyGate({ onSaved }: { onSaved: (k: ApiKey) => void }) {
    const [provider, setProvider] = useState<Provider>("anthropic");
    const [key, setKey] = useState("");
    const [model, setModel] = useState(defaultModel.anthropic);

    const updateProvider = (p: Provider) => {
        setProvider(p);
        setModel(defaultModel[p]);
    };

    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!key.trim()) return;
        const v: ApiKey = { provider, key: key.trim(), model };
        saveApiKey(v);
        onSaved(v);
    };

    return (
        <form className="gate" onSubmit={submit}>
            <div className="card">
                <h2>Connect your LLM</h2>
                <p>
                    Your API key stays in this browser — requests go straight from here to
                    the model provider.
                </p>

                <label htmlFor="provider">Provider</label>
                <select
                    id="provider"
                    value={provider}
                    onChange={(e) => updateProvider(e.target.value as Provider)}
                >
                    <option value="anthropic">Anthropic (Claude)</option>
                    <option value="openai">OpenAI (GPT)</option>
                </select>

                <label htmlFor="model">Model</label>
                <input
                    id="model"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder={defaultModel[provider]}
                />

                <label htmlFor="key">API key</label>
                <input
                    id="key"
                    type="password"
                    value={key}
                    onChange={(e) => setKey(e.target.value)}
                    placeholder={provider === "anthropic" ? "sk-ant-..." : "sk-..."}
                    autoFocus
                />

                <div className="actions">
                    <button type="submit" disabled={!key.trim()}>
                        Start
                    </button>
                </div>
            </div>
        </form>
    );
}
