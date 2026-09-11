/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');

function expect(description, condition) {
    if (!condition) throw new Error(description);
    console.log(`PASS: ${description}`);
}

async function loadModule() {
    const filePath = path.join(__dirname, '..', 'src', 'modules', 'hoyo-conditions.js');
    const source = fs.readFileSync(filePath, 'utf8');
    const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
    return import(url);
}

async function run() {
    const {
        HOYO_CATHERINE_REWARD_CONDITION,
        HOYO_STARRAIL_DAILY_TRAINING_CONDITION,
        HOYO_ZZZ_DAILY_ENGAGEMENT_CONDITION,
        applyHoyoStatusToTodos,
        getLinkedHoyoConnections,
        hasHoyoConditionLink,
    } = await loadModule();
    const condition = { condition: HOYO_CATHERINE_REWARD_CONDITION, target: 'checklist', checklistId: 'claim' };
    const todos = [
        {
            id: 'daily', text: '원신 일일 루틴', done: false, completedAt: null,
            checklist: [{ id: 'commission', text: '일퀘 완료', done: true }, { id: 'claim', text: '캐서린 보상', done: false }],
            externalCompletion: condition,
        },
        { id: 'other', text: '다른 일', done: false, externalCompletion: null },
    ];

    expect('linked Todo is detected', hasHoyoConditionLink(todos));

    const pending = applyHoyoStatusToTodos(todos, { game: 'genshin', conditions: { catherine_reward_claimed: false } }, '2026-09-10T00:00:00.000Z');
    expect('unclaimed reward does not change Todos', pending.todos === todos && pending.completed.length === 0);

    const applied = applyHoyoStatusToTodos(todos, { game: 'genshin', conditions: { catherine_reward_claimed: true } }, '2026-09-10T00:00:00.000Z');
    expect('claimed reward completes the linked checklist item', applied.todos[0].checklist[1].done === true);
    expect('all-complete checklist completes its parent Todo', applied.todos[0].done === true);
    expect('completion timestamp is set for completed parent Todo', applied.todos[0].completedAt === '2026-09-10T00:00:00.000Z');
    expect('unlinked Todos are unchanged', applied.todos[1] === todos[1]);
    expect('applied status reports one completion', applied.completed.length === 1 && applied.completed[0].checklistId === 'claim');

    const directTodo = [{
        id: 'direct', text: '원신 일퀘 수령', done: false, completedAt: null,
        externalCompletion: { condition: HOYO_CATHERINE_REWARD_CONDITION, target: 'todo' },
    }];
    const directApplied = applyHoyoStatusToTodos(
        directTodo,
        { game: 'genshin', conditions: { catherine_reward_claimed: true } },
        '2026-09-10T00:00:00.000Z'
    );
    expect('claimed reward completes a linked parent Todo directly', directApplied.todos[0].done === true);

    const starrailTodo = [{
        id: 'starrail', text: '스타레일 일일 훈련', done: false, completedAt: null,
        externalCompletion: {
            condition: HOYO_STARRAIL_DAILY_TRAINING_CONDITION,
            connectionId: 'starrail-1', target: 'todo',
        },
    }];
    const trainingPending = applyHoyoStatusToTodos(
        starrailTodo,
        { connectionId: 'starrail-1', status: { game: 'starrail', conditions: { daily_training_completed: false } } },
        '2026-09-10T00:00:00.000Z'
    );
    expect('incomplete daily training does not complete linked Todo', trainingPending.todos === starrailTodo);
    const trainingComplete = applyHoyoStatusToTodos(
        starrailTodo,
        { connectionId: 'starrail-1', status: { game: 'starrail', conditions: { daily_training_completed: true } } },
        '2026-09-10T00:00:00.000Z'
    );
    expect('maxed daily training completes linked Star Rail Todo', trainingComplete.todos[0].done === true);
    const wrongProfile = applyHoyoStatusToTodos(
        starrailTodo,
        { connectionId: 'starrail-2', status: { game: 'starrail', conditions: { daily_training_completed: true } } },
        '2026-09-10T00:00:00.000Z'
    );
    expect('a different HoYoLAB connection cannot complete the Todo', wrongProfile.todos === starrailTodo);

    const zzzTodo = [{
        id: 'zzz', text: '젠레스 존 제로 일일 활약도', done: false, completedAt: null,
        externalCompletion: {
            condition: HOYO_ZZZ_DAILY_ENGAGEMENT_CONDITION,
            connectionId: 'zzz-1', target: 'todo',
        },
    }];
    const engagementComplete = applyHoyoStatusToTodos(
        zzzTodo,
        { connectionId: 'zzz-1', status: { game: 'zzz', conditions: { daily_engagement_completed: true } } },
        '2026-09-10T00:00:00.000Z'
    );
    expect('maxed daily engagement completes linked Zenless Zone Zero Todo', engagementComplete.todos[0].done === true);

    const connections = [
        { id: 'genshin-default', game: 'genshin', uid: 800000000 },
        { id: 'starrail-1', game: 'starrail', uid: 700000000 },
        { id: 'zzz-1', game: 'zzz', uid: 100000000 },
    ];
    expect(
        'game-specific HoYoLAB links select their own connections',
        getLinkedHoyoConnections([...todos, ...starrailTodo, ...zzzTodo], connections).length === 3
    );

    const crossDeviceTodo = [{
        id: 'cross-device', text: '다른 기기 원신 일퀘', done: false,
        externalCompletion: {
            condition: HOYO_CATHERINE_REWARD_CONDITION,
            connectionId: 'desktop-genshin', connectionUid: '800000000', target: 'todo',
        },
    }];
    const androidConnection = { id: 'android-genshin', game: 'genshin', uid: 800000000 };
    expect(
        'matching game UID selects a cross-device HoYoLAB connection',
        getLinkedHoyoConnections(crossDeviceTodo, [androidConnection])[0]?.id === 'android-genshin'
    );
    const crossDeviceApplied = applyHoyoStatusToTodos(
        crossDeviceTodo,
        {
            connectionId: 'android-genshin', connectionUid: 800000000,
            status: { game: 'genshin', conditions: { catherine_reward_claimed: true } },
        },
        '2026-09-10T00:00:00.000Z'
    );
    expect('matching game UID completes the cross-device linked Todo', crossDeviceApplied.todos[0].done === true);
}

run().catch(err => {
    console.error(`FAIL: ${err.message}`);
    process.exitCode = 1;
});
