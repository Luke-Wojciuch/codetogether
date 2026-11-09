# CodeTogether

CodeTogether is an early VS Code research prototype for building your understanding of code through a goal-first conversation. The companion adapts to what you need: a broad map of how parts connect, or detailed help with a method or selected lines. It offers context and explanations while leaving room for you to reason, predict, and push back. It uses a configured Ollama model and does not edit your code or block commits.

## Use

1. Start Ollama and install a model, then run **CodeTogether: Choose Model** with its exact name from `ollama list`.
2. Select code and run **CodeTogether: Understand This Code** from the editor context menu or Command Palette. No staging is required.
3. Alternatively, right-click a staged Source Control file and choose **CodeTogether: Understand This Change**. **CodeTogether: Open Review** reviews all staged changes in a single-folder workspace.
4. **Your goal:** describe what you want to understand before committing, or choose a suggested starting point. Check the staged files and click **Begin review**. Loading files does not call the model.
5. **Talk it through:** start with what you need help understanding. For a general request, the companion offers a brief map and helps find a useful starting point. For a specific method or expression, it answers directly and works with relevant lines and concrete examples. It teaches one useful piece at a time, builds on your ideas, and invites a small prediction or application during guided exploration. Direct questions still receive direct answers, and it asks for clarification only when needed. If you're stuck, it should give more support instead of repeatedly testing you. **Give me a hint**, **Work through an example**, and **Seems off** prepare editable follow-ups. Use **Edit** to redirect the goal; successful goal changes reset the four checks. Changing depth within the same goal does not reset them. **Browse files** returns to the file list without losing your discussion or draft.
6. **Check understanding:** when ready, choose **Check understanding**. Respond to four short prompts about purpose, behavior, effect, and edge cases for your current goal. Short, informal, or vague responses are fine when the central idea is broadly correct: the model checks each answered area independently in the conversation's context, rather than requiring a particular format or a complete textbook answer. Blank fields stay not yet shown and do not affect the other areas. Leave an answer blank if unsure. Opening this screen does not call the model; **Check understanding** submits all four responses together. Feedback acknowledges what you understand and distinguishes meaningful gaps from small omissions. Each missing area offers **Help with…**, which returns to a focused discussion. **Back to talking** returns without sending anything and preserves your answers. You can revisit and resubmit after getting help.
7. **Recap:** after the test, choose **Continue to recap**, or use the **Recap** navigation button to finish without a test. The recap records the latest test evidence, gaps, and uncertainties; finishing does not require all four areas to pass. **Keep exploring** resumes the same conversation. **Finish review** marks this review finished in the panel with any gaps recorded; it does not commit or push code.

The recap's brain reflects the latest submitted test, within your goal and scope. The model uses discussion to interpret shorthand and references, while the current test responses supply the evidence. Each supported area must include a nonempty exact quote from the submission, with no minimum length. Each answered field is assessed in a separate model request; blank fields are skipped without affecting the others. Help is allowed; restating a broadly correct idea in your own words is enough, while bare agreement alone is not. Every resubmitted test reassesses all four areas without automatically carrying over earlier evidence. Returning to discussion preserves the last result until another test or a goal change. Assessment requests use structured JSON. Missing or invalid assessment data shows a retry message and preserves your answers and the last successful assessment; if none exists, understanding remains **Not assessed**. You can still finish with uncertainty recorded. Missing code context is recorded as uncertainty, not a developer error. Quote validation checks that the words were said; the model judges their meaning and correctness. These judgments are not a certification or guarantee of code correctness; conversational and assessment quality still need live-model verification.

The walkthrough opens beside the editor with per-file added/deleted line counts and review totals. Binary files have no line counts; deleted files remain listed with their diff. Renames are counted as a deletion and an addition. Selection sessions show their file without staged counts.

Use **Show code** on a file to browse its supplied contents. References in answers open an inline preview of the cited line or range with surrounding context. Drag to highlight your own code selection; the touched lines stay highlighted when you use the actions. **Open in editor** selects those lines in a read-only snapshot; **Ask about this code** adds a question about those lines to your draft without sending it. The scope and staged diff are available in a disclosure.

## Context and limits

- Selection sessions include the selected lines and up to 40 surrounding lines on either side. Staged sessions include a function-context diff and the complete staged text of changed non-deleted files within the size limit.
- Other files, configuration, callers, tests, and runtime behavior are not automatically inspected. Binary files are not supplied as source text; deleted code may only appear in the diff.
- Each panel remembers successful turns, including corrections and depth requests. Closing it discards the session; **New session** clears the conversation and reloads its original scope. Select code again to change the selection scope.
- Context changes are checked before each model request. If it changed, start a new session. When a selection moves after edits, reselect it and run the command again.
- Cancel stops a model request. Failed requests preserve your draft and history; Retry resends the failed turn. Requests time out after two minutes.
- An animated thinking indicator stays visible until the full response is ready, then the reply appears with styled paragraphs, headings, lists, bold text, inline code, code blocks, and clickable code references. During longer waits, helpful messages rotate every 20 seconds. Model HTML is displayed as text. Cancelled or failed partial answers are removed and never enter conversation history.
- Thinking is disabled by default to reduce the wait on models that support disabling it. Enable **CodeTogether: Thinking** in Settings to compare reasoning quality; some models require thinking regardless. Responses are received in the background and displayed only when complete.
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

In the Extension Development Host, check selection and staged-file entry points, goal suggestions, Begin review, a follow-up answer, editing the goal, snapshot links, manual code highlighting, Show all, recap, finish/resume, cancellation, retry with Ollama stopped, and edits during a session. Try a general request: expect a brief map and a useful starting point. Ask about a specific condition: expect a direct answer grounded in its lines rather than a prerequisite quiz. Say you're stuck: expect increased support. Open Check understanding without an inference request, answer all four prompts, and submit them together. Try leaving some or all answers blank; missing reasoning should remain not yet shown, without borrowing evidence from discussion. Use each Help with… action to return to that subject while preserving test answers and the discussion draft. Resubmit after help and verify all areas are evaluated afresh. Finish with gaps, finish with all areas supported, and finish without a usable assessment; the recap must preserve the distinction. Check failed-test retry, goal edits clearing answers and results, code references in test feedback, keyboard navigation, narrow panels, and high-contrast themes.

For a small developer pilot, compare ordinary inspection with the walkthrough on matched tasks and similar time budgets. Afterward, hide the assistant response and ask developers to explain the causal flow, predict an unseen failure case, and identify a remaining uncertainty. Include a consented, deliberately flawed explanation to test whether they notice and justify a correction, then debrief. Record reasoning accuracy, confidence, time to useful help, abandonment, and interruptions. Satisfaction alone is insufficient. This pilot has not been run.
