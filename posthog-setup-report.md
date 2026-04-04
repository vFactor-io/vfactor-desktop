<wizard-report>
# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into Nucleus Desktop's Electron main process using `posthog-node`. A new `analytics.ts` service module was created to manage the PostHog singleton and a persistent anonymous device ID (stored per-machine in `device-id.json`). Event capture calls were added across five Electron main-process files covering app startup, agent server lifecycle, terminal session creation, update checking and installation, and all git workspace operations. Exception tracking was added to the agent server and auto-updater error paths. The PostHog client is cleanly shut down on `before-quit`.

| Event | Description | File |
|---|---|---|
| `app_launched` | Fired when the Electron app successfully bootstraps and the main window is created | `apps/desktop/electron/main.ts` |
| `agent_server_started` | Fired when the Codex App Server process is successfully spawned | `apps/desktop/electron/services/codexServer.ts` |
| `agent_server_error` | Fired when the Codex App Server process fails to start or exits unexpectedly | `apps/desktop/electron/services/codexServer.ts` |
| `terminal_session_created` | Fired when a new terminal session (PTY) is created in the desktop app | `apps/desktop/electron/services/terminal.ts` |
| `update_available_checked` | Fired after the app checks for updates, recording whether an update was found | `apps/desktop/electron/services/updater.ts` |
| `update_install_started` | Fired when the user triggers download and installation of a pending update | `apps/desktop/electron/services/updater.ts` |
| `worktree_created` | Fired when a new git worktree (workspace) is successfully created | `apps/desktop/electron/services/git.ts` |
| `worktree_removed` | Fired when a git worktree is successfully removed | `apps/desktop/electron/services/git.ts` |
| `pull_request_merged` | Fired when a pull request is successfully merged via the desktop app | `apps/desktop/electron/services/git.ts` |
| `git_stacked_action_run` | Fired when a stacked git action (commit + push + PR) is executed | `apps/desktop/electron/services/git.ts` |

## Next steps

We've built some insights and a dashboard for you to keep an eye on user behavior, based on the events we just instrumented:

- **Dashboard — Analytics basics**: https://us.posthog.com/project/368752/dashboard/1430307
- **App Launches Over Time**: https://us.posthog.com/project/368752/insights/3nZWoEuu
- **Agent Server: Starts vs Errors**: https://us.posthog.com/project/368752/insights/Vuwofw3j
- **Workspace Creations vs Removals**: https://us.posthog.com/project/368752/insights/ykCOTHyY
- **Core Workflow Funnel: Launch → Agent → Commit**: https://us.posthog.com/project/368752/insights/gFPEPrFV
- **Update Adoption Funnel: Check → Install**: https://us.posthog.com/project/368752/insights/y018VOVX

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.

</wizard-report>
