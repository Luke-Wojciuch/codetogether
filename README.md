# CodeTogether

CodeTogether is an early VS Code research prototype for understanding code through a short, goal-first conversation. It uses a configured Ollama model and does not edit your code or block commits.

## Use

1. Start Ollama and install a model, then run **CodeTogether: Choose Model** with its exact name from `ollama list`.
2. Select code and run **CodeTogether: Understand This Code** from the editor context menu or Command Palette. No staging is required.
3. Alternatively, right-click a staged Source Control file and choose **CodeTogether: Understand This Change**. **CodeTogether: Open Review** reviews all staged changes in a single-folder workspace.
4. **Your goal:** describe what you want to understand before committing, or choose a suggested starting point. Check the staged files and click **Begin review**. Loading files does not call the model.
5. **Talk it through:** reason through concrete examples, ask questions, or push back. **Explain it back**, **Challenge this**, and **Seems off** prepare editable follow-up questions. Use **Edit** to redirect the goal; successful goal changes reset the evidence assessment. **Browse files** returns to the file list without losing your discussion or draft.
6. **Recap:** choose **Go to recap** for your goal, review notes, evidence from your answers, and remaining uncertainties. **Keep exploring** resumes the same conversation. **Finish review** marks this review finished in the panel; it does not commit or push code. You can finish early.

The recap's brain fills as the model identifies demonstrated reasoning about purpose, behavior, effects, and edge cases. Each demonstrated topic must include an exact quote from a developer answer; goals and recap requests are excluded. Discussed topics stay distinct from demonstrated understanding. The assessment uses the same model response, without an extra inference request. Missing or invalid assessment data shows **Not assessed**, with an empty brain. Quote validation confirms the words were said, not that the model's judgment is correct. This is a tentative assessment, not a score, certification, or guarantee of code correctness.

The walkthrough opens beside the editor with per-file added/deleted line counts and review totals. Binary files have no line counts; deleted files remain listed with their diff. Renames are counted as a deletion and an addition. Selection sessions show their file without staged counts.

Use **Show code** on a file to browse its supplied contents. References in answers open an inline preview of the cited line or range with surrounding context. Drag to highlight your own code selection; the touched lines stay highlighted when you use the actions. **Open in editor** selects those lines in a read-only snapshot; **Ask about this code** adds a question about those lines to your draft without sending it. The scope and staged diff are available in a disclosure.

## Context and limits

- Selection sessions include the selected lines and up to 40 surrounding lines on either side. Staged sessions include a function-context diff and the complete staged text of changed non-deleted files within the size limit.
- Other files, configuration, callers, tests, and runtime behavior are not automatically inspected. Binary files are not supplied as source text; deleted code may only appear in the diff.
- Each panel remembers successful turns, including corrections and depth requests. Closing it discards the session; **New session** clears the conversation and reloads its original scope. Select code again to change the selection scope.
- Context changes are checked before each model request. If it changed, start a new session. When a selection moves after edits, reselect it and run the command again.
- Cancel stops a model request. Failed requests preserve your draft and history; Retry resends the failed turn. Requests time out after two minutes.
- Replies appear as they arrive; code references become clickable when the answer finishes. Cancelled or failed partial answers are removed and never enter conversation history.
- Thinking is disabled by default to reduce the wait on models that support disabling it. Enable **CodeTogether: Thinking** in Settings to compare reasoning quality; some models require thinking regardless. Streaming improves responsiveness, but does not increase the model's generation speed.
- Context and conversation have conservative character limits; smaller models may hit their own limits sooner. Oversized sessions fail explicitly rather than silently dropping code or corrections.
- Requests go to `http://localhost:11434/api/chat`. Processing location depends on your Ollama model/setup. No session data is written to disk by the extension.
- Explanations can be wrong. Validated links establish that a source location exists, not that the explanation is correct.

## Development

Requires VS Code matching `package.json`, Node.js LTS, npm, and Git for staged reviews.

```sh
npm install6
npm run compile
npm run lint
npm test
```

Press F5 to launch the Extension Development Host.
The debug window opens this repo with other installed extensions disabled. Network inspection is disabled for this workspace because the local debugger logs showed inspector errors alongside Extension Host crashes. Breakpoints remain available.

- `src/extension.ts`: commands, context capture, panel lifecycle, cancellation, snapshot navigation.
- `src/session.ts`: conversation history, prompt, context limits, reference validation.
- `src/git.ts`: staged code context.
- `src/llm.ts`: Ollama request.
- `src/stream.ts`: streamed Ollama response parsing.
- `src/review.ts`: assessment validation and hiding assessment metadata from streamed text.
- `UI/review.html`, `UI/review.css`, `UI/review.js`: the goal, discussion, and recap screens. Styling and fonts work offline; high-contrast themes use VS Code colors.
- `src/test/extension.test.ts`: session regression tests (no Ollama required).
- `src/test/review.test.ts`: evidence validation and review UI transitions (no Ollama required).

## Manual verification and developer pilot

In the Extension Development Host, check selection and staged-file entry points, goal suggestions, Begin review, a follow-up answer, editing the goal, snapshot links, manual code highlighting, Show all, recap, finish/resume, cancellation, retry with Ollama stopped, and edits during a session. Finish once after only an explanation and once after reasoning through a scenario: the recap should distinguish supplied explanations from demonstrated understanding. Check that missing assessment data leaves the brain empty and that quotes match your answers. Check skipping questions, preserved drafts, keyboard navigation, narrow panels, and high-contrast themes.

For a small developer pilot, compare ordinary inspection with the walkthrough on matched tasks and similar time budgets. Afterward, hide the assistant response and ask developers to explain the causal flow, predict an unseen failure case, and identify a remaining uncertainty. Include a consented, deliberately flawed explanation to test whether they notice and justify a correction, then debrief. Record reasoning accuracy, confidence, time to useful help, abandonment, and interruptions. Satisfaction alone is insufficient. This pilot has not been run.
