const fs = require('fs');
let code = fs.readFileSync('src/modules/storage.js', 'utf8');
code = code.replace(/import \{ migrateToRecurrence, calcNextDueAfter \} from '\.\/recurrence\.js';/g, "import { calcNextDueAfter } from './recurrence.js';");
code = code.replace(/\/\/ 구 itemResetTime[\s\S]*?return migrated;\r?\n    }\);/g,     // order 필드 부여 및 과거 필드 삭제
    state.todos = rawTodos.map((todo, i) => {
        const withOrder = todo.order !== undefined ? todo : { ...todo, order: i };
        if (withOrder.itemResetTime !== undefined) delete withOrder.itemResetTime;
        if (withOrder.itemResetSchedule !== undefined) delete withOrder.itemResetSchedule;
        if (withOrder.itemResetDatetime !== undefined) delete withOrder.itemResetDatetime;
        return withOrder;
    }););
fs.writeFileSync('src/modules/storage.js', code);
