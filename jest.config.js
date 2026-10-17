/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    testPathIgnorePatterns: ['/node_modules/', '<rootDir>/work/', '<rootDir>/tools/tests/', '<rootDir>/.local/', '<rootDir>/dist/'],
    modulePathIgnorePatterns: ['<rootDir>/work/', '<rootDir>/tools/tests/', '<rootDir>/.local/', '<rootDir>/dist/'],
    transform: {
        '^.+\\.[tj]sx?$': [
            'ts-jest',
            {
                useESM: true
            }
        ]
    }
};
