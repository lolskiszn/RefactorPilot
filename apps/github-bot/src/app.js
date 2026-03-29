import { analyzePullRequest, buildCheckRun } from "./analysis.js";
import { buildCheckRunPayloadFromAnalysis, buildPreviewCommentFromAnalysis } from "./messages.js";
import { loadRefactorPilotConfig } from "./config.js";

export function createRefactorPilotBot({ config = null, logger = console } = {}) {
  const runtimeConfig = config ?? null;

  return {
    async handlePullRequest(context) {
      const repoRoot = context?.payload?.repository?.name ? "." : ".";
      const loadedConfig = runtimeConfig ?? (await loadRefactorPilotConfig(repoRoot));
      const files = context?.payload?.pull_request?.files ?? context?.files ?? [];
      const analysis = analyzePullRequest({
        config: loadedConfig,
        files,
        pullRequest: context?.payload?.pull_request ?? context?.payload ?? {},
      });

      const comment = buildPreviewCommentFromAnalysis(analysis);
      const checkRun = buildCheckRunPayloadFromAnalysis(analysis, {
        pullRequest: context?.payload?.pull_request ?? context?.payload ?? {},
      });

      if (context?.octokit?.issues?.createComment && loadedConfig.commentOnPullRequest) {
        await context.octokit.issues.createComment({
          body: comment,
          issue_number: context.payload.pull_request.number,
          owner: context.payload.repository.owner.login,
          repo: context.payload.repository.name,
        });
      }

      if (context?.octokit?.checks?.create && loadedConfig.createCheckRuns) {
        await context.octokit.checks.create({
          ...checkRun,
          head_sha: context.payload.pull_request.head.sha,
          owner: context.payload.repository.owner.login,
          repo: context.payload.repository.name,
        });
      }

      logger.info?.("RefactorPilot analyzed pull request", {
        readOnly: analysis.readOnly,
        patterns: analysis.inferredPatterns,
      });

      return {
        analysis,
        checkRun,
        comment,
      };
    },
  };
}

export function registerRefactorPilotBot(app, options = {}) {
  const bot = createRefactorPilotBot(options);

  if (app && typeof app.on === "function") {
    app.on(["pull_request.opened", "pull_request.reopened", "pull_request.synchronize"], async (context) => {
      await bot.handlePullRequest(context);
    });
    app.on("check_run.rerequested", async (context) => {
      await bot.handlePullRequest(context);
    });
  }

  return bot;
}
