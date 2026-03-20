/**
 * crop.js — 이미지 크롭 모달
 *
 * 콜백 패턴을 사용해 설정 모달(modals.js)과 분리합니다.
 * openCropModal(dataUrl, fileName, onConfirm) 형태로 호출하세요.
 */

import { openModal, closeModal } from './modal-base.js';

/* ──────────────────────── 크롭 모듈 상태 ───────────────────────────────── */

let _srcImage = null;     // 원본 HTMLImageElement
let _fileName = '';
let _scaleX = 1;
let _scaleY = 1;
let _crop = { x: 0, y: 0, w: 0, h: 0 };
let _vpW = 0;
let _vpH = 0;
let _drag = null;     // { type, dir, startX, startY, startCrop }
let _onConfirm = null;     // 크롭 완료 콜백

const MIN_SIZE = 20;

/* ─────────────────────── 크롭 박스 업데이트 ───────────────────────────── */

function applyCropBox() {
    const box = document.getElementById('cropBox');
    if (!box) return;
    box.style.left = `${_crop.x}px`;
    box.style.top = `${_crop.y}px`;
    box.style.width = `${_crop.w}px`;
    box.style.height = `${_crop.h}px`;

    const infoEl = document.getElementById('cropInfo');
    if (infoEl) {
        infoEl.textContent = `${Math.round(_crop.w * _scaleX)} × ${Math.round(_crop.h * _scaleY)} px`;
    }
}

function clamp({ x, y, w, h }) {
    w = Math.max(MIN_SIZE, w);
    h = Math.max(MIN_SIZE, h);
    x = Math.max(0, Math.min(x, _vpW - w));
    y = Math.max(0, Math.min(y, _vpH - h));
    return { x, y, w: Math.min(w, _vpW - x), h: Math.min(h, _vpH - y) };
}

/* ──────────────────── 크롭 모달 열기 (공개 API) ───────────────────────── */

export function openCropModal(dataUrl, fileName, onConfirm) {
    _fileName = fileName;
    _onConfirm = onConfirm;

    const modal = document.getElementById('cropModal');
    const canvas = document.getElementById('cropCanvas');
    const viewport = document.getElementById('cropViewport');
    if (!modal || !canvas || !viewport) return;

    const img = new Image();
    img.onload = () => {
        _srcImage = img;
        openModal(modal);

        requestAnimationFrame(() => {
            _vpW = viewport.clientWidth;
            const maxH = Math.min(window.innerHeight * 0.6, img.height);
            const ratio = img.width / img.height;
            _vpH = Math.min(_vpW / ratio, maxH);

            canvas.width = img.width;
            canvas.height = img.height;
            canvas.style.height = `${_vpH}px`;
            canvas.getContext('2d').drawImage(img, 0, 0);

            _scaleX = img.width / _vpW;
            _scaleY = img.height / _vpH;

            const pw = _vpW * 0.8, ph = _vpH * 0.8;
            _crop = clamp({ x: (_vpW - pw) / 2, y: (_vpH - ph) / 2, w: pw, h: ph });
            applyCropBox();
        });
    };
    img.src = dataUrl;
}

/* ──────────────────────── 크롭 실행 ───────────────────────────────────── */

function executeCrop() {
    if (!_srcImage) return null;
    const out = document.createElement('canvas');
    out.width = Math.round(_crop.w * _scaleX);
    out.height = Math.round(_crop.h * _scaleY);
    out.getContext('2d').drawImage(
        _srcImage,
        _crop.x * _scaleX, _crop.y * _scaleY,
        _crop.w * _scaleX, _crop.h * _scaleY,
        0, 0, out.width, out.height
    );
    return out.toDataURL('image/jpeg', 0.92);
}

/* ─────────────────────────── 포인터 이벤트 ────────────────────────────── */

function getPointerPos(e) {
    const rect = document.getElementById('cropViewport').getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
}

function onPointerDown(e) {
    e.preventDefault();
    const pos = getPointerPos(e);
    const dir = e.target.dataset.dir;
    const box = document.getElementById('cropBox');
    if (!box) return;

    if (dir) {
        _drag = { type: 'resize', dir, startX: pos.x, startY: pos.y, startCrop: { ..._crop } };
    } else if (e.target === box || box.contains(e.target)) {
        _drag = { type: 'move', startX: pos.x, startY: pos.y, startCrop: { ..._crop } };
    }
}

function onPointerMove(e) {
    if (!_drag) return;
    e.preventDefault();
    const pos = getPointerPos(e);
    const dx = pos.x - _drag.startX;
    const dy = pos.y - _drag.startY;
    const sc = _drag.startCrop;

    if (_drag.type === 'move') {
        _crop = clamp({ x: sc.x + dx, y: sc.y + dy, w: sc.w, h: sc.h });
    } else {
        let { x, y, w, h } = sc;
        const dir = _drag.dir;
        if (dir.includes('e')) w += dx;
        if (dir.includes('s')) h += dy;
        if (dir.includes('w')) { x += dx; w -= dx; }
        if (dir.includes('n')) { y += dy; h -= dy; }
        _crop = clamp({ x, y, w, h });
    }
    applyCropBox();
}

function onPointerUp() { _drag = null; }

/* ─────────────────────── DOMContentLoaded 이벤트 바인딩 ───────────────── */

export function initCropModal() {
    const overlay = document.getElementById('cropViewport');
    const closeBtn = document.getElementById('cropModalClose');
    const cancelBtn = document.getElementById('cropCancelBtn');
    const confirmBtn = document.getElementById('cropConfirmBtn');
    if (!overlay) return;

    const closeCropModal = () => {
        closeModal(document.getElementById('cropModal'));
        _srcImage = null;
    };

    // 마우스 이벤트
    overlay.addEventListener('mousedown', onPointerDown);
    document.addEventListener('mousemove', onPointerMove);
    document.addEventListener('mouseup', onPointerUp);
    // 터치 이벤트
    overlay.addEventListener('touchstart', onPointerDown, { passive: false });
    document.addEventListener('touchmove', onPointerMove, { passive: false });
    document.addEventListener('touchend', onPointerUp);

    closeBtn?.addEventListener('click', closeCropModal);
    cancelBtn?.addEventListener('click', closeCropModal);
    confirmBtn?.addEventListener('click', () => {
        const cropped = executeCrop();
        if (!cropped) return;
        _onConfirm?.(cropped, _fileName);
        closeCropModal();
    });
}
