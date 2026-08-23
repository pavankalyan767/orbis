/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Only run files inside navigation/tests/ — keeps Next.js files out of Jest
  testMatch: ['**/navigation/tests/**/*.test.ts'],
  moduleNameMapper: {
    // The SDK is ESM-only (no "require" condition in its exports map), which
    // Jest's CJS resolver cannot load. Nothing here tests real SDK behaviour,
    // so swap it for a stub rather than moving the whole suite to ESM.
    '^@reactor-models/happy-oyster$': '<rootDir>/test-stubs/happy-oyster.ts',
    // Support the @/* path alias defined in tsconfig.json
    '^@/(.*)$': '<rootDir>/$1',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      tsconfig: {
        // ts-jest needs CommonJS modules to run in Node
        module: 'CommonJS',
        moduleResolution: 'node',
      },
    }],
  },
}

module.exports = config
