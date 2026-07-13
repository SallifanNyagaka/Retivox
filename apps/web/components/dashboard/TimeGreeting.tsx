'use client'

import { useEffect, useState } from 'react'

function getGreetingLabel(date: Date) {
  const hour = date.getHours()

  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

export default function TimeGreeting({ suffix = '👋' }: { suffix?: string }) {
  const [greeting, setGreeting] = useState('Good day')

  useEffect(() => {
    setGreeting(getGreetingLabel(new Date()))
  }, [])

  return (
    <>
      {greeting} {suffix}
    </>
  )
}
