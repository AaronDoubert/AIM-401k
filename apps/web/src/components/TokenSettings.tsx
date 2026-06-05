import { useState, useSyncExternalStore } from "react";
import { PROVIDERS, LOCAL_PROVIDER_ID, type ProviderDef } from "../agent/providers";
import { tokenStore } from "../agent/tokenStore";
import { testConnection } from "../agent/client";

function useAgentSettings() {
  return useSyncExternalStore(tokenStore.subscribe, tokenStore.getSnapshot);
}

interface TestState {
  testing: boolean;
  ok?: boolean;
  message?: string;
}

function ProviderCard({ provider, active }: { provider: ProviderDef; active: boolean }) {
  const settings = useAgentSettings();
  const creds = settings.creds[provider.id] ?? { token: "" };
  const [show, setShow] = useState(false);
  const [test, setTest] = useState<TestState>({ testing: false });

  const baseUrl = tokenStore.resolvedBaseUrl(provider.id);
  const model = tokenStore.resolvedModel(provider.id);
  const hasToken = Boolean(creds.token);
  const ready = hasToken || !provider.requiresToken;

  const runTest = async () => {
    setTest({ testing: true });
    const res = await testConnection(provider, baseUrl, creds.token, model);
    setTest({ testing: false, ok: res.ok, message: res.message });
  };

  return (
    <div className={`provider-card ${active ? "active" : ""}`}>
      <div className="provider-head">
        <div className="provider-title">
          <span className="provider-name">{provider.label}</span>
          <span className={`wire-badge wire-${provider.wire}`}>{provider.wire}</span>
          {!provider.requiresToken && <span className="wire-badge local">no key</span>}
          {active && <span className="wire-badge on">active</span>}
        </div>
        <div className="provider-actions">
          <button
            className={active ? "primary" : ""}
            disabled={active || !ready}
            onClick={() => tokenStore.setActiveProvider(provider.id)}
            title={ready ? "Use this provider" : "Add a token first"}
          >
            {active ? "In use" : "Use"}
          </button>
        </div>
      </div>

      <label className="field compact">
        <span>{provider.tokenLabel}</span>
        <div className="qty">
          <input
            type={show ? "text" : "password"}
            placeholder={provider.tokenHint ?? "paste token"}
            value={creds.token}
            onChange={(e) => tokenStore.setCreds(provider.id, { token: e.target.value })}
            autoComplete="off"
            spellCheck={false}
          />
          <button className="ghost" onClick={() => setShow((s) => !s)} title="Show / hide">
            {show ? "🙈" : "👁"}
          </button>
        </div>
      </label>

      {provider.editableBaseUrl && (
        <label className="field compact">
          <span>Base URL</span>
          <input
            value={creds.baseUrl ?? provider.defaultBaseUrl}
            onChange={(e) => tokenStore.setCreds(provider.id, { baseUrl: e.target.value })}
            spellCheck={false}
          />
        </label>
      )}

      <label className="field compact">
        <span>Model</span>
        <input
          list={`models-${provider.id}`}
          value={creds.model ?? provider.defaultModel}
          onChange={(e) => tokenStore.setCreds(provider.id, { model: e.target.value })}
          spellCheck={false}
        />
        <datalist id={`models-${provider.id}`}>
          {provider.models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
      </label>

      <div className="provider-foot">
        <button className="ghost" disabled={test.testing || !ready} onClick={runTest}>
          {test.testing ? "Testing…" : "Test"}
        </button>
        {hasToken && (
          <button className="ghost" onClick={() => tokenStore.clearCreds(provider.id)}>
            Clear
          </button>
        )}
        {provider.docsUrl && (
          <a className="ghost-link" href={provider.docsUrl} target="_blank" rel="noreferrer">
            Docs ↗
          </a>
        )}
      </div>

      {provider.notes && <p className="provider-note">{provider.notes}</p>}
      {test.message && (
        <p className={`test-result ${test.ok ? "ok" : "bad"}`}>{test.message}</p>
      )}
    </div>
  );
}

export function TokenSettings() {
  const settings = useAgentSettings();
  const active = settings.activeProviderId;

  return (
    <div className="token-settings">
      <div className="local-row">
        <div className="provider-title">
          <span className="provider-name">Offline agent</span>
          <span className="wire-badge local">built-in</span>
          {active === LOCAL_PROVIDER_ID && <span className="wire-badge on">active</span>}
        </div>
        <button
          className={active === LOCAL_PROVIDER_ID ? "primary" : ""}
          disabled={active === LOCAL_PROVIDER_ID}
          onClick={() => tokenStore.setActiveProvider(LOCAL_PROVIDER_ID)}
        >
          {active === LOCAL_PROVIDER_ID ? "In use" : "Use"}
        </button>
      </div>
      <p className="settings-hint">
        Pick a provider and paste a token to enable free-form AI design. Tokens are stored only in
        this browser (localStorage) and are sent solely to the provider you choose. Some hosted APIs
        block direct browser calls (CORS) and may need a proxy — the offline agent always works.
      </p>

      <div className="provider-grid">
        {PROVIDERS.map((p) => (
          <ProviderCard key={p.id} provider={p} active={active === p.id} />
        ))}
      </div>
    </div>
  );
}
