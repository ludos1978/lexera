module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  moduleNameMapper: {
    '^@ludos/shared$': '<rootDir>/../shared/src/index',
  },
  // nephele uses ESM, transform it for Jest
  transformIgnorePatterns: [
    'node_modules/(?!nephele/)',
  ],
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
    '^.+\\.js$': ['ts-jest', { useESM: false }],
  },
};
