/**
 * @file
 *
 * The ESLint configuration of this repository: the shared one, plus the JSDoc / TSDoc rules for the public API.
 */

import type { Linter } from 'eslint';

import {
  defineEslintConfigs,
  EslintConfigContext
} from '@mnaoumov/obsidian-dev-toolkit/linters/eslint-config';
import { RepoPaths } from '@mnaoumov/typescript-dev-toolkit/repo-paths';
import { join } from '@mnaoumov/typescript-lib/path';
// eslint-disable-next-line import-x/no-rename-default, import-x/no-named-as-default -- The default export name `index` is too confusing.
import jsdoc from 'eslint-plugin-jsdoc';
// eslint-disable-next-line import-x/no-rename-default -- The default export name `plugin` is too confusing.
import obsidianmd from 'eslint-plugin-obsidianmd';
import eslintPluginTsdoc from 'eslint-plugin-tsdoc';
import {
  defineConfig,
  globalIgnores
} from 'eslint/config';

function getIgnoreConfigs(): Linter.Config[] {
  return defineConfig([
    globalIgnores([
      join(RepoPaths.AnyPath, RepoPaths.IndexTs),
      join(RepoPaths.AnyPath, RepoPaths.AnyDts),
      join(RepoPaths.Src, '__merged.ts')
    ])
  ]);
}

function getJsdocsConfigs(context: EslintConfigContext): Linter.Config[] {
  return defineConfig([
    {
      // eslint-disable-next-line import-x/no-named-as-default-member -- `configs` is the plugin's configuration namespace.
      ...jsdoc.configs['flat/recommended-typescript-error'],
      files: context.sourceFiles,
      ignores: context.testFiles
    },
    {
      files: context.sourceFiles,
      ignores: context.testFiles,
      plugins: {
        jsdoc
      },
      rules: {
        'jsdoc/check-tag-names': [
          'error',
          {
            definedTags: [
              'remarks',
              'typeParam'
            ]
          }
        ],
        'jsdoc/check-template-names': 'error',
        /*
         * Empty JSDoc blocks are never a valid substitute for real documentation, regardless of how they appear
         * (hand-written or inserted by `jsdoc/require-jsdoc`'s autofix as a placeholder). `enableFixer: false` keeps
         * the empty block in place and reports it, forcing a real description to be written instead of silently
         * deleting the placeholder and re-triggering `require-jsdoc`.
         */
        'jsdoc/no-blank-blocks': ['error', { enableFixer: false }],
        /*
         * Inherited from `flat/recommended-typescript-error`, restated here to record that it is kept deliberately
         * and not disabled: it forbids a valued `@default` and a `@param foo=5` default in function-shaped contexts, which is
         * exactly the boundary that is wanted — the tag documents a type member, whose declaration cannot show its
         * default, and never a parameter, whose initializer already does. Both checks share the rule's single
         * `contexts` list, so keeping either means keeping both. Note the autofix STRIPS the tag's value rather than
         * reporting it, so `--fix` would silently delete such a doc.
         */
        'jsdoc/no-defaults': 'error',
        'jsdoc/require-description': 'error',
        'jsdoc/require-file-overview': [
          'error',
          {
            tags: {
              file: {
                initialCommentsOnly: true,
                mustExist: true,
                preventDuplicates: true
              }
            }
          }
        ],
        'jsdoc/require-jsdoc': [
          'error',
          {
            contexts: [
              {
                context: 'ExportNamedDeclaration > FunctionDeclaration'
              },
              {
                context: 'ExportDefaultDeclaration > FunctionDeclaration'
              },
              {
                context: 'ExportNamedDeclaration > VariableDeclaration > VariableDeclarator > ArrowFunctionExpression'
              },
              {
                context: 'ExportDefaultDeclaration > ArrowFunctionExpression'
              },
              {
                context: 'ExportNamedDeclaration MethodDefinition:not([accessibility="private"])'
              },
              {
                context: 'ExportDefaultDeclaration MethodDefinition:not([accessibility="private"])'
              },
              {
                context: 'ExportNamedDeclaration > ClassDeclaration > ClassBody > PropertyDefinition:not([accessibility=\'private\'])'
              },
              {
                context: 'ExportDefaultDeclaration > ClassDeclaration > ClassBody > PropertyDefinition:not([accessibility=\'private\'])'
              },
              {
                context: 'ExportNamedDeclaration > ClassDeclaration > ClassBody > TSAbstractPropertyDefinition:not([accessibility=\'private\'])'
              },
              {
                context: 'ExportDefaultDeclaration > ClassDeclaration > ClassBody > TSAbstractPropertyDefinition:not([accessibility=\'private\'])'
              },
              {
                context: 'ExportNamedDeclaration > TSInterfaceDeclaration'
              },
              {
                context: 'ExportNamedDeclaration > TSTypeAliasDeclaration'
              },
              {
                context: 'ExportNamedDeclaration > TSEnumDeclaration'
              },
              {
                context: 'ExportNamedDeclaration > ClassDeclaration'
              },
              {
                context: 'ExportDefaultDeclaration > ClassDeclaration'
              }
            ],
            publicOnly: false,
            require: {
              ArrowFunctionExpression: false,
              ClassDeclaration: false,
              ClassExpression: false,
              FunctionDeclaration: false,
              MethodDefinition: false
            }
          }
        ],
        'jsdoc/require-template': 'error',
        'jsdoc/require-template-description': 'error',
        'jsdoc/require-throws-type': 'off',
        'jsdoc/tag-lines': [
          'error',
          'any',
          {
            startLines: 1
          }
        ]
      },
      settings: {
        jsdoc: {
          tagNamePreference: {
            template: 'typeParam'
          }
        }
      }
    }
  ]);
}

function getObsidianLintConfigs(): Linter.Config[] {
  return defineConfig([
    {
      plugins: {
        obsidianmd
      },
      rules: {
        'eslint-comments/no-restricted-disable': 'off'
      }
    }
  ]);
}

function getTsdocsConfigs(context: EslintConfigContext): Linter.Config[] {
  return defineConfig([
    {
      files: context.sourceFiles,
      ignores: context.testFiles,
      plugins: {
        tsdoc: eslintPluginTsdoc
      }
    }
  ]);
}

export const configs: Linter.Config[] = defineEslintConfigs({
  customConfigs(context) {
    return defineConfig([
      ...getIgnoreConfigs(),
      ...getTsdocsConfigs(context),
      ...getJsdocsConfigs(context),
      ...getObsidianLintConfigs()
    ]);
  }
});
