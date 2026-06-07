'use client'

export type BraveSearchSource = {
  title: string
  url: string
}

type Props = {
  sources: BraveSearchSource[]
  compact?: boolean
}

/** Verifiable source list for replies that used Brave Search. */
export function BraveSearchSources({ sources, compact }: Props) {
  if (!sources.length) return null

  return (
    <div
      className={`rounded-lg border border-sky-200 bg-sky-50/80 ${
        compact ? 'px-3 py-2 mt-1.5' : 'px-3 py-2.5 mt-2'
      }`}
    >
      <p className="text-xs font-medium text-sky-900">
        Web search via{' '}
        <a
          href="https://brave.com/search/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-sky-700"
        >
          Brave Search
        </a>
      </p>
      <p className="text-xs text-sky-800/80 mt-0.5 mb-1.5">Sources (verify):</p>
      <ul className="space-y-1">
        {sources.map((s, i) => (
          <li key={`${s.url}-${i}`} className="text-xs leading-snug">
            <a
              href={s.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sky-800 underline break-all hover:text-sky-950"
              title={s.url}
            >
              {s.title}
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}
