/**
 * This file contains server-side auth helper functions.
 *
 * These functions are used by layouts, pages and server actions to check auth state.
 * They must only be called from server-side code — never from client components.
 *
 * Performance note: functions are kept minimal and only fetch what they need.
 */

import { redirect } from "next/navigation";
import { cache } from "react";
import { createClient } from "../supabase/server";
import { GlobalRole } from "@smartretail/shared";

export type UserProfile = {
  id: string;
  name: string | null;
  email: string | null;
  global_role: GlobalRole | null;
  business_id: string | null;
  is_active: boolean | null;
};

/**
 * Creates a Supabase server client and returns the authenticated user.
 *
 * Uses getUser() not getSession() for security — getSession() reads from cookie without server verification.
 *
 * @returns The authenticated user object, or null when not authenticated.
 */
export const getSession = cache(async function getSession() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user ?? null;
});

/**
 * Enforces authentication for protected server-side pages, layouts, and actions.
 *
 * Use this at the top of any protected server component or layout.
 * If no authenticated user exists, the request is redirected to /login.
 *
 * @returns The authenticated user object.
 */
export async function requireAuth() {
  const user = await getSession();

  if (!user) {
    redirect("/login");
  }

  return user;
}

/**
 * Loads the user profile from the users table by user ID.
 *
 * Selects only needed columns as a performance requirement.
 *
 * @param userId The authenticated user's ID.
 * @returns The user profile, or null when not found.
 */
export const getUserProfile = cache(async function getUserProfile(userId: string): Promise<UserProfile | null> {
  const supabase = await createClient();
  const { data, error } = (await supabase
    .from("users")
    .select("id, name, email, global_role, business_id, is_active")
    .eq("id", userId)
    .maybeSingle()) as {
    data: UserProfile | null;
    error: unknown;
  };

  if (error) {
    return null;
  }

  return data;
});

/**
 * Enforces both authentication and role authorization.
 *
 * Use this to protect pages that require specific roles.
 * If the user is missing, inactive, or has an unauthorized global role,
 * the request is redirected to the appropriate page.
 *
 * @param allowedRoles The list of allowed global roles.
 * @returns The authenticated user's profile.
 */
export async function requireRole(allowedRoles: GlobalRole[]) {
  const user = await requireAuth();
  const profile = await getUserProfile(user.id);

  if (!profile || profile.is_active === false) {
    redirect("/login");
  }

  if (profile.global_role === null || !allowedRoles.includes(profile.global_role)) {
    redirect("/unauthorized");
  }

  return profile;
}

/**
 * Returns the authenticated user's business ID.
 *
 * If the profile cannot be found, or the user is not authenticated,
 * this returns null.
 *
 * @returns The business_id value, or null when unavailable.
 */
export async function getBusinessId(): Promise<string | null> {
  const user = await requireAuth();
  const profile = await getUserProfile(user.id);

  return profile?.business_id ?? null;
}
