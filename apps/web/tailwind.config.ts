/**
 * This is the Tailwind CSS configuration for Retivox.
 *
 * All brand colors, typography, spacing and border radius are defined here.
 * Changing a value here updates the entire application.
 * Dark mode is class-based for manual control.
 */

import type { Config } from 'tailwindcss'

const config: Config = {
  // Use class-based dark mode for manual control
  darkMode: 'class',

  // Scan these directories for Tailwind class usage
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './lib/**/*.{js,ts,jsx,tsx,mdx}',
  ],

  theme: {
    extend: {
      // ============================================
      // Brand color palette — defines all UI colors
      // ============================================
      colors: {
        // Primary green group — Retivox main brand color
        primary: {
          DEFAULT: '#0F7B5A',
          dark: '#1DB37A',
          light: '#D1FAE5',
          foreground: '#FFFFFF',
        },

        // Slate neutral group — backgrounds and text
        'slate-brand': {
          DEFAULT: '#1E293B',
          light: '#F8FAFC',
          muted: '#64748B',
        },

        // Accent amber group — for alerts and highlights
        accent: {
          DEFAULT: '#F59E0B',
          light: '#FEF3C7',
          foreground: '#78350F',
        },

        // Danger red group — for destructive actions and errors
        danger: {
          DEFAULT: '#EF4444',
          light: '#FEE2E2',
          foreground: '#7F1D1D',
        },

        // Success green group — for confirmations and positive states
        success: {
          DEFAULT: '#10B981',
          light: '#D1FAE5',
          foreground: '#064E3B',
        },

        // Surface group — for containers and elevated elements
        surface: {
          DEFAULT: '#FFFFFF',
          dark: '#1E293B',
          overlay: 'rgba(0,0,0,0.4)',
        },

        // Background group — page and section backgrounds
        background: {
          DEFAULT: '#F8FAFC',
          dark: '#0F172A',
        },

        // Border group — dividers and input borders
        'border-brand': {
          DEFAULT: '#E2E8F0',
          dark: '#334155',
        },
      },

      // ============================================
      // Typography — font stack and sizing
      // ============================================
      fontFamily: {
        // Inter is the primary font for all text
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },

      // ============================================
      // Spacing — border radius values
      // ============================================
      borderRadius: {
        // For cards and modals
        card: '12px',
        // For form inputs
        input: '8px',
        // For buttons
        button: '6px',
        // For status badges and pills
        badge: '999px',
      },

      // ============================================
      // Shadows — depth and elevation
      // ============================================
      boxShadow: {
        // Subtle card shadow for default state
        card: '0 1px 3px rgba(0,0,0,0.08), 0 1px 2px rgba(0,0,0,0.04)',
        // Elevated shadow on hover
        'card-hover': '0 4px 6px rgba(0,0,0,0.07), 0 2px 4px rgba(0,0,0,0.06)',
        // Green focus ring for form inputs
        'input-focus': '0 0 0 3px rgba(15,123,90,0.15)',
      },

      // ============================================
      // Font sizes — with line heights
      // ============================================
      fontSize: {
        xs: ['12px', '16px'],
        sm: ['14px', '20px'],
        base: ['16px', '24px'],
        lg: ['18px', '28px'],
        xl: ['20px', '28px'],
        '2xl': ['24px', '32px'],
        '3xl': ['30px', '36px'],
      },
    },
  },

  plugins: [],
}

export default config
