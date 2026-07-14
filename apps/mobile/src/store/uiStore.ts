/**
 * Zustand UI store for Retivox mobile.
 *
 * Stores transient UI state such as toast messages and the custom More sheet
 * state used by role-based tab navigators.
 */

import { create } from 'zustand'
import type { ToastType } from '../components/ui/Toast'

export type ToastState = {
  message: string
  type: ToastType
  visible: boolean
}

export type UiState = {
  toast: ToastState | null
  isMoreMenuOpen: boolean
  showToast: (message: string, type?: ToastType) => void
  hideToast: () => void
  setMoreMenuOpen: (isOpen: boolean) => void
}

/**
 * Creates the UI store.
 *
 * @returns Zustand UI state.
 */
export const useUiStore = create<UiState>((set) => ({
  toast: null,
  isMoreMenuOpen: false,
  showToast: (message, type = 'info') => set({ toast: { message, type, visible: true } }),
  hideToast: () => set({ toast: null }),
  setMoreMenuOpen: (isMoreMenuOpen) => set({ isMoreMenuOpen }),
}))
