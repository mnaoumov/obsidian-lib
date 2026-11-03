---
title: Community Commands
description: Give users commands for bug reports, feature requests and GitHub discussions.
---

Register these handlers to give users three direct routes to your plugin's community. They open a browser page; the user reviews and submits the report or discussion on GitHub.

1. [OpenBugReportCommandHandler](/obsidian-lib/api/command-handlers/open-bug-report-command-handler/OpenBugReportCommandHandler/) adds **Report a bug** (`report-bug`, `bug` icon), prefilling the plugin version and bug-report environment.
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
