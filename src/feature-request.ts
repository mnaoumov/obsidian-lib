/**
 * @file
 *
 * Links to a plugin's feature-request issue form without collecting a bug-report environment.
 */

import type { App } from 'obsidian';

import { getGitHubIssueFormUrl } from './bug-report.ts';

/**
 * The feature-request form's file name under `.github/ISSUE_TEMPLATE`.
 */
export const FEATURE_REQUEST_ISSUE_FORM_TEMPLATE = 'feature_request.yml';

/**
 * Field ids the feature-request form must use for prefilling.
 */
export enum FeatureRequestIssueFormFieldId {
  /**
   * The requesting plugin's installed version.
   */
  PluginVersion = 'plugin-version'
}

/**
 * Parameters for {@link getFeatureRequestIssueFormUrl}.
 */
export interface GetFeatureRequestIssueFormUrlParams {
  /**
   * The Obsidian app instance.
   */
  readonly app: App;
  /**
   * The repository, as `owner/name`.
   */
  readonly gitHubRepo: string;
  /**
   * The requesting plugin's id.
   */
  readonly pluginId: string;
  /**
   * The form's file name under `.github/ISSUE_TEMPLATE`.
   *
   * @default {@link FEATURE_REQUEST_ISSUE_FORM_TEMPLATE}
   */
  readonly template?: string;
  /**
   * The issue's title. Omit to keep the form's default title.
   */
  readonly title?: string;
}

/**
 * Gets the feature-request form URL, prefilling only {@link FeatureRequestIssueFormFieldId.PluginVersion}.
 *
 * @param params - The parameters.
 * @returns The link.
 */
export function getFeatureRequestIssueFormUrl(params: GetFeatureRequestIssueFormUrlParams): string {
  return getGitHubIssueFormUrl({
    fields: { [FeatureRequestIssueFormFieldId.PluginVersion]: params.app.plugins.manifests[params.pluginId]?.version ?? 'unknown' },
    gitHubRepo: params.gitHubRepo,
    template: params.template ?? FEATURE_REQUEST_ISSUE_FORM_TEMPLATE,
    ...params.title !== undefined && { title: params.title }
  });
}
