'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { GlobalRole } from '@smartretail/shared'
import { requireRole } from '../../../../lib/auth/helpers'
import { createClient } from '../../../../lib/supabase/server'
import logger from '../../../../lib/logger'

export type SupplierFormState = {
  success: boolean
  error?: string | null
}

const supplierSchema = z.object({
  supplierId: z.string().uuid().optional().or(z.literal('')),
  name: z.string().trim().min(1, 'Supplier name is required').max(120),
  phone: z.string().trim().max(40).optional().default(''),
  email: z.string().trim().email('Enter a valid supplier email').optional().or(z.literal('')).default(''),
  contactPerson: z.string().trim().max(120).optional().default(''),
  notes: z.string().trim().max(240).optional().default(''),
  isActive: z.enum(['true', 'false']).default('true'),
})

const toggleSchema = z.object({
  supplierId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  phone: z.string().trim().max(40).optional().default(''),
  email: z.string().trim().email().optional().or(z.literal('')).default(''),
  contactPerson: z.string().trim().max(120).optional().default(''),
  notes: z.string().trim().max(240).optional().default(''),
  isActive: z.enum(['true', 'false']),
})

function getString(formData: FormData, key: string) {
  const value = formData.get(key)
  return typeof value === 'string' ? value.trim() : ''
}

function revalidateSupplierRoutes() {
  revalidatePath('/dashboard/owner/suppliers')
  revalidatePath('/dashboard/admin/suppliers')
  revalidatePath('/dashboard/owner/stock')
  revalidatePath('/dashboard/admin/stock')
}

export async function saveSupplier(_prevState: SupplierFormState, formData: FormData): Promise<SupplierFormState> {
  const profile = await requireRole([GlobalRole.Owner, GlobalRole.Admin])
  const businessId = profile.business_id

  if (!businessId) {
    logger.error('saveSupplier: missing business id', { userId: profile.id })
    return { success: false, error: 'Business context missing' }
  }

  const validation = supplierSchema.safeParse({
    supplierId: getString(formData, 'supplierId'),
    name: getString(formData, 'name'),
    phone: getString(formData, 'phone'),
    email: getString(formData, 'email'),
    contactPerson: getString(formData, 'contactPerson'),
    notes: getString(formData, 'notes'),
    isActive: getString(formData, 'isActive') === 'false' ? 'false' : 'true',
  })

  if (!validation.success) {
    return { success: false, error: validation.error.errors[0]?.message ?? 'Invalid supplier details' }
  }

  try {
    const supabase = await createClient()
    const { error } = await supabase.rpc('upsert_business_supplier', {
      p_supplier_id: validation.data.supplierId || null,
      p_name: validation.data.name,
      p_phone: validation.data.phone || null,
      p_email: validation.data.email || null,
      p_contact_person: validation.data.contactPerson || null,
      p_notes: validation.data.notes || null,
      p_is_active: validation.data.isActive === 'true',
    })

    if (error) {
      logger.error('saveSupplier: RPC failed', { businessId, error })
      return { success: false, error: error.message ?? 'Unable to save supplier' }
    }

    revalidateSupplierRoutes()
    logger.info('Supplier saved', { businessId, supplierId: validation.data.supplierId || 'new', actor: profile.id })
    return { success: true, error: null }
  } catch (error: unknown) {
    logger.error('saveSupplier: unexpected error', { businessId, error })
    return { success: false, error: error instanceof Error ? error.message : 'Server error' }
  }
}

export async function toggleSupplierStatus(_prevState: SupplierFormState, formData: FormData): Promise<SupplierFormState> {
  const profile = await requireRole([GlobalRole.Owner, GlobalRole.Admin])
  const businessId = profile.business_id

  if (!businessId) {
    logger.error('toggleSupplierStatus: missing business id', { userId: profile.id })
    return { success: false, error: 'Business context missing' }
  }

  const validation = toggleSchema.safeParse({
    supplierId: getString(formData, 'supplierId'),
    name: getString(formData, 'name'),
    phone: getString(formData, 'phone'),
    email: getString(formData, 'email'),
    contactPerson: getString(formData, 'contactPerson'),
    notes: getString(formData, 'notes'),
    isActive: getString(formData, 'isActive') === 'true' ? 'true' : 'false',
  })

  if (!validation.success) {
    return { success: false, error: 'Invalid supplier action' }
  }

  try {
    const supabase = await createClient()
    const { error } = await supabase.rpc('upsert_business_supplier', {
      p_supplier_id: validation.data.supplierId,
      p_name: validation.data.name,
      p_phone: validation.data.phone || null,
      p_email: validation.data.email || null,
      p_contact_person: validation.data.contactPerson || null,
      p_notes: validation.data.notes || null,
      p_is_active: validation.data.isActive === 'true',
    })

    if (error) {
      logger.error('toggleSupplierStatus: RPC failed', { businessId, supplierId: validation.data.supplierId, error })
      return { success: false, error: error.message ?? 'Unable to update supplier' }
    }

    revalidateSupplierRoutes()
    logger.info('Supplier status updated', {
      businessId,
      supplierId: validation.data.supplierId,
      isActive: validation.data.isActive === 'true',
      actor: profile.id,
    })
    return { success: true, error: null }
  } catch (error: unknown) {
    logger.error('toggleSupplierStatus: unexpected error', { businessId, error })
    return { success: false, error: error instanceof Error ? error.message : 'Server error' }
  }
}
