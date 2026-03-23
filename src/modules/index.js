const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

/** 초기화 반복 설정에 맞춰 Key를 생성 (클라이언트의 buildResetKey와 동일한 로직) */
function buildResetKey(localNow, h, m, repeat) {
    const y = localNow.getFullYear();
    const mo = localNow.getMonth();
    const d = localNow.getDate();

    if (repeat === 'weekly') {
        const week = Math.ceil(d / 7);
        return `${y}-W${week}-${localNow.getDay()}-${h}-${m}`;
    }
    if (repeat === 'monthly') return `${y}-${mo}-${h}-${m}`;
    if (repeat === 'yearly') return `${y}-${h}-${m}`;
    return `${y}-${mo}-${d}-${h}-${m}`;
}

/** 평일(Weekday) 초기화 제외 여부 확인 */
function isWeekdayBlocked(localNow, repeat) {
    return repeat === 'weekday' && (localNow.getDay() === 0 || localNow.getDay() === 6);
}

/**
 * 매 1분마다 실행되는 스케줄러.
 * 사용자의 설정 시간과 로컬 타임존을 기반으로 초기화 여부를 판단하고
 * 조건이 충족되면 Firestore 문서를 직접 업데이트합니다.
 */
exports.autoResetTodos = onSchedule("every 1 minutes", async (event) => {
    const usersSnap = await db.collection('userData').get();

    const batch = db.batch();
    let opsCount = 0;

    for (const userDoc of usersSnap.docs) {
        const uid = userDoc.id;
        const settingsRef = db.collection('userData').doc(uid).collection('settings').doc('main');
        const settingsSnap = await settingsRef.get();

        if (!settingsSnap.exists) continue;

        const data = settingsSnap.data();
        const settings = data.settings || {};
        const resetHistory = data.resetHistory || {};
        resetHistory.itemResets = resetHistory.itemResets || {};

        // 사용자의 로컬 타임존 기반으로 현재 시간 계산
        const tz = settings.timezone || 'Asia/Seoul';
        const now = new Date();
        const localNow = new Date(now.toLocaleString('en-US', { timeZone: tz }));

        const currentH = localNow.getHours();
        const currentM = localNow.getMinutes();
        const currentMins = currentH * 60 + currentM;

        let historyChanged = false;

        // 서브컬렉션에서 이미 완료된(done: true) 할 일들만 가져오기
        const todosRef = db.collection('userData').doc(uid).collection('todos');
        const doneTodosSnap = await todosRef.where('done', '==', true).get();
        const doneTodos = doneTodosSnap.docs.map(doc => ({ id: doc.id, ref: doc.ref, ...doc.data() }));

        // [1] 전역(Global) 초기화 로직
        if (settings.resetEnabled && !isWeekdayBlocked(localNow, settings.resetRepeat)) {
            const [resetH, resetM] = (settings.resetTime || '00:00').split(':').map(Number);
            const targetMins = resetH * 60 + resetM;

            // 현재 로컬 시간이 설정된 초기화 시간을 지났다면
            if (currentMins >= targetMins) {
                const resetKey = buildResetKey(localNow, resetH, resetM, settings.resetRepeat);

                // 오늘 아직 전역 초기화가 안 되어 있다면 실행
                if (resetHistory.globalReset !== resetKey) {
                    resetHistory.globalReset = resetKey;
                    historyChanged = true;

                    for (const todo of doneTodos) {
                        if (!todo.itemResetTime && !todo.itemResetDatetime && !todo.itemResetSchedule) {
                            batch.update(todo.ref, { done: false, _updatedAt: admin.firestore.FieldValue.serverTimestamp() });
                            opsCount++;
                            todo.alreadyReset = true; // 중복 초기화 방지
                        }
                    }
                }
            }
        }

        // [2] 개별 시간 초기화(Item Time Reset) 로직
        for (const todo of doneTodos) {
            if (todo.alreadyReset) continue;

            if (todo.itemResetTime && !todo.itemResetDatetime && !todo.itemResetSchedule && !isWeekdayBlocked(localNow, settings.resetRepeat)) {
                const [th, tm] = todo.itemResetTime.split(':').map(Number);
                const targetMins = th * 60 + tm;

                if (currentMins >= targetMins) {
                    const resetKey = buildResetKey(localNow, th, tm, settings.resetRepeat);
                    if (resetHistory.itemResets[todo.id] !== resetKey) {
                        resetHistory.itemResets[todo.id] = resetKey;
                        historyChanged = true;

                        batch.update(todo.ref, { done: false, _updatedAt: admin.firestore.FieldValue.serverTimestamp() });
                        opsCount++;
                    }
                }
            }
        }

        // 이력이 갱신되었다면 타임스탬프를 최신화하여 클라이언트 덮어쓰기 방지
        if (historyChanged) {
            resetHistory.timestamp = Date.now();
            batch.update(settingsRef, { resetHistory });
            opsCount++;
        }
    }

    if (opsCount > 0) {
        await batch.commit();
    }
});