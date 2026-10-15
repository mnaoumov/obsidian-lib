/**
 * @file
 *
 * Paths inside this repository that only its own build and test scripts use, so they are not part of the published
 * repository-path enums.
 */

/**
 * Repository paths of this repository's own scripts.
 */
export enum LocalRepoPaths {
  /**
   * A path to the built plugin-API integration-test CONSUMER plugin within the `dist` folder. Test-only and never
   * shipped; built separately from its provider so the two carry distinct copies of this library.
   */
  DistPluginApiTestConsumer = 'dist/plugin-api-test-consumer',

  /**
   * A path to the built plugin-API integration-test PROVIDER plugin within the `dist` folder. Test-only and never
   * shipped; built separately from its consumer so the two carry distinct copies of this library.
   */
  DistPluginApiTestProvider = 'dist/plugin-api-test-provider',

  /**
   * Generated-during-build CommonJS file.
   */
  GeneratedDuringBuildCjs = 'generated-during-build.cjs',

  /**
   * Generated-during-build CommonJS declaration file.
   */
  GeneratedDuringBuildDCts = 'generated-during-build.d.cts',

  /**
   * Generated-during-build ESM declaration file.
   */
  GeneratedDuringBuildDMts = 'generated-during-build.d.mts',

  /**
   * Generated-during-build ESM JavaScript file.
   */
  GeneratedDuringBuildMjs = 'generated-during-build.mjs',

  /**
   * A path to the sources of the plugin-API integration-test CONSUMER plugin.
   */
  IntegrationTestPluginApiConsumer = 'integration-test-plugin-api/consumer',

  /**
   * A path to the sources of the plugin-API integration-test PROVIDER plugin.
   */
  IntegrationTestPluginApiProvider = 'integration-test-plugin-api/provider',

  /**
   * Generated flat re-export barrel file.
   */
  MergedTs = '__merged.ts'
}
