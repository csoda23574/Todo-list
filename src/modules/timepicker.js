/**
 * timepicker.js
 * 기본 `<input type="time">` 요소를 찾아 커스텀 타임피커 UI로 대체합니다.
 */

export function initCustomTimePickers() {
    const timeInputs = document.querySelectorAll('input[type="time"].custom-time-input');
    timeInputs.forEach(input => {
        if (input.dataset.customized) return;
        input.dataset.customized = 'true';
        createCustomTimePicker(input);
    });
}

function createCustomTimePicker(originalInput) {
    // 원본 input 숨기기
    originalInput.style.display = 'none';

    // 래퍼 생성
    const wrapper = document.createElement('div');
    wrapper.className = 'custom-time-picker-wrap';
    
    // AM/PM 토글 버튼
    const ampmBtn = document.createElement('button');
    ampmBtn.type = 'button';
    ampmBtn.className = 'ampm-toggle';
    ampmBtn.textContent = '오전';
    
    // 시간 입력칸
    const hourWrap = document.createElement('div');
    hourWrap.className = 'time-part';
    const hourInput = document.createElement('input');
    hourInput.type = 'text';
    hourInput.className = 'time-part-input hour-input';
    hourInput.maxLength = 2;
    hourInput.value = '12';
    hourInput.placeholder = '12';
    
    const hourDropdown = document.createElement('div');
    hourDropdown.className = 'time-dropdown';
    for (let i = 1; i <= 12; i++) {
        const item = document.createElement('div');
        item.className = 'time-dropdown-item';
        item.textContent = String(i).padStart(2, '0');
        item.dataset.value = String(i).padStart(2, '0');
        hourDropdown.appendChild(item);
    }
    hourWrap.appendChild(hourInput);
    hourWrap.appendChild(hourDropdown);

    // 구분자
    const sep = document.createElement('span');
    sep.className = 'time-sep';
    sep.textContent = ':';

    // 분 입력칸
    const minWrap = document.createElement('div');
    minWrap.className = 'time-part';
    const minInput = document.createElement('input');
    minInput.type = 'text';
    minInput.className = 'time-part-input min-input';
    minInput.maxLength = 2;
    minInput.value = '00';
    minInput.placeholder = '00';
    
    const minDropdown = document.createElement('div');
    minDropdown.className = 'time-dropdown';
    for (let i = 0; i < 60; i += 5) {
        const item = document.createElement('div');
        item.className = 'time-dropdown-item';
        item.textContent = String(i).padStart(2, '0');
        item.dataset.value = String(i).padStart(2, '0');
        minDropdown.appendChild(item);
    }
    minWrap.appendChild(minInput);
    minWrap.appendChild(minDropdown);

    // 조합
    wrapper.appendChild(ampmBtn);
    wrapper.appendChild(hourWrap);
    wrapper.appendChild(sep);
    wrapper.appendChild(minWrap);
    
    // DOM 삽입 (원본 요소 바로 뒤)
    originalInput.parentNode.insertBefore(wrapper, originalInput.nextSibling);

    // 상태 변수
    let isPM = false;

    // 동기화 로직 (UI -> 원본 input)
    function syncToOriginal() {
        let h = parseInt(hourInput.value, 10) || 0;
        let m = parseInt(minInput.value, 10) || 0;
        
        if (h === 12) h = isPM ? 12 : 0;
        else if (isPM) h += 12;
        
        const hh = String(h).padStart(2, '0');
        const mm = String(m).padStart(2, '0');
        originalInput.value = `${hh}:${mm}`;
        
        // change 이벤트 발생
        originalInput.dispatchEvent(new Event('change', { bubbles: true }));
    }

    // 동기화 로직 (원본 input -> UI)
    originalInput.syncCustomUI = () => {
        const val = originalInput.value;
        if (!val) {
            hourInput.value = '12';
            minInput.value = '00';
            isPM = false;
            ampmBtn.textContent = '오전';
            return;
        }
        const [hh, mm] = val.split(':');
        let h = parseInt(hh, 10);
        isPM = h >= 12;
        ampmBtn.textContent = isPM ? '오후' : '오전';
        
        if (h === 0) h = 12;
        else if (h > 12) h -= 12;
        
        hourInput.value = String(h).padStart(2, '0');
        minInput.value = mm || '00';
    };

    // 초기 동기화
    originalInput.syncCustomUI();

    // 이벤트 리스너들
    ampmBtn.addEventListener('click', () => {
        isPM = !isPM;
        ampmBtn.textContent = isPM ? '오후' : '오전';
        syncToOriginal();
    });

    function closeAllDropdowns() {
        document.querySelectorAll('.time-dropdown.show').forEach(el => el.classList.remove('show'));
    }

    document.addEventListener('click', (e) => {
        if (!wrapper.contains(e.target)) {
            closeAllDropdowns();
        }
    });

    hourInput.addEventListener('click', (e) => {
        closeAllDropdowns();
        hourDropdown.classList.add('show');
        e.stopPropagation();
    });
    
    minInput.addEventListener('click', (e) => {
        closeAllDropdowns();
        minDropdown.classList.add('show');
        e.stopPropagation();
    });

    hourDropdown.addEventListener('click', (e) => {
        if (e.target.classList.contains('time-dropdown-item')) {
            hourInput.value = e.target.dataset.value;
            hourDropdown.classList.remove('show');
            syncToOriginal();
        }
    });

    minDropdown.addEventListener('click', (e) => {
        if (e.target.classList.contains('time-dropdown-item')) {
            minInput.value = e.target.dataset.value;
            minDropdown.classList.remove('show');
            syncToOriginal();
        }
    });

    // 키보드 입력 제어
    hourInput.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/[^0-9]/g, '');
    });
    hourInput.addEventListener('blur', () => {
        let val = parseInt(hourInput.value, 10);
        if (isNaN(val)) val = 12;
        if (val < 1) val = 12;
        if (val > 12) val = 12;
        hourInput.value = String(val).padStart(2, '0');
        syncToOriginal();
    });

    minInput.addEventListener('input', (e) => {
        e.target.value = e.target.value.replace(/[^0-9]/g, '');
    });
    minInput.addEventListener('blur', () => {
        let val = parseInt(minInput.value, 10);
        if (isNaN(val)) val = 0;
        if (val < 0) val = 0;
        if (val > 59) val = 59;
        minInput.value = String(val).padStart(2, '0');
        syncToOriginal();
    });
}
