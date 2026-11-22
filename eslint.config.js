// @ts-check
import js from '@eslint/js'
import tseslint from 'typescript-eslint'
import globals from 'globals'

// Layer boundaries. Key: layer folder under src/.
// Value: the layers it may import from. Anything else under src/ is forbidden.
const LAYERS = {
  model: [],
  render: ['model'],
  import: ['model'],
  richtext: ['model'],
  'a11y-check': ['model'],
  editor: ['model', 'render', 'import', 'richtext', 'a11y-check'],
  ui: ['model', 'render', 'import', 'richtext', 'editor'],
  blocks: ['model', 'render', 'import', 'richtext', 'a11y-check', 'editor', 'ui'],
}

const layerRules = Object.entries(LAYERS).map(([layer, allowed]) => {
  const forbidden = Object.keys(LAYERS).filter((l) => l !== layer && !allowed.includes(l))
  return {
    files: [`src/${layer}/**/*.ts`],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            ...forbidden.map((l) => ({
              // shortcut: matches files directly in a layer folder (../x) and one level down (../../x);
              // deeper nesting needs a resolver-based rule.
              regex: `^(\\.\\./){1,2}${l}(/|$)|(^|/)src/${l}(/|$)`,
              message: `src/${layer} may not import from src/${l}.`,
            })),
            { regex: '^(\\.\\./){1,2}index(\\.ts)?$', message: 'Layers may not import the public entry point.' },
            ...(layer === 'model' ? [{ group: ['vue', 'vue/*'], message: 'src/model has no Vue.' }] : []),
          ],
        },
      ],
    },
  }
})

export default tseslint.config(
  { ignores: ['dist/', 'node_modules/', 'test-results/', 'playwright-report/'] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { project: ['./tsconfig.json', './tsconfig.node.json'], tsconfigRootDir: import.meta.dirname },
      globals: { ...globals.browser },
    },
    rules: {
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  { files: ['*.config.ts', '*.config.js', 'tests/**/*.ts'], languageOptions: { globals: { ...globals.node } } },
  { files: ['*.js', 'scripts/**/*.mjs'], ...tseslint.configs.disableTypeChecked },
  { files: ['scripts/**/*.mjs'], languageOptions: { globals: { ...globals.node } } },
  // Rendering and the model must be safe to import on a server: no browser globals.
  // Block definitions without editing components are rendered on servers too.
  { files: ['src/model/**/*.ts', 'src/render/**/*.ts', 'src/blocks/text.ts', 'src/blocks/media.ts', 'src/blocks/layout.ts', 'src/blocks/table.ts', 'src/blocks/utility.ts', 'src/blocks/core.ts', 'src/blocks/define.ts', 'src/blocks/presets.ts', 'src/render-entry.ts'], languageOptions: { globals: {} } },
  ...layerRules,
)
