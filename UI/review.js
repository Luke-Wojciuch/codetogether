const vscode = acquireVsCodeApi();
const byId = id => document.getElementById(id);
const input = byId('input');
const goalInput = byId('goal-input');
const topics = { purpose: 'Purpose', behavior: 'Behavior', effect: 'Effect', edge: 'Edge cases' };
const statuses = { unexplored: 'Not yet shown', discussed: 'Needs clarification', demonstrated: 'Understanding shown' };
let context;
let busy = false;
let goal = '';
let hasDiscussion = false;
let view = 'goal';
let failed = false;
let lastTurn;
let draftMessage;
let waitTimer;
let previewReference;
let assessment;
let recapText = '';
let finished = false;
let quizQuestions = [];
let quizSubmission;
let approvingCommit = false;
let commitApproved = false;
let commitGateMessage = '';
let requireAllQuestions = false;

function reviewedTopicIds() {
	return quizQuestions.length ? quizQuestions.map(question => question.id) : Object.keys(topics);
}
function questionCountLabel(count) {
	return count + (count === 1 ? ' question' : ' questions');
}
function allChecksPassed() {
	return reviewedTopicIds().every(id => assessment?.concepts?.some(concept =>
		concept.id === id && concept.status === 'demonstrated'));
}

function setView(next) {
	view = next;
	for (const name of ['goal', 'discussion', 'test', 'recap']) {
		byId(name + '-view').hidden = name !== next;
		if (name === next) byId('nav-' + name).setAttribute('aria-current', 'step');
		else byId('nav-' + name).removeAttribute('aria-current');
	}
	byId('preview').hidden = true;
	if (!failed) byId('status').textContent = '';
	if (next === 'goal') goalInput.focus();
	if (next === 'discussion') input.focus();
	if (next === 'test') {
		byId('test-goal').textContent = goal;
		renderQuizProgress();
		byId('test-title').focus();
	}
	if (next === 'recap') {
		byId('recap-title').setAttribute('tabindex', '-1');
		byId('recap-title').focus();
	}
	renderCommitGate();
}
function setBusy(value) {
	busy = value;
	clearInterval(waitTimer);
	byId('status').classList.toggle('thinking', value && !!context);
	for (const id of ['begin', 'begin-quiz', 'send', 'restart', 'edit-goal', 'ask-code', 'keep-studying', 'finish']) byId(id).disabled = value || !context;
	byId('nav-goal').disabled = value;
	byId('nav-discussion').disabled = value || !hasDiscussion;
	byId('nav-recap').disabled = value || !hasDiscussion || (quizQuestions.length > 0 && !quizComplete());
	byId('nav-test').disabled = value || !hasDiscussion;
	byId('test-understanding').disabled = value || !hasDiscussion;
	for (const id of ['check-understanding', 'back-to-talk']) byId(id).disabled = value || !hasDiscussion;
	for (const id of Object.keys(topics)) {
		const inactive = !quizQuestions.some(question => question.id === id);
		byId('test-' + id).disabled = value || inactive;
		byId('not-sure-' + id).disabled = value || inactive;
	}
	for (const button of byId('test-gaps').children) button.disabled = value;
	byId('recap').disabled = value || !hasDiscussion || (quizQuestions.length > 0 && !quizComplete());
	byId('finish').disabled = value || !context || finished || (quizQuestions.length > 0 && !quizComplete());
	byId('finish').title = 'Finish with any remaining gaps recorded';
	for (const button of document.querySelectorAll('[data-goal], [data-question]')) button.disabled = value || !context;
	input.disabled = value;
	goalInput.disabled = value;
	byId('cancel').hidden = !value;
	byId('retry').hidden = true;
	byId('status').textContent = value ? (context ? 'Thinking through your code…' : 'Loading staged code…') : '';
	if (value && context) {
		const checking = lastTurn?.kind === 'test';
		const generating = lastTurn?.kind === 'quiz';
		byId('status').textContent = generating ? 'Preparing your code review quiz' : checking ? 'Checking your understanding' : 'Thinking through your code';
		const messages = checking ? [
			'Your answers are being checked against the supplied code. Short, informal answers are enough.',
			'This is taking a little longer. Your answers are saved in this panel.',
			'You can cancel and retry without retyping your answers.',
			'Still waiting for the model. Requests stop after two minutes; you can retry if needed.'
		] : generating ? [
			'Creating a short quiz to match the complexity of your code and goal.',
			'You will answer the questions before receiving feedback.',
			'You can cancel and retry if question generation takes too long.',
			'Still waiting for the model. Requests stop after two minutes; you can retry if needed.'
		] : [
			'Waiting for the complete response so it can be formatted for you.',
			'While you wait, consider what you expect this code to do for a different input.',
			'You can cancel and retry; your question will be preserved.',
			'Still waiting for the model. Requests stop after two minutes; you can retry if needed.'
		];
		let step = 0;
		waitTimer = setInterval(() => {
			byId('status').textContent = messages[Math.min(step++, messages.length - 1)];
		}, 20000);
	}
	renderQuizProgress();
}
function appendText(entry, text) {
	let position = 0;
	for (const match of text.matchAll(/\[\[(\d+):(\d+)(?:-(\d+))?\]\]/g)) {
		entry.append(document.createTextNode(text.slice(position, match.index)));
		const sourceId = Number(match[1]);
		const line = Number(match[2]);
		const endLine = Number(match[3] ?? match[2]);
		const source = context?.sources[sourceId - 1];
		const start = source?.startLine ?? 1;
		if (source && line >= start && endLine >= line && endLine < start + source.content.split('\n').length) {
			const link = document.createElement('button');
			link.className = 'reference';
			link.type = 'button';
			link.textContent = source.name + ':' + line + (endLine === line ? '' : '-' + endLine) + ' · Show code';
			link.addEventListener('click', () => showCode(sourceId, line, endLine));
			entry.append(link);
		} else entry.append(document.createTextNode('[unavailable code reference]'));
		position = match.index + match[0].length;
	}
	entry.append(document.createTextNode(text.slice(position)));
}
// A small Markdown subset, built with DOM nodes so model HTML is always literal text.
function appendInline(entry, text) {
	let position = 0;
	for (const match of text.matchAll(/`([^`\n]+)`|\*\*([^*\n]+)\*\*/g)) {
		appendText(entry, text.slice(position, match.index));
		const element = document.createElement(match[1] !== undefined ? 'code' : 'strong');
		if (match[1] !== undefined) element.textContent = match[1];
		else appendText(element, match[2]);
		entry.append(element);
		position = match.index + match[0].length;
	}
	appendText(entry, text.slice(position));
}
function appendResponse(entry, text) {
	entry.classList.toggle('response', true);
	const lines = text.replace(/\r\n?/g, '\n').split('\n');
	let paragraph;
	let list;
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		const fence = line.match(/^\s*(`{3,}|~{3,})[^`~]*$/);
		if (fence) {
			const code = document.createElement('code');
			const contents = [];
			while (++index < lines.length) {
				const closing = lines[index].trim();
				if (closing.length >= fence[1].length && [...closing].every(char => char === fence[1][0])) break;
				contents.push(lines[index]);
			}
			code.textContent = contents.join('\n');
			const pre = document.createElement('pre');
			pre.append(code);
			entry.append(pre);
			paragraph = list = undefined;
			continue;
		}
		if (!line.trim()) { paragraph = list = undefined; continue; }
		const heading = line.match(/^#{1,6}\s+(.+)$/);
		const item = line.match(/^\s*(?:[-+*]|(\d+)[.)])\s+(.+)$/);
		if (heading) {
			const title = document.createElement('h3');
			appendInline(title, heading[1]);
			entry.append(title);
			paragraph = list = undefined;
		} else if (item) {
			const type = item[1] ? 'ol' : 'ul';
			if (!list || list.tagName.toLowerCase() !== type) {
				list = document.createElement(type);
				if (item[1]) list.setAttribute('start', item[1]);
				entry.append(list);
			}
			const row = document.createElement('li');
			appendInline(row, item[2]);
			list.append(row);
			paragraph = undefined;
		} else {
			if (!paragraph) { paragraph = document.createElement('p'); entry.append(paragraph); }
			else paragraph.append(document.createTextNode('\n'));
			appendInline(paragraph, line);
			list = undefined;
		}
	}
}
function addMessage(who, text) {
	const entry = document.createElement('div');
	entry.className = who === 'You' || who === 'Your goal' ? 'message user' : 'message';
	const label = document.createElement('strong');
	label.textContent = who;
	entry.append(label);
	if (who === 'You' || who === 'Your goal') appendText(entry, text);
	else {
		const body = document.createElement('div');
		appendResponse(body, text);
		entry.append(body);
	}
	byId('thread').append(entry);
	entry.scrollIntoView({ block: 'nearest' });
	return entry;
}
function renderAssessment() {
	byId('concept-nav').replaceChildren();
	byId('concepts').replaceChildren();
	const concepts = reviewedTopicIds().map(id => assessment?.concepts.find(concept => concept.id === id) ?? { id, status: 'unexplored' });
	for (const concept of concepts) {
		const topic = document.createElement('div');
		topic.className = 'concept-topic ' + concept.status;
		topic.textContent = topics[concept.id];
		topic.title = assessment ? statuses[concept.status] : 'Not assessed';
		byId('concept-nav').append(topic);
		const row = document.createElement('div');
		row.className = 'concept-row';
		const heading = document.createElement('div');
		heading.className = 'concept-heading';
		const label = document.createElement('span');
		label.textContent = topics[concept.id];
		const status = document.createElement('span');
		status.className = 'concept-status ' + concept.status;
		status.textContent = assessment ? statuses[concept.status] : 'Not assessed';
		heading.append(label, status);
		row.append(heading);
		const note = document.createElement('p');
		note.className = 'concept-evidence';
		note.textContent = concept.quote ? '“' + concept.quote + '”' : assessment ? (concept.status === 'discussed' ? 'Some understanding is visible; see the feedback for what needs clarification.' : 'This area has not yet been established by your responses.') : 'The model has not supplied a usable assessment.';
		row.append(note);
		byId('concepts').append(row);
	}
	const shown = concepts.filter(concept => concept.status === 'demonstrated').length;
	const fill = Math.round(112 * shown / concepts.length);
	byId('brain-fill').setAttribute('y', String(112 - fill));
	byId('brain-fill').setAttribute('height', String(fill));
	const description = assessment ? shown + ' of ' + concepts.length + ' areas supported by your answers.' + (allChecksPassed() ? '' : ' You can finish with gaps recorded or get more help.') : 'No usable assessment yet. You can finish with this uncertainty recorded or return to the discussion.';
	byId('brain-description').textContent = description;
	byId('progress-description').textContent = description + ' Passes reflect the model’s judgment of your reasoning, not proof of code correctness.';
	byId('uncertainties').replaceChildren();
	const uncertainties = assessment?.uncertainties.length ? assessment.uncertainties : ['Other files, callers, and runtime behavior have not been checked.'];
	for (const text of uncertainties) {
		const item = document.createElement('li');
		item.textContent = text;
		byId('uncertainties').append(item);
	}
}
function resetTest() {
	quizQuestions = [];
	quizSubmission = undefined;
	for (const id of Object.keys(topics)) {
		byId('test-' + id).value = '';
		byId('test-' + id).disabled = true;
		byId('quiz-question-' + id).hidden = true;
		byId('question-' + id).textContent = '';
		byId('question-reference-' + id).replaceChildren();
	}
	byId('quiz-heading').textContent = 'Review quiz';
	byId('test-results').hidden = true;
	byId('test-feedback').replaceChildren();
	byId('test-summary').replaceChildren();
	byId('test-gaps').replaceChildren();
	byId('test-form').hidden = true;
	byId('quiz-loading').hidden = false;
	renderQuizProgress();
}
function quizAnswers() {
	return Object.fromEntries(quizQuestions.map(question => [question.id, byId('test-' + question.id).value.trim()]));
}
function quizComplete() {
	return !!assessment && quizSubmission === JSON.stringify(quizAnswers());
}
function renderCommitGate() {
	const available = !!context?.staged?.allStaged;
	const strictGap = requireAllQuestions && quizComplete() && !allChecksPassed();
	const button = byId('approve-commit');
	button.hidden = !available;
	button.disabled = !available || busy || view !== 'recap' || !quizComplete() || strictGap || commitApproved;
	button.textContent = approvingCommit ? 'Approving staged snapshot…' : commitApproved ? 'Staged snapshot approved' : 'Approve staged commit';
	byId('commit-gate-note').hidden = !available;
	byId('commit-gate-note').textContent = commitGateMessage || (strictGap
		? 'Strict commit approval is on: every question must show understanding. Use the help buttons, revise your answers, and submit the quiz again.'
		: requireAllQuestions
			? 'Strict commit approval is on. Enable the commit review gate in CodeTogether: Settings, then submit the quiz for all staged changes. Approval does not run Git commit.'
			: 'Submit every question to approve this staged snapshot. Recorded gaps are allowed. Enable the commit review gate in CodeTogether: Settings; approval does not run Git commit. Turn on Require all quiz questions there for strict approval.');
}
function renderQuizProgress() {
	const answers = quizAnswers();
	const completed = Object.values(answers).filter(Boolean).length;
	const count = quizQuestions.length;
	byId('quiz-progress').max = count || 1;
	byId('quiz-progress').value = completed;
	byId('quiz-progress-text').textContent = count ? completed + ' of ' + questionCountLabel(count) + ' completed' : 'Preparing your quiz…';
	byId('check-understanding').disabled = busy || !count || completed !== count;
	if (quizQuestions.length) {
		const incomplete = !quizComplete();
		byId('nav-recap').disabled = busy || incomplete;
		byId('recap').disabled = busy || incomplete;
		byId('finish').disabled = busy || finished || incomplete;
	}
	byId('quiz-result-note').textContent = quizSubmission && !quizComplete()
		? 'Your answers have changed. Submit the quiz again to update the feedback.'
		: quizSubmission ? (count === 1 ? 'The question has a response.' : 'All ' + count + ' questions have a response.') + ' Any gaps are recorded below.' : '';
	renderCommitGate();
}
function openQuiz(fromGoal = false) {
	if (busy || !context) return;
	const quizGoal = fromGoal ? goalInput.value.trim() : goal;
	if (!quizGoal) {
		setView('goal');
		byId('status').textContent = 'Add a goal so the quiz can focus on what you want to understand.';
		return;
	}
	if (quizQuestions.length && quizGoal === goal) setView('test');
	else send(quizGoal, 'quiz');
}
function renderTestResults(text) {
	byId('test-feedback').replaceChildren();
	appendResponse(byId('test-feedback'), text);
	byId('test-gaps').replaceChildren();
	byId('test-summary').replaceChildren();
	for (const id of reviewedTopicIds()) {
		const concept = assessment?.concepts.find(concept => concept.id === id);
		const row = document.createElement('p');
		if (concept?.status === 'demonstrated') row.className = 'demonstrated';
		row.textContent = topics[id] + ': ' + (concept ? statuses[concept.status] : 'Not assessed');
		byId('test-summary').append(row);
		if (concept?.status === 'demonstrated') continue;
		const button = document.createElement('button');
		button.type = 'button';
		button.textContent = 'Help with ' + topics[id].toLowerCase();
		button.addEventListener('click', () => {
			if (busy) return;
			send('Help me work on ' + topics[id].toLowerCase() + ' for my current goal, using the gap in my latest test answers. Explain the unclear part with relevant code and a concrete example, then leave room for me to reason.');
		});
		byId('test-gaps').append(button);
	}
	byId('test-results').hidden = false;
}
function showCode(sourceId, line, endLine = line, all = false) {
	const source = context?.sources[sourceId - 1];
	if (!source) return;
	const lines = source.content.split('\n');
	const start = source.startLine ?? 1;
	if (!Number.isInteger(line) || !Number.isInteger(endLine) || line < start || endLine < line || endLine >= start + lines.length) return;
	previewReference = { sourceId, line, endLine };
	byId('preview-title').textContent = source.name + ':' + line + (endLine === line ? '' : '-' + endLine);
	byId('preview-selection').textContent = 'Lines ' + line + '-' + endLine + ' selected. Drag over code to change the selection.';
	const code = byId('code-preview');
	if (view === 'discussion') byId('discussion-view').insertBefore(byId('preview'), byId('thread'));
	else byId(view + '-view').append(byId('preview'));
	code.replaceChildren();
	for (let n = all ? start : Math.max(start, line - 8); n <= (all ? start + lines.length - 1 : Math.min(start + lines.length - 1, endLine + 8)); n++) {
		const row = document.createElement('span');
		row.dataset.line = String(n);
		row.className = n >= line && n <= endLine ? 'code-line highlight' : 'code-line';
		const number = document.createElement('span');
		number.className = 'line-number';
		number.textContent = String(n);
		const text = document.createElement('span');
		text.textContent = lines[n - start];
		row.append(number, text);
		code.append(row);
	}
	byId('preview').hidden = false;
	byId('preview').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
	code.scrollTop = 0;
	code.focus({ preventScroll: true });
	byId('show-all-code').hidden = all;
}
function selectPreviewCode() {
	const code = byId('code-preview');
	const selection = window.getSelection();
	if (!previewReference || !selection || selection.isCollapsed || !selection.rangeCount) return;
	const range = selection.getRangeAt(0);
	if (!code.contains(range.startContainer) || !code.contains(range.endContainer)) return;
	function rowAt(node, offset, end) {
		if (node === code) return code.children[end ? offset - 1 : offset];
		const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
		return element.closest('.code-line');
	}
	const first = rowAt(range.startContainer, range.startOffset, false);
	let last = rowAt(range.endContainer, range.endOffset, true);
	// Ending at the very start of the next line does not select that line.
	if (last && last !== first && range.endContainer !== code && range.endOffset === 0) last = last.previousElementSibling;
	if (!first || !last) return;
	const line = Number(first.dataset.line);
	const endLine = Number(last.dataset.line);
	if (!Number.isInteger(line) || !Number.isInteger(endLine) || endLine < line) return;
	previewReference = { ...previewReference, line, endLine };
	byId('preview-title').textContent = context.sources[previewReference.sourceId - 1].name + ':' + line + (endLine === line ? '' : '-' + endLine);
	for (const row of code.children) {
		const n = Number(row.dataset.line);
		row.classList.toggle('highlight', n >= line && n <= endLine);
	}
	byId('preview-selection').textContent = 'Lines ' + line + '-' + endLine + ' selected. Ask about this code or open it in the editor.';
}
function renderFiles() {
	const changes = context.changes;
	const files = changes ?? context.sources.map(source => ({ name: source.name }));
	byId('review-kind').textContent = changes ? 'Staged review' : 'Selected code';
	byId('snapshot-kind').textContent = changes ? 'Staged snapshot' : 'Editor snapshot';
	const total = files.length + (files.length === 1 ? ' file' : ' files');
	byId('totals').textContent = changes ? total + ' · +' + changes.reduce((sum, file) => sum + (file.added ?? 0), 0) + ' / −' + changes.reduce((sum, file) => sum + (file.deleted ?? 0), 0) + ' lines' + (changes.some(file => file.added === null) ? ' · binary files excluded from counts' : '') : total;
	byId('sources').replaceChildren();
	for (const file of files) {
		const row = document.createElement('div');
		row.className = 'file-row';
		const name = document.createElement('span');
		name.className = 'file-name';
		name.textContent = file.name;
		row.append(name);
		if (changes) {
			const counts = document.createElement('span');
			counts.className = 'counts';
			if (file.added === null) {
				counts.textContent = 'Binary';
			} else {
				const added = document.createElement('span');
				added.className = 'added';
				added.textContent = '+' + file.added;
				const deleted = document.createElement('span');
				deleted.className = 'deleted';
				deleted.textContent = '−' + file.deleted;
				counts.append(added, document.createTextNode(' / '), deleted);
				counts.setAttribute('aria-label', file.added + ' lines added, ' + file.deleted + ' lines deleted');
			}
			row.append(counts);
			if (file.added !== null && file.added + file.deleted > 0) {
				const bar = document.createElement('span');
				bar.className = 'file-bar';
				bar.setAttribute('aria-hidden', 'true');
				for (const count of [file.added, file.deleted]) {
					const segment = document.createElement('span');
					segment.style.flex = String(count);
					bar.append(segment);
				}
				row.append(bar);
			}
		}
		const index = context.sources.findIndex(source => source.name === file.name);
		if (index >= 0) {
			const button = document.createElement('button');
			button.className = 'secondary';
			button.type = 'button';
			button.textContent = 'Show code';
			button.setAttribute('aria-label', 'Show code for ' + file.name);
			button.addEventListener('click', () => {
				const source = context.sources[index];
				const start = source.startLine ?? 1;
				showCode(index + 1, start, start + source.content.split('\n').length - 1);
			});
			row.append(button);
		} else {
			const note = document.createElement('span');
			note.className = 'muted';
			note.textContent = 'Diff only';
			row.append(note);
		}
		byId('sources').append(row);
	}
}

function start() {
	context = undefined;
	approvingCommit = false;
	commitApproved = false;
	commitGateMessage = '';
	goal = '';
	hasDiscussion = false;
	failed = false;
	lastTurn = undefined;
	draftMessage = undefined;
	previewReference = undefined;
	assessment = undefined;
	recapText = '';
	resetTest();
	finished = false;
	input.value = '';
	goalInput.value = '';
	byId('thread').replaceChildren();
	byId('sources').replaceChildren();
	byId('totals').textContent = 'Loading files…';
	byId('scope').textContent = 'Loading…';
	byId('diff').hidden = true;
	byId('diff').textContent = '';
	byId('recap-body').replaceChildren();
	byId('finished-note').hidden = true;
	byId('finish').textContent = 'Finish review';
	byId('recap-title').textContent = 'Make sense of what you learned.';
	renderAssessment();
	setView('goal');
	setBusy(true);
	vscode.postMessage({ type: 'init' });
}
function send(text, kind = 'discussion') {
	if (busy || !context || !text.trim()) return;
	lastTurn = { text: text.trim(), kind };
	failed = false;
	finished = false;
	byId('finished-note').hidden = true;
	byId('finish').textContent = 'Finish review';
	setView(kind === 'test' || kind === 'quiz' ? 'test' : kind === 'recap' ? 'recap' : 'discussion');
	byId('current-goal').textContent = kind === 'goal' ? text : goal;
	draftMessage = kind === 'recap' || kind === 'test' || kind === 'quiz' ? undefined : addMessage(kind === 'goal' ? 'Your goal' : 'You', text);
	if (kind === 'test') byId('test-results').hidden = true;
	setBusy(true);
	vscode.postMessage({ type: 'send', ...lastTurn });
}
function openRecap() {
	if (busy || !hasDiscussion) return;
	if (quizQuestions.length && !quizComplete()) {
		setView('test');
		byId('status').textContent = 'Respond to each question and submit the quiz before continuing to the recap.';
		return;
	}
	if (recapText) { setView('recap'); return; }
	send('Recap my goal, the latest test results with evidence from my answers, and any gaps or uncertainties. If no usable test assessment exists, say so. I may finish with gaps recorded. Do not ask further reasoning questions.', 'recap');
}
function addDraft(text) {
	if (busy) return;
	if (!goal) {
		setView('goal');
		goalInput.value = goalInput.value.trim() ? goalInput.value + '\n\n' + text : text;
		goalInput.focus();
		return;
	}
	setView('discussion');
	input.value = input.value.trim() ? input.value + '\n\n' + text : text;
	input.focus();
}
function browseCode() {
	if (!context) return;
	setView('goal');
	byId('sources').scrollIntoView({ block: 'nearest' });
}
byId('goal-form').addEventListener('submit', event => {
	event.preventDefault();
	const text = goalInput.value.trim();
	if (hasDiscussion && text === goal) setView('discussion');
	else send(text, 'goal');
});
byId('form').addEventListener('submit', event => { event.preventDefault(); send(input.value.trim()); });
byId('test-form').addEventListener('submit', event => {
	event.preventDefault();
	const answers = quizAnswers();
	if (busy || !quizQuestions.length) return;
	const missing = quizQuestions.map(question => question.id).find(id => !answers[id]);
	if (missing) {
		byId('test-' + missing).focus();
		byId('status').textContent = 'Respond to each question, or choose “I\u2019m not sure” to record a gap.';
		return;
	}
	send(JSON.stringify(answers), 'test');
});
byId('begin-quiz').addEventListener('click', () => openQuiz(true));
for (const id of Object.keys(topics)) {
	byId('test-' + id).addEventListener('input', renderQuizProgress);
	byId('not-sure-' + id).addEventListener('click', () => {
		if (busy || !quizQuestions.some(question => question.id === id)) return;
		byId('test-' + id).value = "I'm not sure yet.";
		renderQuizProgress();
	});
}
for (const id of ['test-understanding', 'nav-test']) byId(id).addEventListener('click', () => {
	if (!busy && hasDiscussion) openQuiz();
});
byId('back-to-talk').addEventListener('click', () => { if (!busy) setView('discussion'); });
for (const [field, form] of [[input, byId('form')], [goalInput, byId('goal-form')]]) {
	field.addEventListener('keydown', event => {
		if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') { event.preventDefault(); form.requestSubmit(); }
	});
}
for (const button of document.querySelectorAll('[data-goal]')) button.addEventListener('click', () => { goalInput.value = button.dataset.goal; goalInput.focus(); });
for (const button of document.querySelectorAll('[data-question]')) button.addEventListener('click', () => addDraft(button.dataset.question));
byId('restart').addEventListener('click', start);
byId('nav-goal').addEventListener('click', () => setView('goal'));
byId('nav-discussion').addEventListener('click', () => { if (hasDiscussion) setView('discussion'); });
byId('nav-recap').addEventListener('click', openRecap);
byId('edit-goal').addEventListener('click', () => { goalInput.value = goal; setView('goal'); });
byId('browse-code').addEventListener('click', browseCode);
byId('show-code').addEventListener('click', () => {
	if (previewReference) { const { sourceId, line, endLine } = previewReference; showCode(sourceId, line, endLine); }
	else if (context?.sources.length === 1) {
		const source = context.sources[0];
		showCode(1, source.startLine ?? 1, (source.startLine ?? 1) + source.content.split('\n').length - 1);
	} else browseCode();
});
document.addEventListener('selectionchange', selectPreviewCode);
byId('close-preview').addEventListener('click', () => { byId('preview').hidden = true; (view === 'goal' ? goalInput : input).focus(); });
byId('show-all-code').addEventListener('click', () => {
	if (previewReference) { const { sourceId, line, endLine } = previewReference; showCode(sourceId, line, endLine, true); }
});
byId('open-snapshot').addEventListener('click', () => { if (previewReference) vscode.postMessage({ type: 'reference', ...previewReference }); });
byId('ask-code').addEventListener('click', () => {
	if (!previewReference) return;
	const { sourceId, line, endLine } = previewReference;
	addDraft('Help me reason about ' + context.sources[sourceId - 1].name + ' lines ' + line + '-' + endLine + ' [[' + sourceId + ':' + line + '-' + endLine + ']]. Focus on this part, using concrete values or state changes where helpful.');
});
byId('recap').addEventListener('click', openRecap);
byId('keep-studying').addEventListener('click', () => {
	finished = false;
	byId('finished-note').hidden = true;
	byId('finish').textContent = 'Finish review';
	setBusy(false);
	setView('discussion');
});
byId('finish').addEventListener('click', () => {
	if (busy || !context || finished || view !== 'recap' || (quizQuestions.length && !quizComplete())) return;
	finished = true;
	byId('finished-note').textContent = allChecksPassed() ? 'Review finished. No commit or push was made.' : 'Review finished with gaps or unassessed understanding recorded above. No commit or push was made.';
	byId('finished-note').hidden = false;
	byId('finish').textContent = 'Review finished';
	byId('finish').disabled = true;
});
byId('approve-commit').addEventListener('click', () => {
	if (busy || !context?.staged?.allStaged || view !== 'recap' || !quizComplete() || (requireAllQuestions && !allChecksPassed()) || commitApproved) return;
	approvingCommit = true;
	setBusy(true);
	byId('cancel').hidden = true;
	byId('status').textContent = 'Checking the current staged snapshot before recording approval…';
	vscode.postMessage({ type: 'approve-commit', answers: JSON.stringify(quizAnswers()) });
});
byId('cancel').addEventListener('click', () => { vscode.postMessage({ type: 'cancel' }); byId('status').textContent = 'Cancelling…'; });
byId('retry').addEventListener('click', () => {
	if (!context) { setBusy(true); vscode.postMessage({ type: 'init' }); }
	else if (failed && lastTurn) send(lastTurn.text, lastTurn.kind);
});
window.addEventListener('message', event => {
	const message = event.data;
	if ((message.type === 'commit-approved' || message.type === 'commit-approval-error') && approvingCommit) {
		approvingCommit = false;
		commitApproved = message.type === 'commit-approved';
		commitGateMessage = message.text;
		setBusy(false);
		byId('status').textContent = message.text;
	}
	if (message.type === 'context') {
		context = message.context;
		requireAllQuestions = message.requireAllQuestions === true;
		byId('scope').textContent = context.label;
		renderFiles();
		byId('diff').textContent = context.diff ?? '';
		byId('diff').hidden = !context.diff;
		setBusy(false);
		goalInput.focus();
	}
	if (message.type === 'commit-gate-policy') {
		requireAllQuestions = message.requireAllQuestions === true;
		renderCommitGate();
	}
	if (message.type === 'quiz' && lastTurn?.kind === 'quiz') {
		resetTest();
		quizQuestions = message.questions;
		goal = message.goal;
		goalInput.value = goal;
		byId('current-goal').textContent = goal;
		hasDiscussion = true;
		assessment = undefined;
		recapText = '';
		byId('quiz-heading').textContent = 'Review quiz · ' + questionCountLabel(quizQuestions.length);
		for (const [index, question] of quizQuestions.entries()) {
			byId('quiz-question-' + question.id).hidden = false;
			byId('question-heading-' + question.id).textContent = 'Question ' + (index + 1) + ' · ' + topics[question.id];
			byId('question-' + question.id).textContent = question.prompt;
			const reference = byId('question-reference-' + question.id);
			reference.replaceChildren();
			if (question.sourceId) appendText(reference, '[[' + question.sourceId + ':' + question.line + '-' + question.endLine + ']]');
			else {
				const browse = document.createElement('button');
				browse.type = 'button';
				browse.className = 'secondary';
				browse.textContent = 'Browse supplied code';
				browse.addEventListener('click', browseCode);
				reference.append(browse);
			}
		}
		byId('quiz-loading').hidden = true;
		byId('test-form').hidden = false;
		renderAssessment();
		setBusy(false);
		setView('test');
	}
	if (message.type === 'reply' && lastTurn) {
		if (lastTurn.kind !== 'test') addMessage('CodeTogether', message.text);
		draftMessage = undefined;
		hasDiscussion = true;
		assessment = message.assessment;
		if (lastTurn.kind === 'goal') {
			resetTest();
			goal = lastTurn.text;
			goalInput.value = goal;
			byId('current-goal').textContent = goal;
		}
		if (lastTurn.kind === 'recap') {
			recapText = message.text;
			byId('recap-body').replaceChildren();
			appendResponse(byId('recap-body'), recapText);
			byId('recap-goal').textContent = goal;
			byId('recap-title').textContent = 'Make sense of what you learned.';
		} else recapText = '';
		if (lastTurn.kind === 'test') {
			quizSubmission = lastTurn.text;
			commitGateMessage = '';
			renderTestResults(message.text);
		}
		if (lastTurn.kind === 'discussion' && input.value.trim() === lastTurn.text) input.value = '';
		renderAssessment();
		setBusy(false);
		if (lastTurn.kind === 'recap') setView('recap');
		else if (lastTurn.kind === 'test') byId('test-results-title').focus();
		else input.focus();
	}
	if (message.type === 'error') {
		draftMessage?.remove();
		draftMessage = undefined;
		failed = true;
		if (lastTurn?.kind === 'goal') setView('goal');
		if (lastTurn?.kind === 'test' && assessment) byId('test-results').hidden = false;
		setBusy(false);
		byId('status').textContent = message.text;
		byId('retry').hidden = false;
		if (lastTurn?.kind === 'discussion') input.value = lastTurn.text;
	}
});
start();
