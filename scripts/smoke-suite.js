/* eslint-disable no-console */
const { spawnSync } = require('child_process');

const checks = [
    { name: 'unit', script: 'test:unit' },
    { name: 'static smoke', script: 'test:smoke:static' },
    { name: 'runtime smoke', script: 'test:smoke:runtime' },
];

function runNpmScript(script) {
    const npmCli = process.env.npm_execpath;
    if (!npmCli) {
        return { status: 1, error: new Error('npm_execpath is not available') };
    }
    return spawnSync(process.execPath, [npmCli, 'run', script], {
        stdio: 'inherit',
        shell: false,
    });
}

const failures = [];

for (const check of checks) {
    const result = runNpmScript(check.script);
    if (result.error || result.status !== 0) {
        failures.push({
            name: check.name,
            status: result.status ?? 1,
            error: result.error?.message,
        });
    }
}

if (failures.length > 0) {
    console.error('\nSmoke suite failures:');
    failures.forEach(({ name, status, error }) => {
        console.error(`- ${name}: exit ${status}${error ? ` (${error})` : ''}`);
    });
    process.exitCode = 1;
} else {
    console.log('\nAll smoke suite checks passed.');
}
