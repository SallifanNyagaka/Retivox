/**
 * Root page — redirects to login.
 *
 * The root URL / always redirects to /login.
 * Authenticated users are redirected to their dashboard by the auth layout.
 * This keeps the root URL clean and predictable.
 */

import { redirect } from 'next/navigation'

export default function RootPage() {
  redirect('/login')
}