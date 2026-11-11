# CodeTogether

CodeTogether is an early VS Code research prototype for building your understanding of code through a goal-first conversation. The companion adapts to what you need: a broad map of how parts connect, or detailed help with a method or selected lines. It offers context and explanations while leaving room for you to reason, predict, and push back. It uses your choice of Ollama or OpenAI GPT and does not edit your code. An optional local commit gate can require quiz completion and explicit approval of the staged snapshot.

## Use

1. Run **CodeTogether: Settings** from the Command Palette. Its menu shows the current model, whether an OpenAI key is saved, the commit gate for a single open repository, and the strict quiz toggle. Choose a setting to change; key and gate actions open set/remove and enable/disable submenus. For Ollama, start Ollama, install a model, and enter its exact name from `ollama list`. For OpenAI, accept the cloud-data/usage notice, enter a model ID available to your API account (default `gpt-5-mini`), and paste your API key into the masked popup when prompted. Choosing a provider or saving a key does not call a model.
2. Select code and run **CodeTogether: Understand This Code** from the editor context menu or Command Palette. No staging is required.
3. Alternatively, right-click a staged Source Control file and choose **CodeTogether: Understand This Change**. **CodeTogether: Open Review** reviews all staged changes; multi-folder workspaces prompt you to choose a repository.
4. **Your goal:** describe what you want to understand before committing, or choose a suggested starting point. Check the supplied files, then choose **Start tutor** for a conversation or **Start review quiz** to go straight to questions. Loading files does not call the model.
5. **Talk it through:** start with what you need help understanding. For a general request, the companion offers a brief map and helps find a useful starting point. For a specific method or expression, it answers directly and works with relevant lines and concrete examples. It teaches one useful piece at a time, builds on your ideas, and invites a small prediction or application during guided exploration. Direct questions still receive direct answers, and it asks for clarification only when needed. If you're stuck, it should give more support instead of repeatedly testing you. **Give me a hint**, **Work through an example**, and **Seems off** prepare editable follow-ups. Use **Edit** to redirect the goal; successful goal changes clear the quiz and its results. Changing depth within the same goal does not reset them. **Browse files** returns to the file list without losing your discussion or draft.
6. **Review quiz:** opening the quiz generates 1–4 code-specific questions, using your current goal and code snapshot. Simple code usually needs only 1–2 questions; more complex code can use 3–4. The model chooses relevant topics from purpose, behavior, effect, and edge cases without padding the quiz to cover every topic. Questions include validated links to the relevant source lines; diff-only sessions refer to the supplied diff. No solutions or answer keys are requested. Each question needs a response; choose **I'm not sure** to explicitly record uncertainty. A progress indicator tracks responses separately from understanding. **Submit quiz** sends the responses for independent assessment against their generated questions. Short, informal answers are fine when the central idea is broadly correct. Feedback appears after submission, and each gap offers **Help with…** to return to the tutor. **Get help from the tutor** preserves the quiz, answers, and discussion draft. Returning to the same quiz does not regenerate questions. Editing a goal successfully clears its quiz and results.
7. **Recap:** after submitting the quiz, choose **Continue to recap**. Once a quiz has been generated, every generated question must have a response and a successful assessment before continuing; editing an answer requires resubmission. Finishing does not require every question to pass, and an explicit uncertainty can remain a gap. Tutor-only sessions can still use **Recap** without a quiz. **Keep exploring** resumes the conversation. **Finish review** marks this review finished in the panel with any gaps recorded; it does not commit or push code.

The recap's brain reflects the latest submitted quiz, within your goal and scope. The model uses discussion to interpret shorthand and references, while the current quiz responses supply the evidence. Each supported area must include a nonempty exact quote from the submission, with no minimum length. Each field is assessed in a separate model request against its generated question. Help is allowed; restating a broadly correct idea in your own words is enough, while bare agreement alone is not. Every resubmitted quiz reassesses its generated questions without automatically carrying over earlier evidence. Returning to discussion preserves the last result until another submission or a goal change. Generation and assessment requests use structured JSON. Missing or invalid data shows a retry message and preserves your goal, existing questions, answers, and last successful assessment. Missing code context is recorded as uncertainty, not a developer error. Quote validation checks that the words were said; the model judges their meaning and correctness. These judgments are not a certification or guarantee of code correctness; conversational and assessment quality still need live-model verification.

The walkthrough opens beside the editor with per-file added/deleted line counts and review totals. Binary files have no line counts; deleted files remain listed with their diff. Renames are counted as a deletion and an addition. Selection sessions show their file without staged counts.

Use **Show code** on a file to browse its supplied contents. References in answers open an inline preview of the cited line or range with surrounding context. Drag to highlight your own code selection; the touched lines stay highlighted when you use the actions. **Open in editor** selects those lines in a read-only snapshot; **Ask about this code** adds a question about those lines to your draft without sending it. The scope and staged diff are available in a disclosure.

## Optional Git commit blocker

The gate is opt-in and is not installed automatically. To try it after compiling/restarting the extension:

1. Open a trusted Git workspace, run **CodeTogether: Settings**, choose **Commit review gate**, then **Enable commit review gate**. Confirm the repository in the native dialog. In a multi-folder workspace, choose the repository first.
2. Stage your intended changes. A normal `git commit` now stops unless that exact staged snapshot has approval. The error tells you to open the review; it does not launch VS Code or a model from inside Git.
3. Run **CodeTogether: Open Review** for **all** staged changes. Submit every generated quiz question, continue to the recap, and click **Approve staged commit**. The answers must match the latest successful assessment. By default, recorded uncertainty and gaps are allowed; passing every question is not required. **Finish review** alone does not approve a commit.
4. Retry the commit yourself. Staging different content, changing file modes/paths, or changing HEAD invalidates the matching approval. Unstaged edits do not affect an ordinary staged-only commit. `git commit -a` and partial commits are checked against the actual index Git gives the hook, which must match the approved tree.

**Finish review** alone does not approve a commit. Selection reviews, staged-file-only reviews, tutor-only sessions, incomplete quizzes, and failed assessments cannot create approval. Large all-staged scopes that exceed the existing context limit cannot be approved through a smaller single-file review.

Optional strict approval is the **Require all quiz questions** toggle in **CodeTogether: Settings** or the VS Code user setting `codetogether.requireAllQuizQuestions`, off by default. It is stored in user settings, not the repository's `.vscode/settings.json`. When on, every generated question must be assessed as **Understanding shown** before approving the staged snapshot. You can still finish a review with gaps. The toggle applies to new approvals; a snapshot already approved under the previous setting remains approved until its staged tree or HEAD changes. Assessment caveats about unseen code do not count as unanswered quiz questions.

To check both modes manually, submit a quiz with **I'm not sure** for one question. With strict approval off, the approval button is available after the recap. Turn strict approval on in Settings: the button becomes unavailable until you revise that answer and resubmit it with understanding shown.

**Settings → Commit review gate → Disable commit review gate** removes only the unmodified CodeTogether hook. Installation refuses existing pre-commit hooks, symbolic-link hook files, and configured `core.hooksPath` hook managers; automatic chaining is not supported. It never overwrites or disables another hook or changes Git configuration. Git shares its default hooks among linked worktrees, so enabling/disabling affects those worktrees too; approval records remain worktree-specific.

Approval stores only the parent commit ID and staged tree ID under the current worktree's Git metadata (`codetogether/approved-snapshot`), outside tracked source. No answers, conversation, or API key enter that record. It persists after closing the panel and after disabling the gate; it matches only the same parent and tree. The hook needs Git and a POSIX shell (provided by Git for Windows), not Node.js, VS Code, Ollama, or an API connection at commit time. No commit or push is made by the extension.

This is local workflow enforcement, not a security boundary or proof of understanding. Git allows bypassing a [pre-commit hook with `--no-verify`](https://git-scm.com/docs/githooks#_pre_commit); users can also remove local hooks or edit local metadata. It does not protect pushes, server-side merges, or every Git history-writing operation. Team-wide enforcement would require a separate server/CI design. The tree identity comes from [Git's index via `git write-tree`](https://git-scm.com/docs/git-write-tree), not from model text or working-tree file hashes.

## OpenAI API key settings

- **Settings → OpenAI API key → Set OpenAI API key** opens a native VS Code input window with the key masked. Keys are stored in VS Code's secret storage, never workspace settings or repository files. Existing keys are never prefilled. Cancel leaves the saved key unchanged.
- **Settings → OpenAI API key → Remove OpenAI API key** deletes the saved key. OpenAI requests then stop with setup guidance until a new key is saved; the extension never silently falls back to another provider.
- **Settings → Model provider and model** configures the provider and model in native dialogs. OpenAI setup prompts for a key if one is missing. Cancelling setup keeps the existing provider. Ollama and OpenAI keep separate model names, so switching does not overwrite the other provider's selection.
- OpenAI is opt-in; Ollama remains the default. Selecting OpenAI sends the supplied code, goal, conversation, and submitted quiz answers to the OpenAI API when you request generation or feedback. API usage may incur charges. This is API-key authentication, not ChatGPT sign-in.
- The OpenAI path uses the [Responses API](https://developers.openai.com/api/docs/guides/text) and [strict structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs) for quizzes and grading, while retaining application validation. Optional quiz references become nullable in the OpenAI schema. Requests set `store: false`; this does not imply zero retention under every API account policy.
- Provider settings are user-level (`codetogether.provider` and `codetogether.openaiModel`); workspace configuration cannot silently switch the extension to the cloud provider. The key stays in the extension host, not the review webview.

## Context and limits

- Selection sessions include the selected lines and up to 40 surrounding lines on either side. Staged sessions include a function-context diff and the complete staged text of changed non-deleted files within the size limit.
- Other files, configuration, callers, tests, and runtime behavior are not automatically inspected. Binary files are not supplied as source text; deleted code may only appear in the diff.
- Each panel remembers successful turns, including corrections and depth requests. Closing it discards the conversation session, but an explicit commit approval persists separately in Git metadata; **New session** clears the conversation and reloads its original scope. Select code again to change the selection scope.
- Context changes are checked before each model request. If it changed, start a new session. When a selection moves after edits, reselect it and run the command again.
- Cancel stops a model request. Failed requests preserve your draft and history; Retry resends the failed turn. Requests time out after two minutes.
- An animated thinking indicator stays visible until the full response is ready, then the reply appears with styled paragraphs, headings, lists, bold text, inline code, code blocks, and clickable code references. During longer waits, helpful messages rotate every 20 seconds. Model HTML is displayed as text. Cancelled or failed partial answers are removed and never enter conversation history.
- Ollama thinking is disabled by default to reduce the wait on models that support disabling it. Enable **CodeTogether: Thinking** in Settings to compare reasoning quality; some models require thinking regardless. This setting does not apply to OpenAI. Responses are displayed only when complete; the OpenAI path uses a non-streaming Responses request.
- Context and conversation have conservative character limits; smaller models may hit their own limits sooner. Oversized sessions fail explicitly rather than silently dropping code or corrections.
- Ollama requests go to `http://localhost:11434/api/chat`; processing location depends on your Ollama model/setup. OpenAI requests go only to `https://api.openai.com/v1/responses`. Conversation and answers are not written to disk by the extension. API keys persist in VS Code secret storage; explicit commit approval persists separately as Git object IDs in Git metadata. Enabling the gate writes its pre-commit hook. Capturing staged snapshots uses `git write-tree`, which may add tree objects to Git's object database without creating commits.
- Explanations can be wrong. Validated links establish that a source location exists, not that the explanation is correct.
- Quiz line references are optional. Missing or out-of-bounds references show **Browse supplied code** instead of blocking the quiz; the extension never guesses or clamps a location. Valid references remain clickable.
- Quiz grading requires explanatory feedback, not a bare verdict such as "demonstrated". A verdict-only reply shows a retry message and preserves answers and the last successful result rather than displaying it alongside a potentially conflicting grade.

## Development

Requires VS Code matching `package.json`, Node.js LTS, npm, and Git for staged reviews.

```sh
npm ci
npm run compile
npm run lint
npm test
```

Press F5 to launch the Extension Development Host.
The debug window opens this repo with other installed extensions disabled. Network inspection is disabled for this workspace because the local debugger logs showed inspector errors alongside Extension Host crashes. Breakpoints remain available.

- `src/extension.ts`: review entry points, context capture, panel lifecycle, cancellation, snapshot navigation, and host-side message dispatch.
- `src/commands/modelSettings.ts`: native provider/model/key dialogs and secret-storage commands.
- `src/commands/settings.ts`: the single setup menu and its subsettings.
- `src/commands/commitGate.ts`: trusted-workspace repository selection and opt-in enable/disable commands.
- `src/review/session.ts`: conversation history, prompt, context limits, reference validation.
- `src/prompts/tutor.ts`: the existing tutor instructions, kept separate from quiz behavior.
- `src/prompts/quiz.ts`: code-specific question generation, without solutions or answer keys.
- `src/prompts/assessment.ts`: the independent answer-assessment instructions.
- `src/review/quiz.ts`: quiz schema, source-reference validation, and required responses.
- `src/review/assessment.ts`: assessment validation and hiding assessment metadata from streamed text.
- `src/git/context.ts`: staged code context.
- `src/git/client.ts`: shared Git subprocesses and staged tree/parent identities.
- `src/git/changes.ts`: staged line-count parsing.
- `src/git/commitGate.ts`: safe hook installation/removal and explicit snapshot approval.
- `hooks/pre-commit`: standalone Git commit check, independent of VS Code/model runtimes.
- `src/models/llm.ts`: provider routing and Ollama requests.
- `src/models/openai.ts`: OpenAI Responses requests, strict schema adaptation, and safe response/error handling.
- `src/models/stream.ts`: streamed Ollama response parsing.
- `UI/review.html`, `UI/review.css`, `UI/review.js`: the goal, discussion, and recap screens. Styling and fonts work offline; high-contrast themes use VS Code colors.
- `src/test/extension.test.ts`: session regression tests (no Ollama required).
- `src/test/review.test.ts`: evidence validation and review UI transitions (no Ollama required).
- `src/test/llm.test.ts`: mocked OpenAI requests, provider routing, and native key/model dialogs (no real API calls).
- `src/test/commitGate.test.ts`: real Git hook checks in disposable temporary repositories only (no model calls or user-repository commits).

See [code organization](docs/architecture.md) for responsibilities and the approval flow. The UI remains a single browser script; splitting its view/rendering state is a reasonable next refactor, not required for the gate.

## Manual verification and developer pilot

In the Extension Development Host, check selection and staged-file entry points, goal suggestions, **Start tutor**, a follow-up answer, editing the goal, snapshot links, manual code highlighting, Show all, recap, finish/resume, cancellation, retry with Ollama stopped, and edits during a session. Try a general request: expect a brief map and a useful starting point. Ask about a specific condition: expect a direct answer grounded in its lines rather than a prerequisite quiz. Say you're stuck: expect increased support. Start a review quiz directly from the goal screen and from the tutor: expect a short quiz tailored to the actual code and valid source links. Check one- and two-question quizzes on simple code: hidden topics must not require answers or appear as gaps in the recap. Check that a cancelled or failed generation can be retried. Leave a response blank: submission and recap should remain unavailable. Mark it **I'm not sure**, then submit the responses to every generated question. Use each **Help with…** action, return to the quiz, and confirm questions, responses, and the discussion draft are preserved without another generation request. Resubmit after help and verify all areas are evaluated afresh. Edit an answer after receiving feedback and verify recap requires resubmission. Finish with gaps and with all areas supported. Check failed-assessment retry, goal edits clearing questions and results, code references in feedback, keyboard navigation, narrow panels, and high-contrast themes. Tutor-only sessions should still allow finishing without a quiz.

For a small developer pilot, compare ordinary inspection with the walkthrough on matched tasks and similar time budgets. Afterward, hide the assistant response and ask developers to explain the causal flow, predict an unseen failure case, and identify a remaining uncertainty. Include a consented, deliberately flawed explanation to test whether they notice and justify a correction, then debrief. Record reasoning accuracy, confidence, time to useful help, abandonment, and interruptions. Satisfaction alone is insufficient. This pilot has not been run.
