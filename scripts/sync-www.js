/**
 * sync-www.js — www/ 디렉토리에 웹 파일 복사
 * APK 빌드 전 실행: npm run sync-www
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WWW = path.resolve(ROOT, 'www');

// 단일 파일
const FILES = [
    'index.html',
    'app.js',
    'style.css',
    'firebase-sync.js',
];

// 디렉토리
const DIRS = ['assets'];

// ─── 디렉토리 재귀 복사 ──────────────────────────────────────────────────────
function copyDir(src, dest) {
    if (!fs.existsSync(src)) return;
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
        const s = path.join(src, entry.name);
        const d = path.join(dest, entry.name);
        entry.isDirectory() ? copyDir(s, d) : fs.copyFileSync(s, d);
    }
}

// Firebase compat SDK — CDN에서 다운로드해 APK에 번들링 (WebView CDN 로딩 불안정 방지)
const FIREBASE_VERSION = '10.14.1';
const FIREBASE_SDK_FILES = [
    'firebase-app-compat.js',
    'firebase-firestore-compat.js',
];

// ─── 파일 다운로드 ────────────────────────────────────────────────────────────
function download(url, dest) {
    const https = require('https');
    return new Promise((resolve, reject) => {
        const file = fs.createWriteStream(dest);
        https.get(url, res => {
            if (res.statusCode !== 200) {
                reject(new Error(`HTTP ${res.statusCode}: ${url}`));
                return;
            }
            res.pipe(file);
            file.on('finish', () => { file.close(); resolve(); });
        }).on('error', err => { fs.unlink(dest, () => { }); reject(err); });
    });
}

// ─── Firebase SDK 다운로드 & www/index.html CDN 경로 → 로컬로 패치 ──────────
async function bundleFirebaseSDK() {
    const libDir = path.join(WWW, 'lib');
    fs.mkdirSync(libDir, { recursive: true });

    for (const file of FIREBASE_SDK_FILES) {
        const dest = path.join(libDir, file);
        if (fs.existsSync(dest)) {
            console.log(`  캐시됨: lib/${file}`);
        } else {
            const url = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/${file}`;
            process.stdout.write(`  다운로드: ${file} ...`);
            await download(url, dest);
            console.log(' 완료');
        }
    }

    // www/index.html 의 CDN URL → 로컬 lib 경로로 교체
    const htmlPath = path.join(WWW, 'index.html');
    let html = fs.readFileSync(htmlPath, 'utf8');
    for (const file of FIREBASE_SDK_FILES) {
        const cdnUrl = `https://www.gstatic.com/firebasejs/${FIREBASE_VERSION}/${file}`;
        html = html.replace(cdnUrl, `lib/${file}`);
    }
    fs.writeFileSync(htmlPath, html);
    console.log('  패치: www/index.html → Firebase SDK 로컬 경로');
}

// ─── 실행 ────────────────────────────────────────────────────────────────────
async function main() {
    fs.mkdirSync(WWW, { recursive: true });

    FILES.forEach(file => {
        const src = path.join(ROOT, file);
        if (!fs.existsSync(src)) { console.warn(`[skip] ${file} 없음`); return; }
        fs.copyFileSync(src, path.join(WWW, file));
        console.log(`  복사: ${file}`);
    });

    DIRS.forEach(dir => {
        copyDir(path.join(ROOT, dir), path.join(WWW, dir));
        console.log(`  복사: ${dir}/`);
    });

    await bundleFirebaseSDK();

    console.log('www/ 동기화 완료.');
}

main().catch(err => { console.error('[sync-www 오류]', err.message); process.exit(1); });
