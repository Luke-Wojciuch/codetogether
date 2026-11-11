"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.git = git;
exports.optionalGit = optionalGit;
exports.stagedSnapshot = stagedSnapshot;
exports.sameSnapshot = sameSnapshot;
const node_child_process_1 = require("node:child_process");
const node_util_1 = require("node:util");
const run = (0, node_util_1.promisify)(node_child_process_1.execFile);
async function git(cwd, args) {
    return (await run('git', args, { cwd, maxBuffer: 5 * 1024 * 1024, encoding: 'utf8', timeout: 10_000 })).stdout;
}
async function optionalGit(cwd, args) {
    try {
        return await git(cwd, args);
    }
    catch (error) {
        if (error.code === 1) {
            return undefined;
        }
        throw error;
    }
}
async function stagedSnapshot(cwd, allStaged = true) {
    const root = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim();
    const gitDir = (await git(root, ['rev-parse', '--absolute-git-dir'])).trim();
    const head = (await optionalGit(root, ['rev-parse', '--verify', '--quiet', 'HEAD']))?.trim() ?? 'unborn';
    const tree = (await git(root, ['write-tree'])).trim();
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(tree) ||
        !/^(?:unborn|[a-f0-9]{40}|[a-f0-9]{64})$/.test(head)) {
        throw new Error('Could not identify the staged Git snapshot.');
    }
    return { root, gitDir, head, tree, allStaged };
}
function sameSnapshot(left, right) {
    return left.root === right.root && left.gitDir === right.gitDir && left.head === right.head && left.tree === right.tree;
}
//# sourceMappingURL=client.js.map