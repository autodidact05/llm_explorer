const CONTACT_EMAIL = 'souvik.cloud@gmail.com'

export default function ContactPage() {
  return (
    <div className="p-8 max-w-lg">
      <h1 className="text-2xl font-bold text-slate-900">Contact</h1>
      <p className="text-slate-600 mt-3 leading-relaxed">
        For feedback, bug reports, or general comments about LLM Explorer, send an email to:
      </p>
      <p className="mt-6">
        <a
          href={`mailto:${CONTACT_EMAIL}`}
          className="text-lg font-medium text-indigo-600 hover:text-indigo-700 underline underline-offset-2"
        >
          {CONTACT_EMAIL}
        </a>
      </p>
      <p className="text-sm text-slate-500 mt-8">
        Include as much detail as you can for bugs (steps to reproduce, what you expected, screenshots if helpful).
      </p>
    </div>
  )
}
