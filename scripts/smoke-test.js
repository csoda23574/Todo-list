/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');

function read(relPath) {
    const abs = path.join(root, relPath);
    return fs.readFileSync(abs, 'utf8');
}

function expect(description, condition) {
    if (!condition) {
        throw new Error(description);
    }
    console.log(`PASS: ${description}`);
}

function expectContains(description, source, snippet) {
    expect(description, source.includes(snippet));
}

function expectMatches(description, source, pattern) {
    expect(description, pattern.test(source));
}

function expectNotContains(description, source, snippet) {
    expect(description, !source.includes(snippet));
}

function run() {
    const appJs = read('src/app.js');
    const resetJs = read('src/modules/reset.js');
    const syncJs = read('src/modules/sync.js');
    const perfJs = read('src/modules/perf.js');
    const smokePolicy = JSON.parse(read('scripts/smoke-policy.json'));

    expect('smoke policy has dev profile', !!smokePolicy.dev);
    expect('smoke policy has prod profile', !!smokePolicy.prod);
    expect(
        'prod login todos budget is stricter or equal to dev',
        smokePolicy.prod.renderBudget.login.todos <= smokePolicy.dev.renderBudget.login.todos
    );
    expect(
        'prod category switch todos budget is stricter or equal to dev',
        smokePolicy.prod.renderBudget.categorySwitch.todos <= smokePolicy.dev.renderBudget.categorySwitch.todos
    );

    expectMatches(
        'app composition root subscribes reset:reschedule',
        appJs,
        /on\(\s*['"]reset:reschedule['"]\s*,\s*scheduleResetTimer\s*\)/
    );

    expectMatches(
        'render metrics wrapper is used for todos render',
        appJs,
        /const\s+renderTodosTracked\s*=\s*withRenderMetric\(\s*['"]todos['"]\s*,\s*renderTodos\s*\)/
    );

    expectContains(
        'render metrics module exposes debug API',
        perfJs,
        'window.todoDebug'
    );

    expectMatches(
        'reset timer uses nextDue-based scheduling',
        resetJs,
        /function\s+_scheduleNext\s*\(\s*\)/
    );

    expectContains(
        'reset system uses calcNextDueAfter for item resets',
        resetJs,
        'calcNextDueAfter'
    );

    expectNotContains(
        'reset no longer uses setInterval polling',
        resetJs,
        'setInterval'
    );

    expectMatches(
        'sync settings listener can reschedule reset timer when settings change',
        syncJs,
        /if\s*\(\s*resetChanged\s*\)\s*(?:\{\s*)?emit\(\s*['"]reset:reschedule['"]\s*\)/
    );

    const settingsListenerStart = syncJs.indexOf('_unsubSettings = settingsRef().onSnapshot');
    const settingsListenerEnd = syncJs.indexOf('export function stopListeners', settingsListenerStart);
    expect('sync settings listener block exists', settingsListenerStart >= 0 && settingsListenerEnd > settingsListenerStart);
    const settingsListenerBlock = syncJs.slice(settingsListenerStart, settingsListenerEnd);

    expectNotContains(
        'sync settings listener no longer emits categories changed unnecessarily',
        settingsListenerBlock,
        "emit('categories:changed');"
    );

    console.log('\nSmoke checks passed.');
}

try {
    run();
} catch (err) {
    console.error(`FAIL: ${err.message}`);
    process.exitCode = 1;
}
