/**
 * @fileoverview This is the single entry point for the @smartretail/shared package.
 * Both the web app (Next.js) and mobile app (React Native/Expo) import from this file.
 * It re-exports everything from types, schemas and utils.
 * Any addition to types, schemas or utils is automatically available to both apps once exported here.
 */

// Re-export all shared type definitions
export * from './types/index';

// Re-export all validation schemas
export * from './schemas/index';

// Re-export all utility functions
export * from './utils/index';