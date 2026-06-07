import type { Metadata } from 'next'
import './globals.css'
import ClientLayout from '@/components/ClientLayout'

export const metadata: Metadata = {
  title: 'LLM Explorer',
  description: 'LLM usage tracking and cost analysis',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="flex h-screen overflow-hidden bg-cream-100 font-sans antialiased text-navy-800">
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  )
}
