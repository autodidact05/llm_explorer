'use client'

export function Spinner({ sm }: { sm?: boolean }) {
  return (
    <span
      className={`inline-block border-2 border-current border-t-transparent rounded-full animate-spin ${sm ? 'w-3 h-3' : 'w-4 h-4'}`}
    />
  )
}

