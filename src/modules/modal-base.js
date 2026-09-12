/**
 * modal-base.js — 모달 열기/닫기 기본 유틸리티
 *
 * modals.js와 crop.js 모두 이 파일을 import합니다 (순환 의존 방지).
 */

function backdropPointerDownHandler(e) {
    e.currentTarget._backdropPointerStarted = e.target === e.currentTarget;
}

function backdropPointerUpHandler(e) {
    const modalEl = e.currentTarget;
    const startedOnBackdrop = modalEl._backdropPointerStarted;
    modalEl._backdropPointerStarted = false;
    if (startedOnBackdrop && e.target === modalEl) closeModal(modalEl);
}

function escKeyHandler(e) {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal-backdrop.open').forEach(m => closeModal(m));
    }
}

export function openModal(modalEl) {
    modalEl.classList.add('open');
    modalEl.addEventListener('pointerdown', backdropPointerDownHandler);
    modalEl.addEventListener('pointerup', backdropPointerUpHandler);
    document.addEventListener('keydown', escKeyHandler);
}

export function closeModal(modalEl) {
    modalEl.classList.remove('open');
    modalEl._backdropPointerStarted = false;
    modalEl.removeEventListener('pointerdown', backdropPointerDownHandler);
    modalEl.removeEventListener('pointerup', backdropPointerUpHandler);
    document.removeEventListener('keydown', escKeyHandler);
}
