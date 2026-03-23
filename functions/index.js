const { onSchedule } = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");

admin.initializeApp();
const db = admin.firestore();

/** 초기화 반복 설정에 맞춰 Key를 생성 (클라이언트의 buildResetKey와 동일한 로직) */
function buildResetKey(localNow, h, m, repeat) {
    const y = localNow.getUTCFullYear();
    const mo = localNow.getUTCMonth();
    const d = localNow.getUTCDate();

    if (repeat === 'weekly') {
        const week = Math.ceil(d / 7);
        return `${y}-W${week}-${localNow.getUTCDay()}-${h}-${m}`;
    }
    if (repeat === 'monthly') return `${y}-${mo}-${h}-${m}`;
    if (repeat === 'yearly') return `${y}-${h}-${m}`;
    return `${y}-${mo}-${d}-${h}-${m}`;
}

/** 평일(Weekday) 초기화 제외 여부 확인 */
function isWeekdayBlocked(localNow, repeat) {
    return repeat === 'weekday' && (localNow.getUTCDay() === 0 || localNow.getUTCDay() === 6);
}

/**
 * 매 1분마다 실행되는 스케줄러.
 * 사용자의 설정 시간과 로컬 타임존을 기반으로 초기화 여부를 판단하고
 * 조건이 충족되면 Firestore 문서를 직접 업데이트합니다.
 */
exports.autoResetTodos = onSchedule("every 1 minutes", async (event) => {
    const batch = db.batch();
    let opsCount = 0;

    // Firestore 'userData' 컬렉션을 직접 조회하면 서브컬렉션만 있는 유령 문서는 조회되지 않으므로,
    // Firebase Auth의 가입된 유저 목록을 기반으로 순회하도록 변경합니다.
    let pageToken;
    do {
        const listUsersResult = await admin.auth().listUsers(1000, pageToken);
        pageToken = listUsersResult.pageToken;

        for (const userRecord of listUsersResult.users) {
            const uid = userRecord.uid;
            const settingsRef = db.collection('userData').doc(uid).collection('settings').doc('main');
            const settingsSnap = await settingsRef.get();

            // 설정 문서가 없더라도 기본값을 사용하여 무조건 초기화 검사를 진행합니다.
            const data = settingsSnap.exists ? settingsSnap.data() : {};
            const settings = data.settings || {};
            const resetHistory = data.resetHistory || {};
            resetHistory.itemResets = resetHistory.itemResets || {};

            // 사용자의 로컬 타임존 기반으로 현재 시간 계산
            let localNow;
            try {
                const tz = settings.timezone || 'Asia/Seoul';
                const now = new Date();

                // 시간, 분을 문자열 파싱 없이 숫자로 직접 안전하게 추출
                const parts = new Intl.DateTimeFormat('en-US', {
                    timeZone: tz,
                    year: 'numeric', month: 'numeric', day: 'numeric',
                    hour: 'numeric', minute: 'numeric', second: 'numeric',
                    hourCycle: 'h23'
                }).formatToParts(now);

                const p = {};
                parts.forEach(part => {
                    if (part.type !== 'literal') p[part.type] = parseInt(part.value, 10);
                });

                // 완벽한 로컬 시간 계산을 위해 추출한 숫자로 임시 UTC Date 객체 생성
                const h = p.hour === 24 ? 0 : p.hour;
                localNow = new Date(Date.UTC(p.year, p.month - 1, p.day, h, p.minute, p.second));
            } catch (e) {
                localNow = new Date(); // Fallback
            }

            const currentH = localNow.getUTCHours();
            const currentM = localNow.getUTCMinutes();
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
                            todo.alreadyReset = true;
                        }
                    }
                }
            }

            // [3] 스케줄(Schedule) 및 날짜지정(Datetime) 초기화 로직
            for (const todo of doneTodos) {
                if (todo.alreadyReset) continue;

                // 3-1. 반복 스케줄(Schedule) 초기화
                if (todo.itemResetSchedule) {
                    const s = todo.itemResetSchedule;
                    const [sh, sm] = (s.time || '00:00').split(':').map(Number);

                    let target = new Date(localNow.getTime());
                    if (currentMins < sh * 60 + sm) {
                        target.setUTCDate(target.getUTCDate() - 1);
                    }

                    let matched = false;
                    if (s.type === 'weekly') matched = (s.weekdays || []).includes(target.getUTCDay());
                    else if (s.type === 'monthly') matched = (s.days || []).includes(target.getUTCDate());
                    else if (s.type === 'yearly') matched = (s.dates || []).some(d => d.month === (target.getUTCMonth() + 1) && d.day === target.getUTCDate());

                    if (matched) {
                        const occKey = `${s.type}-${target.getUTCFullYear()}-${target.getUTCMonth()}-${target.getUTCDate()}-${sh}-${sm}`;
                        if (resetHistory.itemResets[todo.id] !== occKey) {
                            resetHistory.itemResets[todo.id] = occKey;
                            historyChanged = true;
                            batch.update(todo.ref, { done: false, _updatedAt: admin.firestore.FieldValue.serverTimestamp() });
                            opsCount++;
                            todo.alreadyReset = true;
                        }
                    }
                }
                // 3-2. 특정 날짜/시간(Datetime) 초기화
                else if (todo.itemResetDatetime) {
                    // todo.itemResetDatetime 형식: "2026-03-23T21:19"
                    const [datePart, timePart] = todo.itemResetDatetime.split('T');
                    if (datePart && timePart) {
                        const [y, mo, d] = datePart.split('-').map(Number);
                        const [th, tm] = timePart.split(':').map(Number);
                        const targetMins = th * 60 + tm;

                        // 유저의 로컬 타임존 기준으로 시간이 지났는지 확인
                        const isPassed = (
                            localNow.getUTCFullYear() > y ||
                            (localNow.getUTCFullYear() === y && (localNow.getUTCMonth() + 1) > mo) ||
                            (localNow.getUTCFullYear() === y && (localNow.getUTCMonth() + 1) === mo && localNow.getUTCDate() > d) ||
                            (localNow.getUTCFullYear() === y && (localNow.getUTCMonth() + 1) === mo && localNow.getUTCDate() === d && currentMins >= targetMins)
                        );

                        if (isPassed && resetHistory.itemResets[todo.id] !== todo.itemResetDatetime) {
                            resetHistory.itemResets[todo.id] = todo.itemResetDatetime;
                            historyChanged = true;
                            batch.update(todo.ref, { done: false, _updatedAt: admin.firestore.FieldValue.serverTimestamp() });
                            opsCount++;
                            todo.alreadyReset = true;
                        }
                    }
                }
            }

            // 이력이 갱신되었다면 타임스탬프를 최신화하여 클라이언트 덮어쓰기 방지
            if (historyChanged) {
                resetHistory.timestamp = Date.now();
                // 설정 문서가 없었을 경우를 대비해 update 대신 set + merge 옵션을 사용합니다.
                batch.set(settingsRef, { resetHistory }, { merge: true });
                opsCount++;
            }
        }
    } while (pageToken);

    if (opsCount > 0) {
        await batch.commit();
    }
});