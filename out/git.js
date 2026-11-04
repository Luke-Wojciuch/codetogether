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
exports.getStagedContext = getStagedContext;
const vscode = __importStar(require("vscode"));
const path = __importStar(require("node:path"));
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const changes_1 = require("./changes");
const run = (0, node_util_1.promisify)(node_child_process_1.execFile);
async function getStagedContext(uri) {
    const folder = uri ? vscode.workspace.getWorkspaceFolder(uri) : vscode.workspace.workspaceFolders?.[0];
    if (!folder || (!uri && vscode.workspace.workspaceFolders?.length !== 1)) {
        throw new Error('Open one Git project, or start from a specific Source Control file.');
    }
    const git = async (args) => (await run('git', args, {
        cwd: folder.uri.fsPath, maxBuffer: 5 * 1024 * 1024, encoding: 'utf8', timeout: 10_000
    })).stdout;
    const root = (await git(['rev-parse', '--show-toplevel'])).trim();
    const scope = uri ? [path.relative(root, uri.fsPath).replace(/\\/g, '/')] : [];
    const diff = await git(['--literal-pathspecs', '-C', root, 'diff', '--cached', '--no-color', '--no-ext-diff', '--no-textconv', '--function-context', '--', ...scope]);
    if (!diff.trim()) {
        throw new Error('No staged changes in this scope. Stage a change or select code in the editor.');
    }
    const names = (await git(['--literal-pathspecs', '-C', root, 'diff', '--cached', '--name-only', '-z', '--no-renames', '--diff-filter=ACMT', '--', ...scope])).split('\0').filter(Boolean);
    const changes = (0, changes_1.parseNumstat)(await git(['--literal-pathspecs', '-C', root, 'diff', '--cached', '--numstat', '-z', '--no-renames', '--no-ext-diff', '--no-textconv', '--', ...scope]));
    const sources = [];
    let size = diff.length;
    for (const name of names) {
        const content = await git(['-C', root, 'show', `:${name}`]);
        size += content.length;
        if (size > 100_000) {
            throw new Error('Changes are too large. Start from one staged file or select code in the editor.');
        }
        if (!content.includes('\0')) {
            sources.push({ name, content, language: 'plaintext' });
        }
    }
    return { label: 'Staged snapshot (not working-tree files); deleted/binary content may only appear in the diff', diff, sources, changes };
}
//# sourceMappingURL=git.js.map