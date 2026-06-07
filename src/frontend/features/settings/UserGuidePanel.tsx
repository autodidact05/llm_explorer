'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

import userGuideMd from '@/content/user-guide.md'

export function UserGuidePanel() {
  return (
    <article className="px-6 py-5 prose prose-sm prose-slate max-w-none prose-headings:text-slate-900 prose-a:text-indigo-600">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{userGuideMd}</ReactMarkdown>
    </article>
  )
}
