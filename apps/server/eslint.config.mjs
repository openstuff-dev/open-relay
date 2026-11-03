import config from '../../eslint.config.mjs';

export default [
  ...config,
  {
    // Tests and the Vitest config sit outside tsconfig.json, which only builds src.
    files: ['**/*.ts'],
    languageOptions: {
      parserOptions: { projectService: { allowDefaultProject: ['test/*.ts', 'vitest.config.ts'] } },
    },
  },
];
