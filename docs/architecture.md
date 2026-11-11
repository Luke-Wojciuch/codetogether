# Code organization

The extension is a small, layered prototype, not a framework. Tutor and quiz prompts remain independent, and Git enforcement never depends on a model being available during a commit.

## Folder layout

```text
src/
  extension.ts              VS Code entry point and panel orchestration
  commands/
    modelSettings.ts        Model/provider/API key setup
    commitGate.ts           Enable/disable gate commands
    settings.ts             Single setup menu and subsettings
  git/
    client.ts               Git subprocesses and snapshot identity
    context.ts              Staged code capture
    changes.ts              Added/deleted line counts
    commitGate.ts           Hook lifecycle and approval persistence
  models/
    llm.ts                  Provider routing and Ollama requests
    openai.ts               OpenAI Responses adapter
    stream.ts               Ollama stream parsing
  review/
    session.ts              Conversation and review state
    quiz.ts                 Question validation and grading
    assessment.ts           Evidence/assessment validation
  prompts/                  Tutor, quiz, and grading instructions
  test/                     Automated regression tests
UI/                         Review webview HTML, CSS, and JavaScript
hooks/                      Standalone Git hook
docs/                       Architecture and supporting documentation
out/                        Generated JavaScript; mirrors src/
```

`src/extension.ts` remains the entry point so the extension manifest does not change. TypeScript discovers nested source files automatically; test output stays under `out/test/`. The hook resource path and test module-loading paths account for the nested folders. Rebuild after moving sources; obsolete flat generated copies have been removed and should not be edited or restored as source.

## Boundaries

- **VS Code integration:** `src/extension.ts` owns review panels, selection capture, model cancellation, snapshot previews, and message dispatch. `src/commands/settings.ts` owns the single settings command and its submenus. `src/commands/modelSettings.ts` owns provider/model/key dialogs. `src/commands/commitGate.ts` owns trusted-workspace repository selection and confirmation before installing/removing a hook.
- **Review domain:** `src/review/session.ts` owns successful conversation history, current quiz/assessment, and the last successfully assessed submission. `src/review/quiz.ts` validates questions and grades submitted answers. `src/review/assessment.ts` validates evidence and assessment metadata. None of these installs hooks or reads API keys.
- **Instructions:** `src/prompts/tutor.ts`, `quiz.ts`, and `assessment.ts` separate teaching, question generation, and grading. Tutor behavior does not double as a commit policy.
- **Model adapters:** `src/models/llm.ts` selects the provider. `src/models/openai.ts` handles Responses and strict schemas; `src/models/stream.ts` handles Ollama's stream. The webview never receives an API key.
- **Git:** `src/git/client.ts` centralizes Git subprocesses and tree/parent identities. `src/git/context.ts` builds staged code context and checks that its snapshot stayed stable during capture. `src/git/commitGate.ts` owns safe installation/removal and approval persistence. `hooks/pre-commit` checks the actual commit index without importing extension code.
- **Presentation:** `UI/review.html`, `review.css`, and `review.js` render the tutor, quiz, recap, and approval action. UI affordances are not trusted to establish eligibility: the extension host checks the session and Git snapshot again.
- **Tests:** `src/test` contains session/domain regressions, a DOM stand-in for UI flows, mocked model/native-dialog tests, and isolated real-Git gate tests. No test needs a real API key or running model.

## Commit approval flow

1. A developer explicitly enables the gate; existing hooks and hook-manager settings are not replaced.
2. An all-staged review captures the complete staged tree ID and current HEAD before/after reading code. Partial or selection scope is marked ineligible.
3. The session remembers a submission only after all requested answers receive a validated assessment. A new quiz/goal clears that eligibility. Failed submissions do not replace a previous successful result.
4. The developer chooses **Approve staged commit**. The host checks scope, submitted-answer equality, the managed hook, and the current Git tree/HEAD. It atomically writes only the approved IDs under the current worktree's Git metadata.
5. On `git commit`, the shell hook compares those IDs with HEAD and `git write-tree` using Git's own index environment. A mismatch blocks the commit and prints review instructions. An approved match allows Git to continue; the extension never runs the commit itself.

Quiz completion is the default policy, not a perfect score. Gaps are allowed unless the optional strict setting is on. Approval does not certify correctness. This is a bypassable local workflow aid, not server-side access control.

## Deliberate limits / next cleanup

`extension.ts` still coordinates several panel concerns, and `UI/review.js` still contains all browser view state/rendering. Those are the main remaining refactoring candidates. They are kept intact here to avoid a broad UI rewrite alongside Git enforcement. There is no automatic hook chaining, automatic editor launch from Git, or push/CI gate.
