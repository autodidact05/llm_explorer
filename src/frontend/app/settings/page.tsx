'use client'

import { useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { api } from '@/lib/api'
import type { AppConfig, ApiKey, OpenRouterCredits, OllamaStatus, OllamaSyncResult } from '@/lib/types'
import { CURRENCIES, TIMEZONES, useCurrencyPreference, useTimezone, useTheme } from '@/lib/hooks'
import type { Theme } from '@/lib/hooks'
import { ChatSettingsForm } from '@/features/settings/ChatSettingsForm'
import { OllamaSection } from '@/features/settings/OllamaSection'
import { OpenRouterCreditsSection } from '@/features/settings/OpenRouterCreditsSection'
import { UserGuidePanel } from '@/features/settings/UserGuidePanel'
import { ProviderKeyBanner } from '@/components/ProviderKeyBanner'
import { LlmRoutingSwitch } from '@/features/settings/LlmRoutingSwitch'

type Tab = 'keys' | 'preferences' | 'chat' | 'system' | 'sync' | 'guide'

const TAB_LABELS: { id: Tab; label: string }[] = [
  { id: 'keys', label: 'API Keys' },
  { id: 'preferences', label: 'Preferences' },
  { id: 'chat', label: 'LLMs' },
  { id: 'system', label: 'System' },
  { id: 'sync', label: 'Sync & Credits' },
  { id: 'guide', label: 'Guide' },
]

const TAB_IDS = new Set<string>(TAB_LABELS.map(t => t.id))

export default function SettingsPage() {
  const searchParams = useSearchParams()
  const isSetup = searchParams.get('setup') === '1'
  const tabParam = searchParams.get('tab')
  const initialTab: Tab =
    tabParam && TAB_IDS.has(tabParam) ? (tabParam as Tab) : isSetup ? 'keys' : 'keys'

  const [activeTab, setActiveTab] = useState<Tab>(initialTab)
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [error, setError] = useState('')

  // Env API keys
  const [envKeyInput, setEnvKeyInput] = useState('')
  const [showEnvKey, setShowEnvKey] = useState(false)
  const [savingEnvKey, setSavingEnvKey] = useState(false)
  const [envKeyMsg, setEnvKeyMsg] = useState('')
  const [braveKeyInput, setBraveKeyInput] = useState('')
  const [showBraveKey, setShowBraveKey] = useState(false)
  const [savingBraveKey, setSavingBraveKey] = useState(false)
  const [braveKeyMsg, setBraveKeyMsg] = useState('')

  // DB keys
  const [keys, setKeys] = useState<ApiKey[]>([])
  const [keysLoading, setKeysLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [newProvider, setNewProvider] = useState('openrouter')
  const [newKeyValue, setNewKeyValue] = useState('')
  const [showNewKey, setShowNewKey] = useState(false)
  const [addingKey, setAddingKey] = useState(false)
  const [addMsg, setAddMsg] = useState('')
  const [activatingId, setActivatingId] = useState<number | null>(null)
  const [deletingId, setDeletingId] = useState<number | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null)
  const [bannerRefresh, setBannerRefresh] = useState(0)

  // Model sync
  const [syncSource, setSyncSource] = useState<'openrouter' | 'local'>('openrouter')
  const [syncing, setSyncing] = useState(false)
  const [syncOutput, setSyncOutput] = useState('')
  const [syncError, setSyncError] = useState('')

  // OpenRouter credits
  const [credits, setCredits] = useState<OpenRouterCredits | null>(null)
  const [creditsLoading, setCreditsLoading] = useState(false)
  const [creditsError, setCreditsError] = useState('')

  // Ollama
  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null)
  const [ollamaSyncing, setOllamaSyncing] = useState(false)
  const [ollamaSyncResult, setOllamaSyncResult] = useState<OllamaSyncResult | null>(null)
  const [ollamaError, setOllamaError] = useState('')

  // Chat settings
  const [genericSysMsg, setGenericSysMsg] = useState('')
  const [routerLlmEnabled, setRouterLlmEnabled] = useState(false)
  const [routerLlmProvider, setRouterLlmProvider] = useState('openai')
  const [routerLlmModel, setRouterLlmModel] = useState('gpt-4o-mini')
  const [routerSysMsg, setRouterSysMsg] = useState('')
  const [savingChatSettings, setSavingChatSettings] = useState(false)
  const [chatSettingsMsg, setChatSettingsMsg] = useState('')

  // Preferences
  const { currency, setCurrency } = useCurrencyPreference()
  const { timezone, setTimezone } = useTimezone()
  const { theme, setTheme } = useTheme()

  function loadConfig() {
    api.config()
      .then(c => { setConfig(c); setError('') })
      .catch((e: Error) => setError(e.message))
  }

  function loadChatSettings() {
    api.settings.get().then(s => {
      setGenericSysMsg(s.generic_system_message ?? '')
      setRouterLlmEnabled(!!s.router_llm_enabled)
      setRouterLlmProvider((s.router_llm_provider as string) || 'openai')
      setRouterLlmModel((s.router_llm_model as string) || 'gpt-4o-mini')
      setRouterSysMsg(s.router_llm_system_message ?? '')
    }).catch(() => {})
  }

  function loadKeys() {
    setKeysLoading(true)
    api.keys.list()
      .then(k => { setKeys(k); setKeysLoading(false) })
      .catch(() => setKeysLoading(false))
  }

  function checkOllama() {
    api.ollama.status().then(setOllamaStatus).catch(() => setOllamaStatus({ available: false, model_count: 0 }))
  }

  useEffect(() => { loadConfig(); loadKeys(); checkOllama(); loadChatSettings() }, [])

  async function handleAddKey(e: React.FormEvent) {
    e.preventDefault()
    if (!newKeyValue.trim()) return
    setAddingKey(true)
    setAddMsg('')
    try {
      await api.keys.add({ name: newName.trim() || 'Unnamed', provider: newProvider, key_value: newKeyValue.trim() })
      setAddMsg('Key added successfully.')
      setNewName('')
      setNewKeyValue('')
      loadKeys()
    } catch (err) {
      setAddMsg(err instanceof Error ? err.message : 'Failed to add key.')
    } finally {
      setAddingKey(false)
    }
  }

  async function handleActivate(id: number) {
    setActivatingId(id)
    try {
      await api.keys.activate(id)
      loadKeys(); loadConfig()
      setBannerRefresh(t => t + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to activate key.')
    } finally {
      setActivatingId(null)
    }
  }

  async function handleDelete(id: number) {
    setDeletingId(id)
    try {
      await api.keys.delete(id)
      setConfirmDeleteId(null)
      loadKeys()
      setBannerRefresh(t => t + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete key.')
    } finally {
      setDeletingId(null)
    }
  }

  async function handleSaveEnvKey(e: React.FormEvent) {
    e.preventDefault()
    if (!envKeyInput.trim()) return
    setSavingEnvKey(true)
    setEnvKeyMsg('')
    try {
      const key = envKeyInput.trim()
      await api.updateConfig({ api_key: key })
      await api.persistConfig({ api_key: key })
      setEnvKeyMsg('Key saved to .env.')
      setEnvKeyInput('')
      loadConfig()
    } catch (err) {
      setEnvKeyMsg(err instanceof Error ? err.message : 'Failed to save.')
    } finally {
      setSavingEnvKey(false)
    }
  }

  async function handleSaveBraveKey(e: React.FormEvent) {
    e.preventDefault()
    if (!braveKeyInput.trim()) return
    setSavingBraveKey(true)
    setBraveKeyMsg('')
    try {
      const key = braveKeyInput.trim()
      await api.updateConfig({ brave_api_key: key })
      await api.persistConfig({ brave_api_key: key })
      setBraveKeyMsg('Key saved to .env.')
      setBraveKeyInput('')
      loadConfig()
    } catch (err) {
      setBraveKeyMsg(err instanceof Error ? err.message : 'Failed to save.')
    } finally {
      setSavingBraveKey(false)
    }
  }

  async function fetchCredits() {
    setCreditsLoading(true)
    setCreditsError('')
    setCredits(null)
    try {
      setCredits(await api.syncOpenRouterCredits())
    } catch (err) {
      setCreditsError(err instanceof Error ? err.message : 'Failed to sync credits.')
    } finally {
      setCreditsLoading(false)
    }
  }

  async function handleSync() {
    setSyncing(true)
    setSyncOutput('')
    setSyncError('')
    try {
      const r = await api.syncModels(syncSource)
      setSyncOutput(r.output)
      loadConfig()
    } catch (err) {
      setSyncError(err instanceof Error ? err.message : 'Sync failed.')
    } finally {
      setSyncing(false)
    }
  }

  async function handleOllamaSync() {
    setOllamaSyncing(true)
    setOllamaError('')
    setOllamaSyncResult(null)
    try {
      const r = await api.ollama.sync()
      setOllamaSyncResult(r)
      checkOllama()
    } catch (err) {
      setOllamaError(err instanceof Error ? err.message : 'Ollama sync failed.')
    } finally {
      setOllamaSyncing(false)
    }
  }

  async function handleSaveChatSettings(e: React.FormEvent) {
    e.preventDefault()
    setSavingChatSettings(true)
    setChatSettingsMsg('')
    try {
      await api.settings.update({
        generic_system_message: genericSysMsg,
        router_llm_enabled: routerLlmEnabled,
        router_llm_provider: routerLlmProvider.trim() || 'openai',
        router_llm_model: routerLlmModel.trim() || 'gpt-4o-mini',
        router_llm_system_message: routerSysMsg,
      })
      setChatSettingsMsg('Saved.')
      loadChatSettings()
    } catch (err) {
      setChatSettingsMsg(err instanceof Error ? err.message : 'Failed to save.')
    } finally {
      setSavingChatSettings(false)
    }
  }

  const inputCls = 'w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500'
  const btnPrimary = 'px-4 py-2 rounded-lg text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
  const btnSecondary = 'px-4 py-2 rounded-lg text-sm font-medium text-slate-600 border border-slate-300 hover:bg-slate-50 disabled:opacity-50 transition-colors'

  function InfoRow({ label, value }: { label: string; value: string }) {
    return (
      <div className="flex items-start gap-4 py-3 border-b border-slate-100 last:border-0">
        <span className="w-36 shrink-0 text-sm font-medium text-slate-500">{label}</span>
        <span className="font-mono text-xs text-slate-700 break-all">{value}</span>
      </div>
    )
  }

  return (
    <div className="p-8 max-w-2xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="text-slate-500 mt-1">API keys, preferences, and model sync</p>
      </div>

      {isSetup && (
        <div className="mb-4 bg-indigo-50 border border-indigo-200 rounded-lg p-4 flex gap-3">
          <svg className="w-5 h-5 text-indigo-500 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M12 2a10 10 0 100 20A10 10 0 0012 2z" />
          </svg>
          <div>
            <p className="text-sm font-semibold text-indigo-800">Welcome! Set up your API key</p>
            <p className="text-sm text-indigo-700 mt-0.5">Add your OpenRouter API key below to start using LLM Explorer.</p>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          {error} — make sure the API server is running.
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-slate-200 mb-6 gap-1">
        {TAB_LABELS.map(t => (
          <button
            key={t.id}
            onClick={() => setActiveTab(t.id)}
            className={`px-4 py-2.5 text-sm font-medium rounded-t-lg transition-colors -mb-px ${
              activeTab === t.id
                ? 'text-indigo-600 border border-b-white border-slate-200 bg-white'
                : 'text-slate-500 hover:text-slate-700 border border-transparent'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <ProviderKeyBanner className="mb-6" refreshToken={bannerRefresh} />

      {/* ── API Keys tab ── */}
      {activeTab === 'keys' && (
        <div className="space-y-5">
          <LlmRoutingSwitch
            onRoutingChange={() => {
              setBannerRefresh(t => t + 1)
              loadKeys()
            }}
          />
          {/* OpenRouter env key */}
          <section className="bg-white border border-slate-200 rounded-xl shadow-sm">
            <div className="px-5 py-3.5 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-800">OpenRouter API Key</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Saved to <code className="bg-slate-100 px-1 py-0.5 rounded">.env</code> as{' '}
                <code className="bg-slate-100 px-1 py-0.5 rounded">OPENROUTER_API_KEY</code> — used when no DB key is active.
              </p>
            </div>
            <div className="px-5 py-4 space-y-3">
              {config ? (
                config.api_key_set ? (
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">Configured</span>
                    <span className="font-mono text-sm text-slate-600">{config.api_key_preview}</span>
                  </div>
                ) : (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    No key in <code className="text-xs">.env</code> — enter one below.
                  </p>
                )
              ) : <div className="h-5 bg-slate-100 rounded animate-pulse w-40" />}
              <form onSubmit={handleSaveEnvKey} className="flex gap-2 items-center">
                <div className="relative flex-1">
                  <input
                    type={showEnvKey ? 'text' : 'password'}
                    value={envKeyInput}
                    onChange={e => setEnvKeyInput(e.target.value)}
                    placeholder={config?.api_key_set ? 'Enter new key to replace' : 'sk-or-v1-…'}
                    className={`${inputCls} pr-14`}
                  />
                  <button type="button" onClick={() => setShowEnvKey(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600">
                    {showEnvKey ? 'Hide' : 'Show'}
                  </button>
                </div>
                <button type="submit" disabled={savingEnvKey || !envKeyInput.trim()} className={btnPrimary}>
                  {savingEnvKey ? 'Saving…' : 'Save'}
                </button>
                {envKeyMsg && (
                  <span className={`text-xs ${envKeyMsg.includes('saved') ? 'text-emerald-600' : 'text-red-600'}`}>{envKeyMsg}</span>
                )}
              </form>
            </div>
          </section>

          {/* Brave Search env key */}
          <section className="bg-white border border-slate-200 rounded-xl shadow-sm">
            <div className="px-5 py-3.5 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-800">Brave Search API Key</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Saved to <code className="bg-slate-100 px-1 py-0.5 rounded">.env</code> as{' '}
                <code className="bg-slate-100 px-1 py-0.5 rounded">BRAVE_API_KEY</code>. When set, chat
                automatically searches the web for questions about news, latest updates, and current events.
              </p>
            </div>
            <div className="px-5 py-4 space-y-3">
              {config ? (
                config.brave_api_key_set ? (
                  <div className="flex items-center gap-2">
                    <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-100 text-emerald-700">Configured</span>
                    <span className="font-mono text-sm text-slate-600">{config.brave_api_key_preview}</span>
                  </div>
                ) : (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                    No Brave key in <code className="text-xs">.env</code> — models cannot browse the web for live data.
                  </p>
                )
              ) : <div className="h-5 bg-slate-100 rounded animate-pulse w-40" />}
              <form onSubmit={handleSaveBraveKey} className="flex gap-2 items-center">
                <div className="relative flex-1">
                  <input
                    type={showBraveKey ? 'text' : 'password'}
                    value={braveKeyInput}
                    onChange={e => setBraveKeyInput(e.target.value)}
                    placeholder={config?.brave_api_key_set ? 'Enter new key to replace' : 'BSA…'}
                    className={`${inputCls} pr-14`}
                  />
                  <button type="button" onClick={() => setShowBraveKey(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600">
                    {showBraveKey ? 'Hide' : 'Show'}
                  </button>
                </div>
                <button type="submit" disabled={savingBraveKey || !braveKeyInput.trim()} className={btnPrimary}>
                  {savingBraveKey ? 'Saving…' : 'Save'}
                </button>
                {braveKeyMsg && (
                  <span className={`text-xs ${braveKeyMsg.includes('saved') ? 'text-emerald-600' : 'text-red-600'}`}>{braveKeyMsg}</span>
                )}
              </form>
            </div>
          </section>

          {/* DB keys */}
          <section className="bg-white border border-slate-200 rounded-xl shadow-sm">
            <div className="px-5 py-3.5 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-800">Managed Keys</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Store OpenRouter and Groq keys separately. Use the toggles above to choose which provider powers chat.
              </p>
            </div>

            {keysLoading ? (
              <div className="px-5 py-3 space-y-2">
                {[1, 2].map(i => <div key={i} className="h-9 bg-slate-100 rounded animate-pulse" />)}
              </div>
            ) : keys.length > 0 ? (
              <div className="px-4 py-3 space-y-1.5">
                {keys.map(k => (
                  <div key={k.id} className={`flex items-center gap-2 px-3 py-2 rounded-lg border ${
                    k.is_active ? 'border-emerald-200 bg-emerald-50' : 'border-slate-200'
                  }`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-slate-700 truncate">{k.name}</p>
                      <p className="text-xs text-slate-400">{k.provider} · {k.key_preview}</p>
                    </div>
                    {k.is_active ? (
                      <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-medium ${
                        k.provider === 'groq'
                          ? 'bg-indigo-100 text-indigo-700'
                          : 'bg-emerald-100 text-emerald-700'
                      }`}>
                        Primary {k.provider === 'groq' ? 'Groq' : 'OpenRouter'}
                      </span>
                    ) : (
                      <button onClick={() => handleActivate(k.id)} disabled={activatingId === k.id}
                        className="shrink-0 px-2 py-1 text-xs font-medium text-indigo-600 border border-indigo-200 rounded-lg hover:bg-indigo-50 disabled:opacity-50">
                        {activatingId === k.id ? '…' : 'Set primary'}
                      </button>
                    )}
                    {confirmDeleteId === k.id ? (
                      <span className="flex items-center gap-1 text-xs shrink-0">
                        <button onClick={() => handleDelete(k.id)} disabled={deletingId === k.id}
                          className="px-2 py-1 bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50">
                          {deletingId === k.id ? '…' : 'Confirm'}
                        </button>
                        <button onClick={() => setConfirmDeleteId(null)} className="px-2 py-1 border border-slate-300 rounded text-slate-600 hover:bg-slate-50">
                          Cancel
                        </button>
                      </span>
                    ) : (
                      <button onClick={() => setConfirmDeleteId(k.id)}
                        className="shrink-0 p-1 text-slate-300 hover:text-red-400 transition-colors" title="Delete">
                        <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="px-5 py-3 text-xs text-slate-400">No keys stored yet.</p>
            )}

            <div className="px-5 py-4 border-t border-slate-100">
              <p className="text-xs font-medium text-slate-700 mb-2">Add a key</p>
              <form onSubmit={handleAddKey} className="space-y-2">
                <div className="flex gap-2">
                  <input type="text" value={newName} onChange={e => setNewName(e.target.value)}
                    placeholder="Name (e.g. Personal)"
                    className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
                  <select value={newProvider} onChange={e => setNewProvider(e.target.value)}
                    className="border border-slate-300 rounded-lg px-2 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500">
                    <option value="openrouter">OpenRouter</option>
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="groq">Groq</option>
                    <option value="other">Other</option>
                  </select>
                </div>
                <div className="relative">
                  <input type={showNewKey ? 'text' : 'password'} value={newKeyValue}
                    onChange={e => setNewKeyValue(e.target.value)} 
                    placeholder={newProvider === 'groq' ? 'gsk_…' : newProvider === 'openai' ? 'sk-…' : newProvider === 'anthropic' ? 'sk-ant-…' : 'sk-or-…'}
                    className={`${inputCls} pr-14`} />
                  <button type="button" onClick={() => setShowNewKey(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 hover:text-slate-600">
                    {showNewKey ? 'Hide' : 'Show'}
                  </button>
                </div>
                <div className="flex items-center gap-3">
                  <button type="submit" disabled={addingKey || !newKeyValue.trim()} className={btnPrimary}>
                    {addingKey ? 'Adding…' : 'Add Key'}
                  </button>
                  {addMsg && (
                    <p className={`text-xs ${addMsg.includes('success') ? 'text-emerald-600' : 'text-red-600'}`}>{addMsg}</p>
                  )}
                </div>
              </form>
            </div>
          </section>
        </div>
      )}

      {/* ── Preferences tab ── */}
      {activeTab === 'preferences' && (
        <div className="space-y-5">
          <section className="bg-white border border-slate-200 rounded-xl shadow-sm">
            <div className="px-5 py-3.5 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-800">Display Currency</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Converts USD amounts to your preferred currency on Dashboard and Wallet pages.
              </p>
            </div>
            <div className="px-5 py-4">
              <select
                value={currency}
                onChange={e => setCurrency(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                <option value="">USD only (no conversion)</option>
                {CURRENCIES.map(c => (
                  <option key={c.code} value={c.code}>{c.label}</option>
                ))}
              </select>
              {currency && (
                <p className="mt-2 text-xs text-slate-500">
                  Prices are shown as USD with a converted value in parentheses.
                </p>
              )}
            </div>
          </section>

          <section className="bg-white border border-slate-200 rounded-xl shadow-sm">
            <div className="px-5 py-3.5 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-800">Timezone</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                All timestamps across the app will display in this timezone.
              </p>
            </div>
            <div className="px-5 py-4">
              <select
                value={timezone}
                onChange={e => setTimezone(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
              >
                {TIMEZONES.map(t => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
              <p className="mt-2 text-xs text-slate-500">Current selection: {timezone}</p>
            </div>
          </section>

          <section className="bg-white border border-slate-200 rounded-xl shadow-sm">
            <div className="px-5 py-3.5 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-800">Export usage audit</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Download all rows from the usage audit log as CSV or JSON.
              </p>
            </div>
            <div className="px-5 py-4 flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => api.exportUsageAudit('csv').catch(e => setError(e.message))}
                className="px-4 py-2 text-sm font-medium border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                Download CSV
              </button>
              <button
                type="button"
                onClick={() => api.exportUsageAudit('json').catch(e => setError(e.message))}
                className="px-4 py-2 text-sm font-medium border border-slate-300 rounded-lg hover:bg-slate-50"
              >
                Download JSON
              </button>
            </div>
          </section>

          <section className="bg-white border border-slate-200 rounded-xl shadow-sm">
            <div className="px-5 py-3.5 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-800">Appearance</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Choose between Light and Dark mode. Your preference is saved locally.
              </p>
            </div>
            <div className="px-5 py-4">
              <div className="flex gap-3">
                {(['light', 'dark'] as Theme[]).map(t => (
                  <button
                    key={t}
                    onClick={() => setTheme(t)}
                    className={`flex-1 flex flex-col items-center gap-2 px-4 py-4 rounded-xl border-2 transition-all ${
                      theme === t
                        ? 'border-indigo-500 bg-indigo-50'
                        : 'border-slate-200 hover:border-slate-300 hover:bg-slate-50'
                    }`}
                  >
                    <span className={`text-2xl ${t === 'dark' ? '' : ''}`}>
                      {t === 'light' ? '☀️' : '🌙'}
                    </span>
                    <span className={`text-sm font-semibold capitalize ${theme === t ? 'text-indigo-700' : 'text-slate-700'}`}>
                      {t}
                    </span>
                    {theme === t && (
                      <span className="text-xs text-indigo-500 font-medium">Active</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>
      )}

      {/* ── Chat tab ── */}
      {activeTab === 'chat' && (
        <ChatSettingsForm
          genericSysMsg={genericSysMsg}
          setGenericSysMsg={setGenericSysMsg}
          routerLlmEnabled={routerLlmEnabled}
          setRouterLlmEnabled={setRouterLlmEnabled}
          routerLlmProvider={routerLlmProvider}
          setRouterLlmProvider={setRouterLlmProvider}
          routerLlmModel={routerLlmModel}
          setRouterLlmModel={setRouterLlmModel}
          routerSysMsg={routerSysMsg}
          setRouterSysMsg={setRouterSysMsg}
          saving={savingChatSettings}
          message={chatSettingsMsg}
          onSubmit={handleSaveChatSettings}
          btnPrimaryClass={btnPrimary}
        />
      )}

      {/* ── System tab ── */}
      {activeTab === 'system' && (
        <section className="bg-white border border-slate-200 rounded-xl shadow-sm">
          <div className="px-5 py-3.5 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-800">System Paths</h2>
          </div>
          <div className="px-5 py-2">
            {config ? (
              <>
                <InfoRow label="Database" value={config.db_path} />
                <InfoRow label="Audit Log" value={config.log_path} />
                <InfoRow label="Models CSV" value={config.models_csv_path} />
                <div className="flex items-center gap-4 py-3">
                  <span className="w-36 shrink-0 text-sm font-medium text-slate-500">CSV Status</span>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                    config.local_csv_exists ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500'
                  }`}>
                    {config.local_csv_exists ? 'Exists' : 'Not yet created'}
                  </span>
                </div>
              </>
            ) : (
              <div className="py-6 space-y-3">
                {[1, 2, 3].map(i => <div key={i} className="h-4 bg-slate-100 rounded animate-pulse" />)}
              </div>
            )}
          </div>
        </section>
      )}

      {/* ── Sync & Credits tab ── */}
      {activeTab === 'sync' && (
        <div className="space-y-5">
          {/* Model sync */}
          <section className="bg-white border border-slate-200 rounded-xl shadow-sm">
            <div className="px-5 py-3.5 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-800">OpenRouter Model Sync</h2>
              <p className="text-xs text-slate-500 mt-0.5">Populate the models table from OpenRouter or a local CSV cache</p>
            </div>
            <div className="px-5 py-4 space-y-3">
              <div className="flex gap-4">
                {(['openrouter', 'local'] as const).map(src => (
                  <label key={src} className="flex items-center gap-2 cursor-pointer">
                    <input type="radio" name="source" value={src}
                      checked={syncSource === src} onChange={() => setSyncSource(src)}
                      className="accent-indigo-600" />
                    <span className="text-sm text-slate-700">
                      {src === 'openrouter' ? 'Fetch from OpenRouter' : 'Load from local CSV'}
                    </span>
                  </label>
                ))}
              </div>
              {syncSource === 'local' && config && !config.local_csv_exists && (
                <p className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  Local CSV not found — will fall back to OpenRouter.
                </p>
              )}
              <button onClick={handleSync} disabled={syncing} className={btnSecondary}>
                {syncing ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-slate-500 border-t-transparent rounded-full animate-spin" />
                    Syncing…
                  </span>
                ) : 'Run Sync'}
              </button>
              {syncOutput && (
                <pre className="bg-slate-900 text-slate-100 rounded-lg p-3 text-xs font-mono whitespace-pre-wrap overflow-x-auto max-h-48">
                  {syncOutput}
                </pre>
              )}
              {syncError && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">{syncError}</div>
              )}
            </div>
          </section>

          <OllamaSection
            ollamaStatus={ollamaStatus}
            ollamaSyncing={ollamaSyncing}
            ollamaSyncResult={ollamaSyncResult}
            ollamaError={ollamaError}
            onSync={handleOllamaSync}
            onRecheck={checkOllama}
            btnSecondaryClass={btnSecondary}
          />

          <OpenRouterCreditsSection
            credits={credits}
            creditsLoading={creditsLoading}
            creditsError={creditsError}
            onSync={fetchCredits}
            btnSecondaryClass={btnSecondary}
          />
        </div>
      )}

      {activeTab === 'guide' && (
        <section className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden mb-8">
          <div className="px-5 py-3.5 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-800">Product guide</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              How LLM Explorer works — features, API keys, chat, wallet, and exports.
            </p>
          </div>
          <UserGuidePanel />
        </section>
      )}

      {activeTab !== 'guide' && (
        <section className="mt-10 pt-6 border-t border-slate-200">
          <h2 className="text-sm font-semibold text-slate-800">Need help?</h2>
          <p className="text-xs text-slate-500 mt-1 mb-3">
            Read the full product guide for setup, providers, branching, and exports.
          </p>
          <button
            type="button"
            onClick={() => setActiveTab('guide')}
            className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
          >
            Open product guide →
          </button>
        </section>
      )}
    </div>
  )
}
