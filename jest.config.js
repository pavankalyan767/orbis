/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  // Only run files inside navigation/tests/ — keeps Next.js files out of Jest
  testMatch: ['**/navigation/tests/**/*.test.ts'],
  moduleNameMapper: {
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
