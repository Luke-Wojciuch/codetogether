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
exports.commitGateHook = void 0;
exports.installCommitGate = installCommitGate;
exports.isCommitGateEnabled = isCommitGateEnabled;
exports.removeCommitGate = removeCommitGate;
exports.approveStagedCommit = approveStagedCommit;
const node_crypto_1 = require("node:crypto");
const promises_1 = require("node:fs/promises");
const path = __importStar(require("node:path"));
const client_1 = require("./client");
exports.commitGateHook = path.resolve(__dirname, '../../hooks/pre-commit');
async function readRegularFile(file) {
    try {
        if (!(await (0, promises_1.lstat)(file)).isFile()) {
            throw new Error('Refusing to change a hook or approval path that is not a regular file: ' + file);
        }
        return await (0, promises_1.readFile)(file, 'utf8');
    }
    catch (error) {
        if (error.code === 'ENOENT') {
            return undefined;
        }
        throw error;
    }
}
async function layout(cwd) {
    const root = (await (0, client_1.git)(cwd, ['rev-parse', '--show-toplevel'])).trim();
    if (await (0, client_1.optionalGit)(root, ['config', '--get', 'core.hooksPath']) !== undefined) {
        throw new Error('This repository configures core.hooksPath. CodeTogether left your hook manager unchanged. Automatic integration with hook managers is not supported yet.');
    }
    const common = (await (0, client_1.git)(root, ['rev-parse', '--git-common-dir'])).trim();
    const hook = path.resolve(root, common, 'hooks/pre-commit');
    try {
        const directory = await (0, promises_1.lstat)(path.dirname(hook));
        if (!directory.isDirectory() || directory.isSymbolicLink()) {
            throw new Error('The Git hooks directory is not a regular directory. It was left unchanged.');
        }
    }
    catch (error) {
        if (error.code !== 'ENOENT') {
            throw error;
        }
    }
    return { root, hook };
}
async function installCommitGate(cwd) {
    const { hook } = await layout(cwd);
    const expected = await (0, promises_1.readFile)(exports.commitGateHook, 'utf8');
    const current = await readRegularFile(hook);
    if (current !== undefined && current !== expected) {
        throw new Error('A pre-commit hook already exists and was left unchanged. Automatic hook chaining is not supported yet.');
    }
    await (0, promises_1.mkdir)(path.dirname(hook), { recursive: true });
    if (current === undefined) {
        await (0, promises_1.writeFile)(hook, expected, { flag: 'wx', mode: 0o755 });
    }
    else {
        await (0, promises_1.chmod)(hook, 0o755);
    }
}
async function isCommitGateEnabled(cwd) {
    const { hook } = await layout(cwd);
    if (await readRegularFile(hook) !== await (0, promises_1.readFile)(exports.commitGateHook, 'utf8')) {
        return false;
    }
    return !!((await (0, promises_1.lstat)(hook)).mode & 0o111);
}
async function removeCommitGate(cwd) {
    const { hook } = await layout(cwd);
    const current = await readRegularFile(hook);
    if (current === undefined) {
        return;
    }
    if (current !== await (0, promises_1.readFile)(exports.commitGateHook, 'utf8')) {
        throw new Error('The pre-commit hook is not the unmodified CodeTogether hook. It was left unchanged.');
    }
    await (0, promises_1.unlink)(hook);
}
async function approveStagedCommit(session, submission, signal, requireAllQuestions = false) {
    session.requireReviewedQuiz(submission, requireAllQuestions);
    const reviewed = session.context.staged;
    if (!reviewed?.allStaged) {
        throw new Error('Only a review of ALL staged changes can approve a commit. Run CodeTogether: Open Review, not a selection or single-file review.');
    }
    const { hook } = await layout(reviewed.root);
    if (await readRegularFile(hook) !== await (0, promises_1.readFile)(exports.commitGateHook, 'utf8')) {
        throw new Error('Enable the commit gate first in CodeTogether: Settings.');
    }
    const current = await (0, client_1.stagedSnapshot)(reviewed.root);
    if (!(0, client_1.sameSnapshot)(reviewed, current)) {
        throw new Error('Staged changes or HEAD changed. Start a new review before approving this commit.');
    }
    if (signal?.aborted) {
        throw new Error('Commit approval cancelled.');
    }
    const folder = path.join(current.gitDir, 'codetogether');
    await (0, promises_1.mkdir)(folder, { recursive: true, mode: 0o700 });
    if (!(await (0, promises_1.lstat)(folder)).isDirectory() || (await (0, promises_1.lstat)(folder)).isSymbolicLink()) {
        throw new Error('Commit approval storage must be a real directory.');
    }
    const temporary = path.join(folder, 'approval-' + (0, node_crypto_1.randomUUID)());
    try {
        await (0, promises_1.writeFile)(temporary, current.head + ' ' + current.tree + '\n', { flag: 'wx', mode: 0o600 });
        if (signal?.aborted || !(0, client_1.sameSnapshot)(current, await (0, client_1.stagedSnapshot)(current.root))) {
            throw new Error('Commit approval cancelled or staged changes changed. Start a new review.');
        }
        await (0, promises_1.rename)(temporary, path.join(folder, 'approved-snapshot'));
    }
    finally {
        try {
            await (0, promises_1.unlink)(temporary);
        }
        catch (error) {
            if (error.code !== 'ENOENT') {
                throw error;
            }
        }
    }
    return current;
}
//# sourceMappingURL=commitGate.js.map