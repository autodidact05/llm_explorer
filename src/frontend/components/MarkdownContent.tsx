'use client'

import { useState, useRef } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'
import 'katex/dist/katex.min.css'
import type { Components } from 'react-markdown'
import { prepareMarkdownForDisplay } from '@/features/chat/markdown'

// ── Copy icon ─────────────────────────────────────────────────────────────────

function CopyIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round"
        d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  )
}

// ── Code block with copy button ───────────────────────────────────────────────
// react-markdown passes an extra `node` prop (hast element) not in standard HTML props.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function CodeBlock({ children, node }: { children?: React.ReactNode; node?: any }) {
  const [copied, setCopied] = useState(false)
  const preRef = useRef<HTMLPreElement>(null)

  // Extract language name from the first child code element's hast className
  const langClass: string = node?.children?.[0]?.properties?.className?.[0] ?? ''
  const lang = langClass.startsWith('language-') ? langClass.slice(9) : ''

  function handleCopy() {
    const text = preRef.current?.textContent ?? ''
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }).catch(() => {
      // Fallback for environments without clipboard API
      try {
        const ta = document.createElement('textarea')
        ta.value = text
        ta.style.position = 'fixed'
        ta.style.opacity = '0'
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        document.body.removeChild(ta)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      } catch { /* silent */ }
    })
  }

  return (
    <div className="my-2 rounded-lg overflow-hidden border border-slate-700">
      {/* Header bar: language label + copy button */}
      <div className="flex items-center justify-between bg-slate-800 px-3 py-1.5">
        <span className="text-xs font-mono text-slate-400 select-none">
          {lang || 'code'}
        </span>
        <button
          onClick={handleCopy}
          className={`flex items-center gap-1.5 text-xs px-2 py-0.5 rounded transition-colors select-none ${
            copied
              ? 'text-emerald-400 bg-emerald-900/30'
              : 'text-slate-400 hover:text-slate-200 hover:bg-slate-700'
          }`}
        >
          {copied ? <CheckIcon /> : <CopyIcon />}
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      {/* Code body */}
      <pre
        ref={preRef}
        className="bg-slate-900 text-slate-100 px-4 py-3 text-xs font-mono overflow-x-auto whitespace-pre m-0 leading-relaxed"
      >
        {children}
      </pre>
    </div>
  )
}

// ── Markdown component overrides ──────────────────────────────────────────────

const components: Components = {
  // Headings
  h1: ({ children }) => <h1 className="text-xl font-bold mt-4 mb-2 text-slate-900">{children}</h1>,
  h2: ({ children }) => <h2 className="text-lg font-semibold mt-3 mb-1.5 text-slate-800">{children}</h2>,
  h3: ({ children }) => <h3 className="text-base font-semibold mt-2 mb-1 text-slate-800">{children}</h3>,

  // Paragraphs — no bottom margin on last child to avoid extra padding in bubble
  p: ({ children }) => <p className="mb-2 last:mb-0 leading-relaxed">{children}</p>,

  // Inline code
  code: ({ className, children, ...props }) => {
    const isBlock = !!className
    if (isBlock) {
      return (
        <code className={`${className} block`} {...props}>
          {children}
        </code>
      )
    }
    return (
      <code className="bg-slate-100 text-slate-800 rounded px-1 py-0.5 text-[0.85em] font-mono" {...props}>
        {children}
      </code>
    )
  },

  // Fenced code blocks — delegate to CodeBlock for the copy button
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pre: CodeBlock as any,

  // Lists
  ul: ({ children }) => (
    <ul className="list-disc list-outside space-y-0.5 mb-2 ml-5 pl-1">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="list-decimal list-outside space-y-0.5 mb-2 ml-5 pl-1">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed pl-0.5">{children}</li>,

  // Blockquote
  blockquote: ({ children }) => (
    <blockquote className="border-l-4 border-slate-300 pl-3 my-2 text-slate-600 italic">
      {children}
    </blockquote>
  ),

  // Horizontal rule
  hr: () => <hr className="border-slate-200 my-3" />,

  // Tables (GFM)
  table: ({ children }) => (
    <div className="overflow-x-auto my-2">
      <table className="min-w-full text-xs border-collapse border border-slate-200 rounded">
        {children}
      </table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-slate-50">{children}</thead>,
  th: ({ children }) => (
    <th className="border border-slate-200 px-3 py-1.5 text-left font-semibold text-slate-700">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-slate-200 px-3 py-1.5 text-slate-700">{children}</td>
  ),

  // Links
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-indigo-600 hover:underline"
    >
      {children}
    </a>
  ),

  // Strong / em
  strong: ({ children }) => <strong className="font-semibold text-slate-900">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
}

function preprocessLatex(content: string): string {
  return content
    // \[...\]  →  $$...$$  (block / display math)
    .replace(/\\\[([\s\S]*?)\\\]/g, (_m, inner) => `\n$$\n${inner}\n$$\n`)
    // \(...\)  →  $...$    (inline math)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_m, inner) => `$${inner}$`)
}

export function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[rehypeKatex]}
      components={components}
    >
      {preprocessLatex(prepareMarkdownForDisplay(content))}
    </ReactMarkdown>
  )
}
