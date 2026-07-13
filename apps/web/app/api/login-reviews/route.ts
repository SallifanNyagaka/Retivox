import { NextResponse } from 'next/server'
import { createClient } from '../../../lib/supabase/server'
import logger from '../../../lib/logger'

const VALID_ROLES = new Set(['owner', 'admin', 'employee'])

type LoginReviewRow = {
  id: string
  role: 'owner' | 'admin' | 'employee'
  quote: string
  reviewer_name: string
  reviewer_title: string
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const requestedRole = searchParams.get('role')?.trim().toLowerCase() ?? ''
  const role = VALID_ROLES.has(requestedRole) ? requestedRole : null

  try {
    const supabase = await createClient()
    const { data, error } = await supabase.rpc('public_login_reviews', {
      p_role: role,
      p_limit: 8,
    })

    if (error) {
      logger.error('Login reviews fetch failed', { role, error })
      return NextResponse.json({ reviews: [] }, { status: 200 })
    }

    const reviews = ((data ?? []) as LoginReviewRow[]).map((review) => ({
      id: review.id,
      role: review.role,
      quote: review.quote,
      reviewerName: review.reviewer_name,
      reviewerTitle: review.reviewer_title,
    }))

    return NextResponse.json({ reviews })
  } catch (error) {
    logger.error('Login reviews route failed', { role, error })
    return NextResponse.json({ reviews: [] }, { status: 200 })
  }
}
