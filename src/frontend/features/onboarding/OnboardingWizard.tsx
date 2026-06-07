'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { api } from '@/lib/api'
import { ProviderKeyBanner } from '@/components/ProviderKeyBanner'
import { Spinner } from '@/components/Spinner'

export const ONBOARDING_STORAGE_KEY = 'llm_explorer_onboarding_done'

type Step = 'welcome' | 'key' | 'sync' | 'done'

export function isOnboardingComplete(): boolean {
  if (typeof window === 'undefined') return true
  return localStorage.getItem(ONBOARDING_STORAGE_KEY) === '1'
}

export function markOnboardingComplete(): void {
  localStorage.setItem(ONBOARDING_STORAGE_KEY, '1')
}

export function OnboardingWizard() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('welcome')
  const [config, setConfig] = useState<{ api_key_set: boolean } | null>(null)
  const [keyName, setKeyName] = useState('My key')
  const [keyProvider, setKeyProvider] = useState('openrouter')
  const [keyValue, setKeyValue] = useState('')
  const [keyError, setKeyError] = useState('')
  const [keySaving, setKeySaving] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [syncMsg, setSyncMsg] = useState('')

  useEffect(() => {
    api.config().then(setConfig).catch(() => setConfig({ api_key_set: false }))
  }, [])

  async function handleAddKey(e: React.FormEvent) {
    e.preventDefault()
    if (!keyValue.trim()) return
    setKeySaving(true)
    setKeyError('')
    try {
      const row = await api.keys.add({
        name: keyName.trim() || 'My key',
        provider: keyProvider,
        key_value: keyValue.trim(),
      })
      await api.keys.activate(row.id)
      setConfig({ api_key_set: true })
      setKeyValue('')
      setStep('sync')
    } catch (err) {
      setKeyError(err instanceof Error ? err.message : 'Failed to save key')
    } finally {
      setKeySaving(false)
    }
  }

  async function handleSync() {
    setSyncing(true)
    setSyncMsg('')
    try {
      await api.syncModels('openrouter')
      setSyncMsg('Models synced successfully.')
      setStep('done')
    } catch (err) {
      setSyncMsg(err instanceof Error ? err.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  function finish(dest: '/chat' | '/dashboard') {
    markOnboardingComplete()
    router.replace(dest)
  }

  const steps: Step[] = ['welcome', 'key', 'sync', 'done']
  const stepIndex = steps.indexOf(step)

  return (
    <div className="min-h-screen bg-cream-100 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-lg bg-white rounded-2xl border border-slate-200 shadow-lg overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 bg-navy-900">
          <p className="text-gold-300 text-xs font-medium uppercase tracking-wide">Setup</p>
          <h1 className="text-lg font-bold text-cream-50 mt-0.5">Welcome to LLM Explorer</h1>
          <div className="mt-3 flex gap-1">
            {steps.map((s, i) => (
              <div
                key={s}
                className={`h-1 flex-1 rounded-full ${i <= stepIndex ? 'bg-gold-400' : 'bg-navy-700'}`}
              />
            ))}
          </div>
        </div>

        <div className="px-6 py-6">
          {step === 'welcome' && (
            <>
              <p className="text-sm text-slate-600 leading-relaxed">
                See every cent your LLMs cost — chat included. This short setup adds your API key
                and loads the model catalogue.
              </p>
              <ul className="mt-4 text-sm text-slate-500 list-disc list-inside space-y-1">
                <li>Local SQLite database under <code className="text-xs">data/</code></li>
                <li>OpenRouter recommended for most models</li>
                <li>Groq: Llama 3.1 8B, Llama 3.3 70B, GPT OSS 120B, and GPT OSS 20B only</li>
              </ul>
              <button
                type="button"
                onClick={() => setStep(config?.api_key_set ? 'sync' : 'key')}
                className="mt-6 w-full py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
              >
                {config?.api_key_set ? 'Continue' : 'Get started'}
              </button>
            </>
          )}

          {step === 'key' && (
            <>
              <p className="text-sm text-slate-600 mb-4">
                Add an <strong>OpenRouter</strong> key for the full catalogue, or <strong>Groq</strong> for four supported Groq models (Llama 3.1 8B, 3.3 70B, GPT OSS 120B/20B).
              </p>
              <ProviderKeyBanner className="mb-4" />
              <form onSubmit={handleAddKey} className="space-y-3">
                <input
                  type="text"
                  value={keyName}
                  onChange={e => setKeyName(e.target.value)}
                  placeholder="Key name"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
                <select
                  value={keyProvider}
                  onChange={e => setKeyProvider(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
                >
                  <option value="openrouter">OpenRouter</option>
                  <option value="groq">Groq</option>
                </select>
                <input
                  type="password"
                  value={keyValue}
                  onChange={e => setKeyValue(e.target.value)}
                  placeholder={keyProvider === 'groq' ? 'gsk_…' : 'sk-or-…'}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono"
                />
                {keyError && <p className="text-xs text-red-600">{keyError}</p>}
                <button
                  type="submit"
                  disabled={keySaving || !keyValue.trim()}
                  className="w-full py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {keySaving ? <><Spinner sm /> Saving…</> : 'Save & activate key'}
                </button>
              </form>
              {config?.api_key_set && (
                <button
                  type="button"
                  onClick={() => setStep('sync')}
                  className="mt-3 w-full text-sm text-indigo-600 hover:underline"
                >
                  Skip — key already configured
                </button>
              )}
              <p className="mt-3 text-xs text-slate-400">
                Or configure later in <Link href="/settings" className="underline">Settings</Link>.
              </p>
            </>
          )}

          {step === 'sync' && (
            <>
              <p className="text-sm text-slate-600">
                Sync the model catalogue from OpenRouter so Chat can list providers and prices.
                (Skip if you use Groq only — the Groq catalogue loads when you activate your key.)
              </p>
              <ProviderKeyBanner className="my-4" />
              <button
                type="button"
                onClick={handleSync}
                disabled={syncing}
                className="w-full py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-50"
              >
                {syncing ? 'Syncing…' : 'Sync models from OpenRouter'}
              </button>
              {syncMsg && (
                <p className={`mt-2 text-xs ${syncMsg.includes('success') ? 'text-emerald-600' : 'text-red-600'}`}>
                  {syncMsg}
                </p>
              )}
              <button
                type="button"
                onClick={() => setStep('done')}
                className="mt-4 w-full text-sm text-slate-500 hover:text-slate-700"
              >
                Skip sync for now
              </button>
            </>
          )}

          {step === 'done' && (
            <>
              <p className="text-sm text-slate-600">
                You are ready. Start a chat or explore the dashboard.
              </p>
              <ProviderKeyBanner className="my-4" />
              <div className="mt-6 flex flex-col gap-2">
                <button
                  type="button"
                  onClick={() => finish('/chat')}
                  className="w-full py-2.5 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700"
                >
                  Open Chat
                </button>
                <button
                  type="button"
                  onClick={() => finish('/dashboard')}
                  className="w-full py-2.5 rounded-lg border border-slate-300 text-sm font-medium hover:bg-slate-50"
                >
                  Go to Dashboard
                </button>
              </div>
            </>
          )}
        </div>

        <div className="px-6 py-3 border-t border-slate-100 bg-slate-50 flex justify-between items-center">
          <button
            type="button"
            onClick={() => finish('/dashboard')}
            className="text-xs text-slate-400 hover:text-slate-600"
          >
            Skip setup
          </button>
          {step !== 'welcome' && step !== 'done' && (
            <button
              type="button"
              onClick={() => setStep(steps[Math.max(0, stepIndex - 1)])}
              className="text-xs text-indigo-600 hover:underline"
            >
              Back
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
