/**
 * modal-base.js — 모달 열기/닫기 기본 유틸리티
 *
 * modals.js와 crop.js 모두 이 파일을 import합니다 (순환 의존 방지).
 */

function backdropClickHandler(e) {
    if (e.target === e.currentTarget) closeModal(e.currentTarget);
}

function escKeyHandler(e) {
    if (e.key === 'Escape') {
        document.querySelectorAll('.modal-backdrop.open').forEach(m => closeModal(m));
    }
}

export function openModal(modalEl) {
    modalEl.classList.add('open');
    modalEl.addEventListener('click', backdropClickHandler);
    document.addEventListener('keydown', escKeyHandler);
}

export function closeModal(modalEl) {
    modalEl.classList.remove('open');
    modalEl.removeEventListener('click', backdropClickHandler);
    document.removeEventListener('keydown', escKeyHandler);
}
