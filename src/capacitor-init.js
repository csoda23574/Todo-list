/**
 * capacitor-init.js — Capacitor 모바일 플러그인 초기화
 *
 * CSP 적용 시 <script type="module"> 인라인 블록은 허용되지 않으므로
 * 이 파일로 분리하여 script-src 'self' 정책을 준수합니다.
 */

import { Capacitor } from 'https://cdn.jsdelivr.net/npm/@capacitor/core@6.2.0/dist/index.js';
import { LocalNotifications } from 'https://cdn.jsdelivr.net/npm/@capacitor/local-notifications@6.0.2/dist/index.js';

window.CapacitorCore = { Capacitor, LocalNotifications };
