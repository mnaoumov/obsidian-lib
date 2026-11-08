---
title: Community Commands
description: Give users commands for bug reports, feature requests and GitHub discussions.
---

Register these handlers to give users three direct routes to your plugin's community. They open a browser page; the user reviews and submits the report or discussion on GitHub.

1. [OpenBugReportCommandHandler](/obsidian-lib/api/command-handlers/open-bug-report-command-handler/OpenBugReportCommandHandler/) adds **Report a bug** (`report-bug`, `bug` icon), prefilling the plugin version and bug-report environment, plus any [diagnostics](#bug-report-diagnostics) the user agrees to include.
2. [OpenFeatureRequestCommandHandler](/obsidian-lib/api/command-handlers/open-feature-request-command-handler/OpenFeatureRequestCommandHandler/) adds **Request a feature** (`request-feature`, `lightbulb` icon), prefilling only the plugin version.
3. [OpenDiscussionCommandHandler](/obsidian-lib/api/command-handlers/open-discussion-command-handler/OpenDiscussionCommandHandler/) adds **Start a discussion** (`start-discussion`, `messages-square` icon), selecting a discussion category.

## Register the commands

Use `buildCommand()` with Obsidian's `addCommand`, or return the handlers from your existing `CommandHandlerComponent` registration factory.

```ts
import { OpenBugReportCommandHandler } from '@mnaoumov/obsidian-lib/command-handlers/open-bug-report-command-handler';
import { OpenDiscussionCommandHandler } from '@mnaoumov/obsidian-lib/command-handlers/open-discussion-command-handler';
import { OpenFeatureRequestCommandHandler } from '@mnaoumov/obsidian-lib/command-handlers/open-feature-request-command-handler';
import { Plugin } from 'obsidian';

export class AlphaPlugin extends Plugin {
  public override onload(): void {
    const params = { app: this.app, gitHubRepo: 'owner/repo', pluginId: this.manifest.id };
    this.addCommand(new OpenBugReportCommandHandler(params).buildCommand());
    this.addCommand(new OpenFeatureRequestCommandHandler(params).buildCommand());

    const isDiscussionsEnabled = true; // Set this to match your repository's GitHub settings.
    if (isDiscussionsEnabled) {
      this.addCommand(new OpenDiscussionCommandHandler({
        gitHubRepo: params.gitHubRepo,
        isDiscussionsEnabled
      }).buildCommand());
    }
  }
}
```

Discussions defaults to the `q-a` category slug because questions are the support route distinct from bug reports and feature requests. Pass `category: 'ideas'` or another existing category slug to override it. The handler requires `isDiscussionsEnabled` explicitly: it performs no GitHub API lookup, needs no token and works offline until the browser opens. Omit registration when Discussions is disabled; if a handler is registered with `isDiscussionsEnabled: false`, Obsidian hides it from the palette and executing it opens nothing. Enable Discussions and create the selected category in your repository before offering the command.

## Issue form contracts

GitHub [prefills issue form fields by their ids](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue#creating-an-issue-from-a-url-query). A label alone does not enable prefilling.

1. The bug form is `.github/ISSUE_TEMPLATE/bug_report.yml`. Give its fields the ids `plugin-version`, `obsidian-version`, `operating-system` and `environment`, as `BugReportIssueFormFieldId` declares. The environment includes the plugin, Obsidian and installer versions, platform, operating system and other enabled plugins.
2. The feature form is `.github/ISSUE_TEMPLATE/feature_request.yml`. Give its version input the id `plugin-version`, as `FeatureRequestIssueFormFieldId.PluginVersion` declares. No environment dump is collected. A missing plugin manifest produces `unknown` for the version.

For example, the feature form can include:

```yaml
- type: input
  id: plugin-version
  attributes:
    label: Plugin version
```

`OpenFeatureRequestCommandHandler` also accepts `template` for a different form file name and `title` to override the form's own title. The URL helpers [getFeatureRequestIssueFormUrl](/obsidian-lib/api/feature-request/getFeatureRequestIssueFormUrl/) and [getGitHubDiscussionUrl](/obsidian-lib/api/git-hub-discussion/getGitHubDiscussionUrl/) are available when you need a link outside the command palette. The handlers share [OpenGitHubCommandHandler](/obsidian-lib/api/command-handlers/open-git-hub-command-handler/OpenGitHubCommandHandler/), which owns the repository and browser-opening behavior.

The [feature command tests](https://github.com/mnaoumov/obsidian-lib/blob/main/src/command-handlers/open-feature-request-command-handler.test.ts), [discussion command tests](https://github.com/mnaoumov/obsidian-lib/blob/main/src/command-handlers/open-discussion-command-handler.test.ts) and [Obsidian integration test](https://github.com/mnaoumov/obsidian-lib/blob/main/src/command-handlers/git-hub-commands.obsidian.integration.test.ts) pin registration, navigation and disabled Discussions behavior.

## Bug-report diagnostics

A bug report can also carry logs and the plugin's own settings, but only ones the user has seen and agreed to send. Pass `getDiagnostics` to `OpenBugReportCommandHandler`. It is called each time the command runs and returns [BugReportDiagnosticSection](/obsidian-lib/api/bug-report-diagnostics/BugReportDiagnosticSection/) objects. When it returns any, a review modal opens before the browser does. It shows a switch per section and a preview of the exact text the form will receive. A section marked `isPotentiallyPrivate` starts switched off, and Cancel opens nothing. Without `getDiagnostics` the command behaves as before: the form opens with the environment only.

```ts
import { BugReportLogBuffer, createSettingsDiagnosticSection } from '@mnaoumov/obsidian-lib/bug-report-diagnostics';
import { OpenBugReportCommandHandler } from '@mnaoumov/obsidian-lib/command-handlers/open-bug-report-command-handler';
import { Plugin } from 'obsidian';

export class AlphaPlugin extends Plugin {
  private readonly bugReportLog = new BugReportLogBuffer({ maxEntries: 100 });

  public override async onload(): Promise<void> {
    const settings: unknown = await this.loadData();
    this.bugReportLog.add('Loaded');
    this.addCommand(new OpenBugReportCommandHandler({
      app: this.app,
      getDiagnostics: () => [
        this.bugReportLog.toSection(),
        createSettingsDiagnosticSection({ secretKeys: ['apiToken'], settings })
      ],
      gitHubRepo: 'owner/repo',
      pluginId: this.manifest.id
    }).buildCommand());
  }
}
```

What each helper does, and what it does not:

1. [BugReportLogBuffer](/obsidian-lib/api/bug-report-diagnostics/BugReportLogBuffer/) keeps only what the plugin `add`s after creating it, each entry timestamped. Nothing reads the console, so there is no history from before the buffer existed. It keeps at most `maxEntries` entries (200 by default), dropping the oldest first, and cuts an entry longer than `maxEntryLength` (2,000 characters) with a `[truncated]` marker. Its section is potentially private.
2. [createSettingsDiagnosticSection](/obsidian-lib/api/bug-report-diagnostics/createSettingsDiagnosticSection/) renders the settings object you pass, normally your own `data.json`, as JSON. It never reads another plugin's data. The values of the `secretKeys` you name are replaced with `[redacted]` at any depth, compared without case. Redaction finds only those keys. A token pasted into some other field is not caught, which is why the section starts excluded and the user sees the preview.
3. Each section is rendered as a `### <title>` heading and a fenced block longer than any backtick run in its content, then appended to the `environment` field. No new form field id is needed.

### Reports too long for a link

GitHub fails a long issue-form URL instead of truncating it. Measured against `github.com` on 2026-11-07, signed out, a URL of about 6,540 characters still opened the form, about 8,088 got a 502, and 8,288 or more got a 414. [buildBugReportIssueFormLink](/obsidian-lib/api/bug-report/buildBugReportIssueFormLink/) therefore measures the encoded URL against `DEFAULT_BUG_REPORT_MAX_URL_LENGTH` (6,000 characters, overridable with `maxUrlLength`). Non-ASCII text counts at its percent-encoded size, so one Cyrillic letter costs 6 characters and an emoji costs 12. When the report fits, the link carries all of it. When it does not, the environment field gets a short note asking the user to paste, the other fields keep their values, and the full text is returned as `clipboardText`. The handler copies it to the clipboard, shows a notice, and opens the short link. If the clipboard refuses the write, which can happen when the window has no focus or the platform blocks it, a modal shows the text read-only for copying by hand, with a button that opens the form. Nothing is truncated on either path. `getBugReportIssueFormUrl` keeps returning the full link regardless of length, as it always has.
