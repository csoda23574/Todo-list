/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function run(command, args, options = {}) {
    return spawnSync(command, args, {
        stdio: 'pipe',
        encoding: 'utf8',
        shell: false,
        ...options,
    });
}

function runShell(command) {
    return spawnSync(command, {
        stdio: 'pipe',
        encoding: 'utf8',
        shell: true,
    });
}

function printSection(title, body) {
    console.log(`\n===== ${title} =====`);
    if (body && body.trim()) {
        console.log(body.trim());
    } else {
        console.log('(empty)');
    }
}

function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
}

function writeReport(reportDir, fileName, content) {
    ensureDir(reportDir);
    fs.writeFileSync(path.join(reportDir, fileName), content, 'utf8');
}

function buildHints(output) {
    const hints = [];
    const add = (text) => {
        if (!hints.includes(text)) hints.push(text);
    };

    const rules = [
        {
            match: 'login render budget',
            hint: 'Login render budget exceeded: inspect duplicate initialization or emit flow in src/app.js and src/modules/categories.js.',
        },
        {
            match: 'category switch budget',
            hint: 'Category-switch budget exceeded: verify switchCategory only emits once and no extra renderTodos calls occur.',
        },
        {
            match: 'nextDue-based scheduling',
            hint: 'Reset nextDue scheduling check failed: ensure _scheduleNext() function exists in src/modules/reset.js.',
        },
        {
            match: 'calcNextDueAfter for item resets',
            hint: 'calcNextDueAfter import missing in reset.js: ensure it is imported from recurrence.js and used in _applyItemResets.',
        },
        {
            match: 'no longer uses setInterval polling',
            hint: 'setInterval polling still present: remove old interval-based reset timer from src/modules/reset.js.',
        },
        {
            match: 'remote settings: reset change detected',
            hint: 'Reset settings detection mismatch: review getSettingsChangeFlags in src/modules/sync.js for reset field coverage.',
        },
        {
            match: 'remote settings: bg',
            hint: 'Background settings boundary mismatch: confirm bgOpacity/bgBlur checks in getSettingsChangeFlags.',
        },
        {
            match: 'remote settings: title',
            hint: 'Title settings boundary mismatch: confirm appTitle check in getSettingsChangeFlags.',
        },
        {
            match: 'sync settings listener no longer emits categories changed unnecessarily',
            hint: 'Categories emit leaked into settings listener: remove emit(\'categories:changed\') in settings onSnapshot block.',
        },
        {
            match: 'reset timer is gated by minute key',
            hint: 'This check is obsolete. The reset system now uses nextDue-based setTimeout scheduling.',
        },
    ];

    for (const rule of rules) {
        if (output.includes(rule.match)) add(rule.hint);
    }

    if (!hints.length) {
        add('No specific heuristic matched. Inspect the smoke output and changed files below.');
    }

    return hints;
}

function getDiffText() {
    const baseRef = process.env.GITHUB_BASE_REF;

    if (baseRef) {
        run('git', ['fetch', '--no-tags', '--prune', '--depth=1', 'origin', `+refs/heads/${baseRef}:refs/remotes/origin/${baseRef}`]);
        const mergeBase = run('git', ['merge-base', 'HEAD', `refs/remotes/origin/${baseRef}`]);
        const mb = (mergeBase.stdout || '').trim();
        if (mergeBase.status === 0 && mb) {
            const diff = run('git', ['--no-pager', 'diff', '--unified=3', `${mb}..HEAD`]);
            if ((diff.stdout || '').trim()) return diff.stdout;
        }
    }

    const headDiff = run('git', ['--no-pager', 'diff', '--unified=3', 'HEAD~1..HEAD']);
    if (headDiff.status === 0 && (headDiff.stdout || '').trim()) {
        return headDiff.stdout;
    }

    const worktreeDiff = run('git', ['--no-pager', 'diff', '--unified=3']);
    return worktreeDiff.stdout || '';
}

function main() {
    const smokeEnv = process.env.SMOKE_ENV || (process.env.CI ? 'prod' : 'dev');
    const reportDir = process.env.SMOKE_REPORT_DIR || '.smoke-report';
    const smoke = runShell(process.platform === 'win32'
        ? `set SMOKE_ENV=${smokeEnv}&& npm run test:smoke`
        : `SMOKE_ENV=${smokeEnv} npm run test:smoke`);

    const combinedOutput = `${smoke.stdout || ''}${smoke.stderr || ''}`;
    process.stdout.write(smoke.stdout || '');
    process.stderr.write(smoke.stderr || '');

    writeReport(reportDir, 'smoke-output.log', combinedOutput);

    if (smoke.status === 0) {
        writeReport(reportDir, 'smoke-summary.json', JSON.stringify({
            ok: true,
            smokeEnv,
            status: smoke.status,
            timestamp: new Date().toISOString(),
        }, null, 2));
        console.log(`\nSmoke suite passed with policy: ${smokeEnv}`);
        process.exit(0);
    }

    if (smoke.error) {
        printSection('Smoke Runner Error', String(smoke.error));
    }

    const diffText = getDiffText();
    const hints = buildHints(combinedOutput);

    printSection('Smoke Failure Hints', hints.map((h, i) => `${i + 1}. ${h}`).join('\n'));
    printSection('Git Diff (context)', diffText || 'No diff found.');

    writeReport(reportDir, 'smoke-hints.txt', hints.map((h, i) => `${i + 1}. ${h}`).join('\n'));
    writeReport(reportDir, 'smoke-diff.patch', diffText || 'No diff found.');
    writeReport(reportDir, 'smoke-summary.json', JSON.stringify({
        ok: false,
        smokeEnv,
        status: smoke.status,
        timestamp: new Date().toISOString(),
        hintsCount: hints.length,
    }, null, 2));

    process.exit(smoke.status || 1);
}

main();
