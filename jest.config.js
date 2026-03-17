/**
 * Jest Configuration for Kanban Board Extension Tests
 */

module.exports = {
    // Test environment
    testEnvironment: 'jsdom',

    // Keep root extension tests scoped to the source tree so local worktrees
    // and copied package fixtures do not pollute Jest's module crawl.
    roots: [
        '<rootDir>/src'
    ],
    
    // Test file patterns
    testMatch: [
        '**/src/test/suite/**/*.test.js',
        '**/src/test/unit/**/*.test.ts'
    ],
    
    // Setup files
    setupFilesAfterEnv: [
        '<rootDir>/src/test/setup.js'
    ],
    
    // Module paths
    moduleNameMapper: {
        '^@/(.*)$': '<rootDir>/src/$1'
    },
    
    // Coverage configuration
    // Keep the gate focused on the root extension's save/conflict core until
    // broader service coverage is added. The previous repo-wide target was
    // effectively dead because it pointed at large frontend blobs that the
    // unit suite never imported, resulting in a meaningless 0% report.
    collectCoverageFrom: [
        'src/kanbanFileService.ts',
        'src/files/MarkdownFile.ts',
        'src/core/FileSaveService.ts',
        'src/services/ConflictDialogBridge.ts',
        'src/board/BoardCrudOperations.ts'
    ],
    
    coverageDirectory: 'coverage',
    
    coverageReporters: [
        'text',
        'lcov',
        'html'
    ],
    
    // Thresholds for coverage
    coverageThreshold: {
        global: {
            branches: 50,
            functions: 55,
            lines: 55,
            statements: 54
        }
    },
    
    // Transform files
    transform: {
        '^.+\\.js$': 'babel-jest',
        '^.+\\.ts$': ['ts-jest', {
            tsconfig: '<rootDir>/tsconfig.json'
        }]
    },
    
    // Ignore patterns
    testPathIgnorePatterns: [
        '/node_modules/',
        '/out/',
        '/\\.claude/',
        '/tests/marp-engine-test/'
    ],

    modulePathIgnorePatterns: [
        '<rootDir>/.claude/',
        '<rootDir>/tests/marp-engine-test/'
    ],

    watchPathIgnorePatterns: [
        '<rootDir>/.claude/',
        '<rootDir>/tests/marp-engine-test/'
    ],
    
    // Verbose output
    verbose: true,
    
    // Global setup
    // globalSetup: '<rootDir>/src/test/globalSetup.js',

    // Global teardown
    // globalTeardown: '<rootDir>/src/test/globalTeardown.js',
    
    // Mock configuration
    clearMocks: true,
    restoreMocks: true,
    
    // Timeout
    testTimeout: 10000
};
