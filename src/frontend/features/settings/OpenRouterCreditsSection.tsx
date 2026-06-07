'use client'

import type { OpenRouterCredits } from '@/lib/types'

export function OpenRouterCreditsSection({
  credits,
  creditsLoading,
  creditsError,
  onSync,
  btnSecondaryClass,
}: {
  credits: OpenRouterCredits | null
  creditsLoading: boolean
  creditsError: string
  onSync: () => void
  btnSecondaryClass: string
}) {
  return (
    <section className="bg-white border border-slate-200 rounded-xl shadow-sm">
      <div className="px-5 py-3.5 border-b border-slate-100">
        <h2 className="text-sm font-semibold text-slate-800">OpenRouter Credits</h2>
        <p className="text-xs text-slate-500 mt-0.5">Fetch your balance from OpenRouter and sync to the Wallet ledger</p>
      </div>
      <div className="px-5 py-4 space-y-3">
        <button onClick={onSync} disabled={creditsLoading} className={btnSecondaryClass}>
          {creditsLoading ? (
            <span className="flex items-center gap-2">
              <span className="w-4 h-4 border-2 border-slate-500 border-t-transparent rounded-full animate-spin" />
              Syncing…
            </span>
          ) : 'Sync Credits'}
        </button>

        {credits?.synced === true && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-xs text-emerald-700">
            {credits.added_amount != null && credits.added_amount > 0
              ? `Wallet updated — +$${credits.added_amount.toFixed(4)} added`
              : credits.added_amount != null && credits.added_amount < 0
                ? `Wallet adjusted — $${Math.abs(credits.added_amount).toFixed(4)} deducted`
                : 'Wallet ledger is already up to date'}
          </div>
        )}
        {credits?.synced === false && credits.has_credits_data && (
          <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-600">
            Wallet ledger already up to date — no adjustment needed.
          </div>
        )}
        {credits && !credits.has_credits_data && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 text-xs text-amber-700">
            OpenRouter did not return credit balance info for this key.
          </div>
        )}
        {creditsError && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">{creditsError}</div>
        )}

        {credits && (
          <div className="rounded-lg border border-slate-200 divide-y divide-slate-100 text-sm">
            {credits.label && (
              <div className="flex items-center justify-between px-4 py-2">
                <span className="text-xs text-slate-500">Key label</span>
                <span className="text-xs font-medium text-slate-700">{credits.label}</span>
              </div>
            )}
            <div className="flex items-center justify-between px-4 py-2">
              <span className="text-xs text-slate-500">Usage</span>
              <span className="font-mono text-xs font-medium text-slate-700">${credits.usage.toFixed(4)}</span>
            </div>
            <div className="flex items-center justify-between px-4 py-2">
              <span className="text-xs text-slate-500">Limit</span>
              <span className="font-mono text-xs font-medium text-slate-700">
                {credits.limit == null ? 'Unlimited' : `$${credits.limit.toFixed(4)}`}
              </span>
            </div>
            {credits.limit != null && (
              <div className="flex items-center justify-between px-4 py-2">
                <span className="text-xs text-slate-500">Remaining</span>
                <span className={`font-mono text-xs font-medium ${credits.limit - credits.usage < 0.01 ? 'text-red-600' : 'text-emerald-600'}`}>
                  ${(credits.limit - credits.usage).toFixed(4)}
                </span>
              </div>
            )}
            <div className="flex items-center justify-between px-4 py-2">
              <span className="text-xs text-slate-500">Free tier</span>
              <span className={`px-1.5 py-0.5 rounded-full text-xs font-medium ${
                credits.is_free_tier ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-600'
              }`}>
                {credits.is_free_tier ? 'Yes' : 'No'}
              </span>
            </div>
            {credits.rate_limit && (
              <div className="flex items-center justify-between px-4 py-2">
                <span className="text-xs text-slate-500">Rate limit</span>
                <span className="text-xs font-medium text-slate-700">
                  {credits.rate_limit.requests} req / {credits.rate_limit.interval}
                </span>
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
