import { Badge } from '../../../../components/ui/Badge'
import { Card, CardHeader } from '../../../../components/ui/Card'
import { createServiceRoleClient } from '../../../../lib/supabase/admin'
import { requirePlatformUser } from '../../../../lib/platform/auth'
import { approveLoginReview, rejectLoginReview } from './actions'

export const dynamic = 'force-dynamic'

type ReviewRow = {
  id: string
  role: 'owner' | 'admin' | 'employee'
  quote: string
  reviewer_name: string
  reviewer_title: string
  status: 'pending' | 'approved' | 'rejected'
  is_active: boolean
  review_note: string | null
  created_at: string
  approved_at: string | null
  business_id: string | null
  submitted_by: string | null
  businesses: { name: string } | { name: string }[] | null
}

function normalizeJoin<Row>(value: Row | Row[] | null | undefined): Row | null {
  if (!value) return null
  return Array.isArray(value) ? value[0] ?? null : value
}

function formatDateTime(value: string | null) {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

function statusVariant(status: ReviewRow['status']): 'success' | 'warning' | 'danger' {
  if (status === 'approved') return 'success'
  if (status === 'rejected') return 'danger'
  return 'warning'
}

function sortReviews(a: ReviewRow, b: ReviewRow) {
  if (a.status === 'pending' && b.status !== 'pending') return -1
  if (a.status !== 'pending' && b.status === 'pending') return 1
  return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
}

export default async function PlatformReviewsPage() {
  const platformUser = await requirePlatformUser()
  const canModerate = platformUser.role === 'developer'
  const serviceClient = createServiceRoleClient()
  const { data, error } = await serviceClient
    .from('login_reviews')
    .select('id, role, quote, reviewer_name, reviewer_title, status, is_active, review_note, created_at, approved_at, business_id, submitted_by, businesses(name)')
    .eq('role', 'owner')
    .order('created_at', { ascending: false })
    .limit(100)

  if (error) {
    throw new Error(error.message)
  }

  const reviews = ((data ?? []) as ReviewRow[]).sort(sortReviews)
  const pendingCount = reviews.filter((review) => review.status === 'pending').length

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 style={{ margin: 0, fontSize: 24, fontWeight: 900, color: 'var(--color-text-primary)' }}>
          Owner login reviews
        </h1>
        <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--color-text-muted)' }}>
          Approve owner testimonials before they become visible on the owner login page.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card padding="md">
          <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 800 }}>
            Pending
          </p>
          <p style={{ margin: '8px 0 0', fontSize: 28, fontWeight: 900, color: 'var(--color-text-primary)' }}>
            {pendingCount}
          </p>
        </Card>
        <Card padding="md">
          <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 800 }}>
            Approved
          </p>
          <p style={{ margin: '8px 0 0', fontSize: 28, fontWeight: 900, color: 'var(--color-text-primary)' }}>
            {reviews.filter((review) => review.status === 'approved').length}
          </p>
        </Card>
        <Card padding="md">
          <p style={{ margin: 0, fontSize: 12, color: 'var(--color-text-muted)', textTransform: 'uppercase', fontWeight: 800 }}>
            Rejected
          </p>
          <p style={{ margin: '8px 0 0', fontSize: 28, fontWeight: 900, color: 'var(--color-text-primary)' }}>
            {reviews.filter((review) => review.status === 'rejected').length}
          </p>
        </Card>
      </div>

      {!canModerate && (
        <Card padding="md">
          <Badge variant="warning">Read only</Badge>
          <p style={{ margin: '10px 0 0', color: 'var(--color-text-muted)', fontSize: 13 }}>
            Only platform developers can approve or reject owner login reviews.
          </p>
        </Card>
      )}

      <Card padding="md">
        <CardHeader title="Review queue" />

        {reviews.length === 0 ? (
          <p style={{ margin: 0, color: 'var(--color-text-muted)', fontSize: 14 }}>
            No owner reviews have been submitted yet.
          </p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {reviews.map((review) => {
              const business = normalizeJoin(review.businesses)

              return (
                <article
                  key={review.id}
                  className="rounded-xl"
                  style={{
                    border: '1px solid var(--color-border)',
                    backgroundColor: 'var(--color-background)',
                    padding: 16,
                  }}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Badge variant={statusVariant(review.status)}>{review.status}</Badge>
                    {review.is_active && <Badge variant="info">Visible</Badge>}
                  </div>

                  <p style={{ margin: '14px 0', color: 'var(--color-text-primary)', fontSize: 15, lineHeight: 1.6 }}>
                    &ldquo;{review.quote}&rdquo;
                  </p>

                  <div style={{ color: 'var(--color-text-muted)', fontSize: 12, lineHeight: 1.7 }}>
                    <div>
                      <strong style={{ color: 'var(--color-text-primary)' }}>{review.reviewer_name}</strong>
                      {' - '}
                      {review.reviewer_title}
                    </div>
                    <div>Business: {business?.name ?? 'Unknown business'}</div>
                    <div>Submitted: {formatDateTime(review.created_at)}</div>
                    <div>Reviewed: {formatDateTime(review.approved_at)}</div>
                  </div>

                  {review.review_note && (
                    <p
                      style={{
                        border: '1px solid var(--color-border)',
                        borderRadius: 8,
                        color: 'var(--color-text-muted)',
                        fontSize: 12,
                        lineHeight: 1.5,
                        marginTop: 12,
                        padding: '8px 10px',
                      }}
                    >
                      Note: {review.review_note}
                    </p>
                  )}

                  {canModerate && (
                    <div className="flex flex-col gap-3" style={{ marginTop: 14 }}>
                      <form action={approveLoginReview}>
                        <input type="hidden" name="reviewId" value={review.id} />
                        <button
                          type="submit"
                          className="btn-primary"
                          style={{ padding: '8px 14px', borderRadius: 8, width: '100%' }}
                        >
                          Approve and publish
                        </button>
                      </form>

                      <form action={rejectLoginReview} className="flex flex-col gap-2">
                        <input type="hidden" name="reviewId" value={review.id} />
                        <textarea
                          name="reviewNote"
                          rows={2}
                          placeholder="Optional rejection note"
                          style={{
                            width: '100%',
                            border: '1px solid var(--color-border)',
                            borderRadius: 8,
                            padding: '8px 10px',
                            color: 'var(--color-text-primary)',
                            backgroundColor: 'var(--color-surface)',
                            fontSize: 13,
                            resize: 'vertical',
                          }}
                        />
                        <button
                          type="submit"
                          className="btn-danger"
                          style={{ padding: '8px 14px', borderRadius: 8 }}
                        >
                          Reject
                        </button>
                      </form>
                    </div>
                  )}
                </article>
              )
            })}
          </div>
        )}
      </Card>
    </div>
  )
}
