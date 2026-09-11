/**
 * HoYoLAB 상태와 Todo의 외부 완료 조건을 연결하는 순수 함수.
 * 상태·DOM·저장소에 의존하지 않아 실제 API 호출 없이 검증할 수 있습니다.
 */

export const HOYO_CATHERINE_REWARD_CONDITION = 'hoyolab.genshin.catherineRewardClaimed';
export const HOYO_STARRAIL_DAILY_TRAINING_CONDITION = 'hoyolab.starrail.dailyTrainingCompleted';
export const HOYO_ZZZ_DAILY_ENGAGEMENT_CONDITION = 'hoyolab.zzz.dailyEngagementCompleted';

const CONDITION_DETAILS = {
    [HOYO_CATHERINE_REWARD_CONDITION]: {
        game: 'genshin',
        statusKey: 'catherine_reward_claimed',
        label: '원신 · 캐서린 보상 수령 완료',
        notificationTitle: '원신 일퀘 완료',
        notificationText: '캐서린 보상 수령 완료',
    },
    [HOYO_STARRAIL_DAILY_TRAINING_CONDITION]: {
        game: 'starrail',
        statusKey: 'daily_training_completed',
        label: '붕괴: 스타레일 · 일일 훈련 최대치 도달',
        notificationTitle: '스타레일 일일 훈련 완료',
        notificationText: '일일 훈련 보상 최대치 도달',
    },
    [HOYO_ZZZ_DAILY_ENGAGEMENT_CONDITION]: {
        game: 'zzz',
        statusKey: 'daily_engagement_completed',
        label: '젠레스 존 제로 · 일일 활약도 최대치 도달',
        notificationTitle: '젠레스 존 제로 일일 보상 완료',
        notificationText: '일일 활약도 최대치 도달',
    },
};

export function getHoyoConditionDetails(condition) {
    return CONDITION_DETAILS[condition] || null;
}

export function isHoyoCondition(condition) {
    return Boolean(getHoyoConditionDetails(condition));
}

export function hasHoyoConditionLink(todos) {
    return todos.some(todo => isHoyoCondition(todo.externalCompletion?.condition));
}

export function getLinkedHoyoConnections(todos, connections) {
    const linkedIds = new Set();
    for (const todo of todos) {
        const link = todo.externalCompletion;
        const details = getHoyoConditionDetails(link?.condition);
        if (!details) continue;
        if (link.connectionId) {
            const connection = connections.find(item => item.id === link.connectionId);
            if (connection?.game === details.game) linkedIds.add(connection.id);
        } else if (details.game === 'genshin') {
            // 이전 원신 연동 항목은 마이그레이션된 기본 연결로 계속 동작한다.
            const legacyConnection = connections.find(item => item.id === 'genshin-default');
            if (legacyConnection) linkedIds.add(legacyConnection.id);
        }
    }
    return connections.filter(connection => linkedIds.has(connection.id));
}

function isLinkedToConnection(link, connectionId) {
    if (link.connectionId) return link.connectionId === connectionId;
    return link.condition === HOYO_CATHERINE_REWARD_CONDITION && connectionId === 'genshin-default';
}

export function applyHoyoStatusToTodos(todos, result, completedAt) {
    // 기존 원신 호출 형식(status만 전달)도 기본 연결로 해석해 이전 데이터와 테스트를 보존한다.
    const status = result?.status || result;
    const connectionId = result?.connectionId || 'genshin-default';
    const condition = status?.game === 'genshin'
        ? HOYO_CATHERINE_REWARD_CONDITION
        : status?.game === 'starrail'
            ? HOYO_STARRAIL_DAILY_TRAINING_CONDITION
            : status?.game === 'zzz'
                ? HOYO_ZZZ_DAILY_ENGAGEMENT_CONDITION
                : null;
    const details = getHoyoConditionDetails(condition);
    if (!details || status?.conditions?.[details.statusKey] !== true) {
        return { todos, completed: [] };
    }

    const completed = [];
    const nextTodos = todos.map(todo => {
        const link = todo.externalCompletion;
        if (link?.condition !== condition || !isLinkedToConnection(link, connectionId)) return todo;

        if (link.target === 'checklist' && link.checklistId) {
            const checklist = todo.checklist || [];
            const target = checklist.find(item => item.id === link.checklistId);
            if (!target || target.done) return todo;

            const nextChecklist = checklist.map(item =>
                item.id === link.checklistId ? { ...item, done: true } : item
            );
            const done = nextChecklist.every(item => item.done);
            completed.push({ todoId: todo.id, checklistId: link.checklistId, text: target.text, condition });
            return {
                ...todo,
                checklist: nextChecklist,
                done,
                completedAt: done ? completedAt : todo.completedAt,
            };
        }

        if (todo.done) return todo;
        completed.push({ todoId: todo.id, checklistId: null, text: todo.text, condition });
        return { ...todo, done: true, completedAt };
    });

    return completed.length > 0 ? { todos: nextTodos, completed } : { todos, completed };
}
