"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const assert = __importStar(require("node:assert/strict"));
const promises_1 = require("node:fs/promises");
const node_fs_1 = require("node:fs");
const node_crypto_1 = require("node:crypto");
const node_os_1 = require("node:os");
const path = __importStar(require("node:path"));
const node_test_1 = require("node:test");
const node_vm_1 = require("node:vm");
const commitGate_1 = require("../git/commitGate");
const client_1 = require("../git/client");
const session_1 = require("../review/session");
const source = 'export function value() { return 2; }\n';
const submission = JSON.stringify({ behavior: 'It returns 2.' });
const uncertainSubmission = JSON.stringify({ behavior: "I'm not sure yet." });
// This test file's subprocesses must not inherit the developer's hook manager or
// signing configuration. Only the child test process environment is changed.
const previousGitEnvironment = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.startsWith('GIT_')));
(0, node_test_1.before)(() => {
    for (const name of Object.keys(process.env)) {
        if (name.startsWith('GIT_')) {
            delete process.env[name];
        }
    }
    process.env.GIT_CONFIG_GLOBAL = path.join((0, node_os_1.tmpdir)(), 'codetogether-no-config-' + (0, node_crypto_1.randomUUID)());
    process.env.GIT_CONFIG_NOSYSTEM = '1';
});
(0, node_test_1.after)(() => {
    for (const name of Object.keys(process.env)) {
        if (name.startsWith('GIT_')) {
            delete process.env[name];
        }
    }
    Object.assign(process.env, previousGitEnvironment);
});
async function fixture(t, initialCommit = true) {
    const root = await (0, promises_1.mkdtemp)(path.join((0, node_os_1.tmpdir)(), 'codetogether-gate-'));
    t.after(() => (0, promises_1.rm)(root, { recursive: true, force: true }));
    await (0, client_1.git)(root, ['init', '--quiet']);
    await (0, client_1.git)(root, ['config', 'user.name', 'CodeTogether test']);
    await (0, client_1.git)(root, ['config', 'user.email', 'codetogether-test@example.invalid']);
    await (0, client_1.git)(root, ['config', 'commit.gpgsign', 'false']);
    if (initialCommit) {
        await (0, promises_1.writeFile)(path.join(root, 'example.ts'), 'export function value() { return 1; }\n');
        await (0, client_1.git)(root, ['add', 'example.ts']);
        await (0, client_1.git)(root, ['commit', '--quiet', '-m', 'test baseline']);
    }
    await (0, promises_1.writeFile)(path.join(root, 'example.ts'), source);
    await (0, client_1.git)(root, ['add', 'example.ts']);
    return root;
}
async function reviewed(root, allStaged = true) {
    const context = { label: 'Staged test snapshot', staged: await (0, client_1.stagedSnapshot)(root, allStaged),
        sources: [{ name: 'example.ts', content: source, language: 'typescript' }] };
    const session = new session_1.Session(context);
    session.setQuiz('Understand the return value.', JSON.stringify({ questions: [
            { id: 'behavior', prompt: 'What value does value() return?' }
        ] }));
    session.complete(submission, JSON.stringify({ feedback: 'You identified the return value.',
        concepts: [{ id: 'behavior', status: 'demonstrated', quote: 'It returns 2.' }], uncertainties: [] }), 'test');
    return session;
}
(0, node_test_1.suite)('Commit review gate (isolated temporary repositories)', () => {
    (0, node_test_1.test)('blocks before explicit approval, accepts a demonstrated answer, then invalidates on HEAD change', async (t) => {
        const root = await fixture(t);
        await (0, commitGate_1.installCommitGate)(root);
        await assert.rejects((0, client_1.git)(root, ['commit', '-m', 'must be blocked']), /commit blocked/);
        const session = await reviewed(root);
        await (0, commitGate_1.approveStagedCommit)(session, submission);
        const record = path.join(session.context.staged.gitDir, 'codetogether/approved-snapshot');
        assert.equal(await (0, promises_1.readFile)(record, 'utf8'), session.context.staged.head + ' ' + session.context.staged.tree + '\n');
        await (0, client_1.git)(root, ['commit', '--quiet', '-m', 'reviewed change']);
        assert.notEqual((await (0, client_1.stagedSnapshot)(root)).head, session.context.staged.head);
        await assert.rejects((0, client_1.git)(root, ['commit', '--allow-empty', '-m', 'old approval is stale']), /commit blocked/);
    });
    (0, node_test_1.test)('default approval accepts a submitted quiz with a recorded gap', async (t) => {
        const root = await fixture(t);
        await (0, commitGate_1.installCommitGate)(root);
        const session = await reviewed(root);
        session.complete(uncertainSubmission, JSON.stringify({ feedback: 'You are unsure of the return value.',
            concepts: [{ id: 'behavior', status: 'unexplored' }], uncertainties: [] }), 'test');
        await (0, commitGate_1.approveStagedCommit)(session, uncertainSubmission);
        await (0, client_1.git)(root, ['commit', '--quiet', '-m', 'gap recorded']);
    });
    (0, node_test_1.test)('strict approval rejects gaps; resubmitting a demonstrated answer can approve', async (t) => {
        const root = await fixture(t);
        await (0, commitGate_1.installCommitGate)(root);
        const session = await reviewed(root);
        session.complete(uncertainSubmission, JSON.stringify({ feedback: 'You are unsure of the return value.',
            concepts: [{ id: 'behavior', status: 'unexplored' }], uncertainties: [] }), 'test');
        await assert.rejects((0, commitGate_1.approveStagedCommit)(session, uncertainSubmission, undefined, true), /Every quiz question must show understanding/);
        await assert.rejects((0, promises_1.readFile)(path.join(session.context.staged.gitDir, 'codetogether/approved-snapshot')), { code: 'ENOENT' });
        await assert.rejects((0, client_1.git)(root, ['commit', '-m', 'gap remains']), /commit blocked/);
        session.complete(submission, JSON.stringify({ feedback: 'You identified the return value.',
            concepts: [{ id: 'behavior', status: 'demonstrated', quote: 'It returns 2.' }], uncertainties: [] }), 'test');
        await (0, commitGate_1.approveStagedCommit)(session, submission, undefined, true);
        await (0, client_1.git)(root, ['commit', '--quiet', '-m', 'understanding shown']);
    });
    (0, node_test_1.test)('strict approval requires every generated question to be demonstrated', async (t) => {
        const root = await fixture(t);
        await (0, commitGate_1.installCommitGate)(root);
        const session = await reviewed(root);
        session.setQuiz('Understand the change.', JSON.stringify({ questions: [
                { id: 'purpose', prompt: 'Why is value() here?' },
                { id: 'behavior', prompt: 'What value does it return?' }
            ] }));
        const answers = JSON.stringify({ purpose: 'It supplies a value.', behavior: 'It returns 2.' });
        session.complete(answers, JSON.stringify({ feedback: 'The behavior is clear; purpose needs clarification.', concepts: [
                { id: 'purpose', status: 'discussed' },
                { id: 'behavior', status: 'demonstrated', quote: 'It returns 2.' }
            ], uncertainties: [] }), 'test');
        await assert.rejects((0, commitGate_1.approveStagedCommit)(session, answers, undefined, true), /Every quiz question must show understanding/);
        await assert.rejects((0, client_1.git)(root, ['commit', '-m', 'one gap remains']), /commit blocked/);
    });
    (0, node_test_1.test)('a restaged edit invalidates the hook approval and cannot be approved from the stale session', async (t) => {
        const root = await fixture(t);
        await (0, commitGate_1.installCommitGate)(root);
        const session = await reviewed(root);
        await (0, commitGate_1.approveStagedCommit)(session, submission);
        await (0, promises_1.writeFile)(path.join(root, 'example.ts'), 'export function value() { return 3; }\n');
        await (0, client_1.git)(root, ['add', 'example.ts']);
        await assert.rejects((0, client_1.git)(root, ['commit', '-m', 'unreviewed stage']), /commit blocked/);
        await assert.rejects((0, commitGate_1.approveStagedCommit)(session, submission), /Staged changes or HEAD changed/);
    });
    (0, node_test_1.test)('unstaged edits do not contaminate approval, while commit -a cannot introduce them unnoticed', async (t) => {
        const root = await fixture(t);
        await (0, commitGate_1.installCommitGate)(root);
        const session = await reviewed(root);
        await (0, commitGate_1.approveStagedCommit)(session, submission);
        await (0, promises_1.writeFile)(path.join(root, 'example.ts'), 'export function value() { return 999; }\n');
        await assert.rejects((0, client_1.git)(root, ['commit', '-am', 'unreviewed working tree']), /commit blocked/);
        await (0, client_1.git)(root, ['commit', '--quiet', '-m', 'only reviewed staged content']);
        assert.equal(await (0, client_1.git)(root, ['show', 'HEAD:example.ts']), source);
    });
    (0, node_test_1.test)('partial commits use their actual temporary index, not the approved full index', async (t) => {
        const root = await fixture(t);
        await (0, commitGate_1.installCommitGate)(root);
        await (0, promises_1.writeFile)(path.join(root, 'other.ts'), 'const other = 1;\n');
        await (0, client_1.git)(root, ['add', 'other.ts']);
        const session = await reviewed(root);
        await (0, commitGate_1.approveStagedCommit)(session, submission);
        await assert.rejects((0, client_1.git)(root, ['commit', '--only', 'example.ts', '-m', 'different partial tree']), /commit blocked/);
    });
    (0, node_test_1.test)('only all-staged sessions and unchanged submitted answers qualify for approval', async (t) => {
        const root = await fixture(t);
        await (0, commitGate_1.installCommitGate)(root);
        const single = await reviewed(root, false);
        await assert.rejects((0, commitGate_1.approveStagedCommit)(single, submission), /ALL staged changes/);
        const session = await reviewed(root);
        await assert.rejects((0, commitGate_1.approveStagedCommit)(session, JSON.stringify({ behavior: 'Changed answer' })), /answers have changed/);
        const selection = new session_1.Session({ label: 'Selection', sources: session.context.sources });
        await assert.rejects((0, commitGate_1.approveStagedCommit)(selection, submission), /Submit every question/);
        const controller = new AbortController();
        controller.abort();
        await assert.rejects((0, commitGate_1.approveStagedCommit)(session, submission, controller.signal), /cancelled/);
    });
    (0, node_test_1.test)('new quizzes and new goals clear eligibility; a failed assessment does not replace a good one', async (t) => {
        const root = await fixture(t);
        const session = await reviewed(root);
        assert.doesNotThrow(() => session.requireReviewedQuiz(submission));
        assert.throws(() => session.complete(submission, '{}', 'test'), /usable assessment/);
        assert.doesNotThrow(() => session.requireReviewedQuiz(submission));
        session.setQuiz('Another goal', JSON.stringify({ questions: [{ id: 'behavior', prompt: 'What gets returned?' }] }));
        assert.throws(() => session.requireReviewedQuiz(submission), /Submit every question/);
        const other = await reviewed(root);
        other.complete('New goal', 'Trace the return.', 'goal');
        assert.throws(() => other.requireReviewedQuiz(submission), /Submit every question/);
    });
    (0, node_test_1.test)('existing hooks and custom hook-manager configurations are never overwritten', async (t) => {
        const root = await fixture(t);
        const snapshot = await (0, client_1.stagedSnapshot)(root);
        const hook = path.join(snapshot.gitDir, 'hooks/pre-commit');
        const original = '#!/bin/sh\nprintf existing-hook\n';
        await (0, promises_1.writeFile)(hook, original, { mode: 0o755 });
        await assert.rejects((0, commitGate_1.installCommitGate)(root), /already exists/);
        await assert.rejects((0, commitGate_1.removeCommitGate)(root), /left unchanged/);
        assert.equal(await (0, promises_1.readFile)(hook, 'utf8'), original);
        await (0, client_1.git)(root, ['config', 'core.hooksPath', '.custom-hooks']);
        await assert.rejects((0, commitGate_1.installCommitGate)(root), /core.hooksPath/);
        assert.equal(await (0, promises_1.readFile)(hook, 'utf8'), original);
    });
    (0, node_test_1.test)('disabling removes only the unchanged owned hook and never attempts a commit', async (t) => {
        const root = await fixture(t);
        await (0, commitGate_1.installCommitGate)(root);
        const before = await (0, client_1.stagedSnapshot)(root);
        const hook = path.join(before.gitDir, 'hooks/pre-commit');
        assert.equal(await (0, promises_1.readFile)(hook, 'utf8'), await (0, promises_1.readFile)(commitGate_1.commitGateHook, 'utf8'));
        await (0, commitGate_1.removeCommitGate)(root);
        await assert.rejects((0, promises_1.readFile)(hook), { code: 'ENOENT' });
        assert.equal((await (0, client_1.stagedSnapshot)(root)).head, before.head);
        await assert.rejects((0, commitGate_1.approveStagedCommit)(await reviewed(root), submission), /CodeTogether: Settings/);
    });
    (0, node_test_1.test)('linked worktrees share the hook but never inherit another worktree approval', async (t) => {
        const root = await fixture(t);
        await (0, commitGate_1.installCommitGate)(root);
        await (0, commitGate_1.approveStagedCommit)(await reviewed(root), submission);
        await (0, client_1.git)(root, ['commit', '--quiet', '-m', 'reviewed change']);
        const linked = path.join(root, 'linked checkout');
        await (0, client_1.git)(root, ['worktree', 'add', '-b', 'linked-test', linked]);
        const linkedState = await (0, client_1.stagedSnapshot)(linked);
        assert.notEqual(linkedState.gitDir, (await (0, client_1.stagedSnapshot)(root)).gitDir);
        await assert.rejects((0, client_1.git)(linked, ['commit', '--allow-empty', '-m', 'no linked approval']), /commit blocked/);
    });
    (0, node_test_1.test)('symbolic-link hook files are not followed or replaced', { skip: process.platform === 'win32' }, async (t) => {
        const root = await fixture(t);
        const target = path.join(root, 'user-hook');
        const original = '#!/bin/sh\nexit 0\n';
        await (0, promises_1.writeFile)(target, original);
        await (0, promises_1.symlink)(target, path.join((await (0, client_1.stagedSnapshot)(root)).gitDir, 'hooks/pre-commit'));
        await assert.rejects((0, commitGate_1.installCommitGate)(root), /not a regular file/);
        await assert.rejects((0, commitGate_1.removeCommitGate)(root), /not a regular file/);
        assert.equal(await (0, promises_1.readFile)(target, 'utf8'), original);
    });
    (0, node_test_1.test)('supports approval before the first commit', async (t) => {
        const root = await fixture(t, false);
        await (0, commitGate_1.installCommitGate)(root);
        const session = await reviewed(root);
        assert.equal(session.context.staged.head, 'unborn');
        await (0, commitGate_1.approveStagedCommit)(session, submission);
        await (0, client_1.git)(root, ['commit', '--quiet', '-m', 'reviewed first commit']);
    });
});
(0, node_test_1.suite)('Commit gate settings consent', () => {
    (0, node_test_1.test)('untrusted workspaces and cancelled dialogs cannot change hooks', async () => {
        let trusted = false;
        let accepted = false;
        let installs = 0;
        let removals = 0;
        let gitCalls = 0;
        const errors = [];
        const sandbox = (0, node_vm_1.createContext)({ exports: {}, Error, require(name) {
                if (name === '../git/client') {
                    return { git: async () => { gitCalls++; return '/test/repository\n'; } };
                }
                if (name === '../git/commitGate') {
                    return {
                        installCommitGate: async () => { installs++; }, removeCommitGate: async () => { removals++; }
                    };
                }
                if (name === 'vscode') {
                    return {
                        workspace: { get isTrusted() { return trusted; }, workspaceFolders: [{ name: 'test', uri: { fsPath: '/test/repository' } }] },
                        window: { showWarningMessage: async (_message, _options, action) => accepted ? action : undefined,
                            showInformationMessage: async () => { }, showErrorMessage: async (error) => { errors.push(error); } }
                    };
                }
                throw new Error('Unexpected module: ' + name);
            } });
        (0, node_vm_1.runInContext)((0, node_fs_1.readFileSync)(path.resolve(__dirname, '../commands/commitGate.js'), 'utf8'), sandbox);
        assert.equal(installs, 0);
        assert.equal(removals, 0);
        await sandbox.exports.configureCommitGate(true);
        assert.equal(installs, 0);
        assert.equal(gitCalls, 0);
        assert.match(errors[0], /Trust/);
        trusted = true;
        await sandbox.exports.configureCommitGate(true);
        assert.equal(installs, 0);
        accepted = true;
        await sandbox.exports.configureCommitGate(true);
        assert.equal(installs, 1);
        await sandbox.exports.configureCommitGate(false);
        assert.equal(removals, 1);
    });
});
//# sourceMappingURL=commitGate.test.js.map