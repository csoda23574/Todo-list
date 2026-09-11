/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

function expectDate(description, actual, expected) {
    if (!(actual instanceof Date) || actual.getTime() !== expected.getTime()) {
        throw new Error(
            `${description}: expected ${expected.toISOString()}, got ${actual?.toISOString?.() ?? actual}`
        );
    }
    console.log(`PASS: ${description}`);
}

function expectNull(description, actual) {
    if (actual !== null) throw new Error(`${description}: expected null, got ${actual}`);
    console.log(`PASS: ${description}`);
}

async function loadRecurrenceModule() {
    const filePath = path.join(__dirname, '..', 'src', 'modules', 'recurrence.js');
    const source = fs.readFileSync(filePath, 'utf8');
    const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
    return import(url);
}

async function run() {
    const { calcNextDue, calcNextDueAfter } = await loadRecurrenceModule();

    expectDate(
        'daily recurrence advances one day at the configured time',
        calcNextDue({ type: 'daily', time: '06:30' }, new Date(2026, 8, 3, 12, 0)),
        new Date(2026, 8, 4, 6, 30)
    );

    expectDate(
        'weekly recurrence selects the next configured weekday',
        calcNextDue({ type: 'weekly', time: '09:15', weekdays: [1, 5] }, new Date(2026, 8, 3, 12, 0)),
        new Date(2026, 8, 4, 9, 15)
    );

    expectDate(
        'monthly recurrence crosses into the next month',
        calcNextDue({ type: 'monthly', time: '08:00', days: [1, 15] }, new Date(2026, 8, 20, 12, 0)),
        new Date(2026, 9, 1, 8, 0)
    );

    expectDate(
        'yearly recurrence crosses into the next year',
        calcNextDue({ type: 'yearly', time: '00:05', dates: [{ month: 1, day: 2 }] }, new Date(2026, 1, 1, 12, 0)),
        new Date(2027, 0, 2, 0, 5)
    );

    expectDate(
        'overdue recurrence advances to the first future occurrence',
        calcNextDueAfter(
            { type: 'daily', time: '07:00' },
            new Date(2026, 8, 1, 7, 0),
            new Date(2026, 8, 3, 12, 0)
        ),
        new Date(2026, 8, 4, 7, 0)
    );

    expectNull(
        'one-time calendar entries do not schedule another occurrence',
        calcNextDue({ type: 'calendar', time: '10:00' }, new Date(2026, 8, 3, 12, 0))
    );

    console.log('\nRecurrence unit checks passed.');
}

run().catch(err => {
    console.error(`FAIL: ${err.message}`);
    process.exitCode = 1;
});
