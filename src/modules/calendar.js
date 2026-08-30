import { DOM } from './dom.js';
import { state } from './state.js';

let currentYear = new Date().getFullYear();
let currentMonth = new Date().getMonth();

let checkedCategories = new Set();
const HUE_MAP = new Map(); // Store hashed colors

function getTaskColor(taskId) {
    if (HUE_MAP.has(taskId)) return HUE_MAP.get(taskId);
    // Hash id to a hue (0-360)
    let hash = 0;
    for (let i = 0; i < taskId.length; i++) {
        hash = taskId.charCodeAt(i) + ((hash << 5) - hash);
    }
    const hue = Math.abs(hash) % 360;
    const color = `hsl(${hue}, 65%, 45%)`;
    HUE_MAP.set(taskId, color);
    return color;
}

export function openCalendar() {
    DOM.mainContent.classList.add('hidden');
    DOM.calendarView.classList.remove('hidden');
    const now = new Date();
    currentYear = now.getFullYear();
    currentMonth = now.getMonth();
    initCalendarFilter();
    renderCalendar();
}

export function closeCalendar() {
    DOM.calendarView.classList.add('hidden');
    DOM.mainContent.classList.remove('hidden');
}

export function prevMonth() {
    currentMonth--;
    if (currentMonth < 0) {
        currentMonth = 11;
        currentYear--;
    }
    renderCalendar();
}

export function nextMonth() {
    currentMonth++;
    if (currentMonth > 11) {
        currentMonth = 0;
        currentYear++;
    }
    renderCalendar();
}

function getPriority(todo) {
    const r = todo.recurrence || { type: 'neverReset' };
    if (r.type === 'deadline') return 1;
    if (r.type === 'yearly' || r.type === 'monthly') return 2;
    if (r.type === 'everyN' || r.type === 'everyNWeeks' || r.type === 'weekly') return 3;
    if (r.type === 'time' || r.type === 'calendar') return 4;
    return 5;
}

function sortTasks(a, b) {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const pA = getPriority(a);
    const pB = getPriority(b);
    if (pA !== pB) return pA - pB;
    return a.text.localeCompare(b.text);
}

function normalizeDate(d) {
    return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function isDateMatch(todo, checkDate) {
    if (!checkedCategories.has(todo.categoryId || 'default')) return false;

    const r = todo.recurrence;
    if (!r) return false;
    
    // Check start date (inactive before start)
    if (r.startDate) {
        const startT = r.startTime || '00:00';
        const startObj = new Date(`${r.startDate}T${startT}:00`);
        if (checkDate < normalizeDate(startObj)) return false;
    }

    const checkY = checkDate.getFullYear();
    const checkM = checkDate.getMonth() + 1; // 1-12
    const checkD = checkDate.getDate();
    const checkW = checkDate.getDay();

    switch (r.type) {
        case 'deadline': {
            if (!r.date) return false;
            const [y, m, d] = r.date.split('-').map(Number);
            return (y === checkY && m === checkM && d === checkD);
        }
        case 'yearly': {
            if (!r.dates) return false;
            return r.dates.some(dt => dt.month === checkM && dt.day === checkD);
        }
        case 'monthly': {
            if (!r.days) return false;
            return r.days.includes(checkD);
        }
        case 'weekly': {
            if (!r.weekdays) return false;
            return r.weekdays.includes(checkW);
        }
        case 'time': {
            return true; // daily
        }
        case 'everyN': {
            if (!r.startDate || !r.n) return false;
            const startObj = normalizeDate(new Date(r.startDate));
            const diffTime = checkDate - startObj;
            if (diffTime < 0) return false;
            const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
            return diffDays % r.n === 0;
        }
        case 'everyNWeeks': {
            if (!r.startDate || !r.n || r.weekday == null) return false;
            if (checkW !== r.weekday) return false;
            const startObj = normalizeDate(new Date(r.startDate));
            const diffTime = checkDate - startObj;
            if (diffTime < 0) return false;
            const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));
            const diffWeeks = Math.floor(diffDays / 7);
            return diffWeeks % r.n === 0;
        }
        default:
            return false;
    }
}

export function renderCalendar() {
    DOM.calendarTitle.textContent = `${currentYear}년 ${currentMonth + 1}월`;
    DOM.calendarGridBody.innerHTML = '';

    const firstDayIndex = new Date(currentYear, currentMonth, 1).getDay();
    const lastDay = new Date(currentYear, currentMonth + 1, 0).getDate();
    const prevLastDay = new Date(currentYear, currentMonth, 0).getDate();

    const cells = [];
    
    // Prev month
    for (let i = firstDayIndex; i > 0; i--) {
        const d = prevLastDay - i + 1;
        const dt = new Date(currentYear, currentMonth - 1, d);
        cells.push({ date: dt, isCurrent: false });
    }
    
    // Current month
    for (let i = 1; i <= lastDay; i++) {
        const dt = new Date(currentYear, currentMonth, i);
        cells.push({ date: dt, isCurrent: true });
    }
    
    // Next month
    const remaining = 42 - cells.length; // 6 rows always
    for (let i = 1; i <= remaining; i++) {
        const dt = new Date(currentYear, currentMonth + 1, i);
        cells.push({ date: dt, isCurrent: false });
    }

    const today = normalizeDate(new Date());

    cells.forEach(cell => {
        const div = document.createElement('div');
        div.className = 'calendar-cell';
        if (!cell.isCurrent) div.classList.add('other-month');
        if (cell.date.getTime() === today.getTime()) div.classList.add('is-today');

        const dateSpan = document.createElement('span');
        dateSpan.className = 'calendar-date';
        dateSpan.textContent = cell.date.getDate();
        div.appendChild(dateSpan);

        // Find tasks for this day
        const dayTasks = state.todos.filter(t => isDateMatch(t, cell.date));
        dayTasks.sort(sortTasks);

        const MAX_DISPLAY = 3;
        for (let i = 0; i < Math.min(dayTasks.length, MAX_DISPLAY); i++) {
            const task = dayTasks[i];
            const bar = document.createElement('div');
            bar.className = 'calendar-task-bar';
            if (task.done) bar.classList.add('is-done');
            bar.style.backgroundColor = getTaskColor(task.id);
            bar.textContent = task.text;
            bar.title = task.text; // show full text on hover
            div.appendChild(bar);
        }

        if (dayTasks.length > MAX_DISPLAY) {
            const moreBtn = document.createElement('button');
            moreBtn.className = 'calendar-more-btn';
            moreBtn.textContent = `+${dayTasks.length - MAX_DISPLAY} 더보기`;
            moreBtn.addEventListener('click', () => {
                showDetailPopup(cell.date, dayTasks);
            });
            div.appendChild(moreBtn);
        }

        DOM.calendarGridBody.appendChild(div);
    });
}

function showDetailPopup(date, dayTasks) {
    DOM.calDetailDateTitle.textContent = `${date.getMonth() + 1}월 ${date.getDate()}일 일정`;
    DOM.calDetailContent.innerHTML = '';
    
    dayTasks.forEach(task => {
        const bar = document.createElement('div');
        bar.className = 'calendar-task-bar';
        if (task.done) bar.classList.add('is-done');
        bar.style.backgroundColor = getTaskColor(task.id);
        bar.style.padding = '6px 8px';
        bar.style.fontSize = '12px';
        bar.textContent = task.text;
        DOM.calDetailContent.appendChild(bar);
    });
    
    DOM.calDetailPopup.classList.remove('hidden');
}

export function bindCalendarEvents() {
    DOM.calPrevMonthBtn?.addEventListener('click', prevMonth);
    DOM.calNextMonthBtn?.addEventListener('click', nextMonth);
    DOM.calBackBtn?.addEventListener('click', closeCalendar);
    DOM.calDetailCloseBtn?.addEventListener('click', () => {
        DOM.calDetailPopup.classList.add('hidden');
    });
    DOM.calFilterBtn?.addEventListener('click', (e) => {
        e.stopPropagation();
        DOM.calFilterDropdown?.classList.toggle('hidden');
    });

    // 외부 클릭 시 팝업 닫기
    document.addEventListener('click', (e) => {
        if (!DOM.calDetailPopup.classList.contains('hidden')) {
            if (!DOM.calDetailPopup.contains(e.target) && !e.target.closest('.calendar-more-btn')) {
                DOM.calDetailPopup.classList.add('hidden');
            }
        }
        if (DOM.calFilterDropdown && !DOM.calFilterDropdown.classList.contains('hidden')) {
            if (!DOM.calFilterDropdown.contains(e.target) && !e.target.closest('#calFilterBtn')) {
                DOM.calFilterDropdown.classList.add('hidden');
            }
        }
    });
}




import { on } from './bus.js';

on('todos:changed', () => {
    if (!DOM.calendarView.classList.contains('hidden')) {
        renderCalendar();
    }
});




function initCalendarFilter() {
    const dropdown = DOM.calFilterDropdown;
    if (!dropdown) return;
    dropdown.innerHTML = '';
    checkedCategories.clear();
    
    state.categories.forEach(cat => {
        checkedCategories.add(cat.id);
        
        const label = document.createElement('label');
        label.className = 'cal-filter-item';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.value = cat.id;
        checkbox.checked = true;
        
        checkbox.addEventListener('change', (e) => {
            if (e.target.checked) {
                checkedCategories.add(cat.id);
            } else {
                checkedCategories.delete(cat.id);
            }
            renderCalendar();
        });
        
        const span = document.createElement('span');
        span.textContent = cat.name;
        
        label.appendChild(checkbox);
        label.appendChild(span);
        dropdown.appendChild(label);
    });
}

