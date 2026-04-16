import { useEffect, useMemo, useState } from "react";
import { toolDescriptions, type ToolName } from "../tools";
import {
    type ApiKey,
    clearApiKey,
    defaultModel,
    loadProviderEntry,
    type Provider,
    saveApiKey,
} from "./storage";
import { allToolNames, saveDisabled } from "./tool-settings";

interface Props {
    current: ApiKey;
    onSaved: (key: ApiKey) => void;
    disabledTools: Set<ToolName>;
    onDisabledToolsChange: (next: Set<ToolName>) => void;
    onClose: () => void;
}

// Show only the last few characters of the stored key so the user has a hint
// of what's there without ever putting the secret in the DOM unmasked.
function maskKey(key: string): string {
    if (!key) return "";
    if (key.length <= 8) return "•".repeat(key.length);
    return "•".repeat(Math.max(4, Math.min(16, key.length - 4))) + key.slice(-4);
}

export function SettingsDialog({
    current,
    onSaved,
    disabledTools,
    onDisabledToolsChange,
    onClose,
}: Props) {
    const [provider, setProvider] = useState<Provider>(current.provider);
    const [model, setModel] = useState(current.model ?? defaultModel[current.provider]);
    // `storedKey` tracks what's persisted for the currently-displayed provider
    // (so the masked row always reflects storage, not input state). `keyInput`
    // is the new value being typed, or "" if the user hasn't replaced it.
    const [storedKey, setStoredKey] = useState(current.key);
    const [keyInput, setKeyInput] = useState("");
    const [showKeyField, setShowKeyField] = useState(false);
    const [toolsOpen, setToolsOpen] = useState(false);

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") onClose();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [onClose]);

    // Pull the selected provider's own saved key+model when the user flips the
    // dropdown. Blank if nothing's stored for that provider yet.
    const onProviderChange = (next: Provider) => {
        setProvider(next);
        const entry = loadProviderEntry(next);
        setStoredKey(entry?.key ?? "");
        setModel(entry?.model ?? defaultModel[next]);
        setKeyInput("");
        setShowKeyField(!entry?.key); // if there's nothing saved, show the input immediately
    };

    const submit = (e: React.FormEvent) => {
        e.preventDefault();
        const finalKey = keyInput.trim() || storedKey;
        if (!finalKey) {
            alert(`No API key set for ${provider}. Paste one to continue.`);
            return;
        }
        const next: ApiKey = {
            provider,
            key: finalKey,
            model: model.trim() || defaultModel[provider],
        };
        saveApiKey(next);
        onSaved(next);
        onClose();
    };

    const onClearCurrent = () => {
        if (!confirm(`Clear the stored ${provider} API key?`)) return;
        clearApiKey();
        // If another provider still has a key, the load path will switch to
        // it on reload. Reload is the simplest way to get App state right.
        window.location.reload();
    };

    const allTools = useMemo(() => allToolNames(), []);
    const enabledCount = allTools.length - disabledTools.size;

    const toggleTool = (name: ToolName) => {
        const next = new Set(disabledTools);
        if (next.has(name)) next.delete(name);
        else next.add(name);
        onDisabledToolsChange(next);
        saveDisabled(next);
    };

    const setAll = (disabled: boolean) => {
        const next = disabled ? new Set<ToolName>(allTools) : new Set<ToolName>();
        onDisabledToolsChange(next);
        saveDisabled(next);
    };

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div
                className="modal"
                role="dialog"
                aria-label="AI settings"
                onClick={(e) => e.stopPropagation()}
            >
                <header>
                    <h2>AI settings</h2>
                    <button
                        type="button"
                        className="icon-btn"
                        onClick={onClose}
                        title="Close"
                        aria-label="Close"
                    >
                        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                            <path d="M18.3 5.71L12 12l6.3 6.29-1.41 1.42L10.59 13.4 4.3 19.71l-1.42-1.42L9.17 12 2.88 5.71 4.3 4.29l6.29 6.3 6.3-6.3z" />
                        </svg>
                    </button>
                </header>

                <form onSubmit={submit}>
                    <label htmlFor="sd-provider">Provider</label>
                    <select
                        id="sd-provider"
                        value={provider}
                        onChange={(e) => onProviderChange(e.target.value as Provider)}
                    >
                        <option value="anthropic">Anthropic (Claude)</option>
                        <option value="openai">OpenAI (GPT)</option>
                    </select>

                    <label htmlFor="sd-model">Model</label>
                    <input
                        id="sd-model"
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        placeholder={defaultModel[provider]}
                    />

                    <label htmlFor="sd-key">API key</label>
                    {showKeyField ? (
                        <input
                            id="sd-key"
                            type="password"
                            value={keyInput}
                            onChange={(e) => setKeyInput(e.target.value)}
                            placeholder={provider === "anthropic" ? "sk-ant-..." : "sk-..."}
                            autoFocus
                        />
                    ) : (
                        <div className="key-row">
                            <span className="masked">{maskKey(storedKey) || "(none)"}</span>
                            <button
                                type="button"
                                className="linklike"
                                onClick={() => setShowKeyField(true)}
                            >
                                replace
                            </button>
                        </div>
                    )}

                    <details
                        className="tools-section"
                        open={toolsOpen}
                        onToggle={(e) => setToolsOpen((e.target as HTMLDetailsElement).open)}
                    >
                        <summary>
                            Tools <span className="muted">({enabledCount}/{allTools.length} enabled)</span>
                        </summary>
                        <div className="tools-controls">
                            <button type="button" className="linklike" onClick={() => setAll(false)}>
                                enable all
                            </button>
                            <span className="muted">·</span>
                            <button type="button" className="linklike" onClick={() => setAll(true)}>
                                disable all
                            </button>
                        </div>
                        <div className="tools-list">
                            {allTools.map((name) => {
                                const enabled = !disabledTools.has(name);
                                return (
                                    <label key={name} className="tool-row" title={toolDescriptions[name]}>
                                        <input
                                            type="checkbox"
                                            checked={enabled}
                                            onChange={() => toggleTool(name)}
                                        />
                                        <span className="tool-name">{name}</span>
                                    </label>
                                );
                            })}
                        </div>
                    </details>

                    <div className="modal-actions">
                        <button
                            type="button"
                            className="linklike"
                            onClick={onClearCurrent}
                            title={`Remove the stored ${provider} API key and reload`}
                        >
                            clear
                        </button>
                        <div className="spacer" />
                        <button type="button" className="ghost" onClick={onClose}>
                            Cancel
                        </button>
                        <button type="submit">Save</button>
                    </div>
                </form>
            </div>
        </div>
    );
}
