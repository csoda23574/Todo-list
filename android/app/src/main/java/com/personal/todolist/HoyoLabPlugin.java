package com.personal.todolist;

import android.app.Dialog;
import android.graphics.Color;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.view.ViewGroup;
import android.view.Window;
import android.webkit.CookieManager;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.KeyStore;
import java.security.MessageDigest;
import java.security.SecureRandom;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.Locale;
import java.util.Map;
import java.util.TimeZone;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

import javax.crypto.Cipher;
import javax.crypto.KeyGenerator;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;

import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyProperties;

/** Android 안에서만 HoYoLAB 로그인·암호화 저장·실시간 메모 조회를 처리합니다. */
@CapacitorPlugin(name = "HoyoLab")
public class HoyoLabPlugin extends Plugin {
    private static final String PREFS = "hoyo_lab_connections";
    private static final String CONNECTIONS_KEY = "connections";
    private static final String CREDENTIAL_PREFIX = "credential_";
    private static final String KEY_ALIAS = "todo_hoyolab_credentials";
    private static final String LOGIN_URL = "https://account.hoyoverse.com/#/login?cb_route=%2Faccount%2FaccountInfo";
    private static final String DS_SALT = "6s25p5ox5y14umn1p61aqyyvbvvl3lrt";
    private static final String[] COOKIE_URLS = {
        "https://www.hoyolab.com/",
        "https://bbs-api-os.hoyolab.com/",
        "https://act.hoyolab.com/",
        "https://account.hoyolab.com/",
        "https://account.hoyoverse.com/",
        "https://api-os-takumi.mihoyo.com/",
        "https://api-os-takumi.hoyoverse.com/"
    };

    private final Map<String, String> temporaryCookies = new ConcurrentHashMap<>();
    private final Map<String, PendingAuthentication> pendingAuthentications = new ConcurrentHashMap<>();
    private final SecureRandom secureRandom = new SecureRandom();

    private static final class PendingAuthentication {
        final String game;
        final boolean rememberLogin;
        volatile String cookieHeader = "";
        volatile boolean windowOpen;
        volatile boolean loginNotified;
        volatile boolean accountLookupInProgress;
        volatile int accountLookupAttempts;
        volatile boolean loginFormRequested;
        volatile boolean authCookieCheckScheduled;
        volatile int authCookieCheckAttempts;
        volatile JSONObject account;
        Dialog dialog;
        WebView webView;

        PendingAuthentication(String game, boolean rememberLogin) {
            this.game = game;
            this.rememberLogin = rememberLogin;
        }
    }

    @PluginMethod
    public void getHoyoConnections(PluginCall call) {
        JSArray connections = new JSArray();
        for (int index = 0; index < loadConnections().length(); index++) {
            try {
                connections.put(JSObject.fromJSONObject(loadConnections().getJSONObject(index)));
            } catch (Exception ignored) { }
        }
        JSObject result = new JSObject();
        result.put("connections", connections);
        call.resolve(result);
    }

    @PluginMethod
    public void getHoyoCredentialStorageStatus(PluginCall call) {
        JSObject result = new JSObject();
        boolean available = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M;
        result.put("available", available);
        result.put("message", available
            ? "로그인 정보는 이 기기의 보안 저장소에 암호화해 보관합니다."
            : "이 Android 버전에서는 로그인 정보를 안전하게 저장할 수 없습니다.");
        call.resolve(result);
    }

    @PluginMethod
    public void beginHoyoAuthentication(PluginCall call) {
        String game = call.getString("game");
        boolean rememberLogin = call.getBoolean("rememberLogin", false);
        if (!isSupportedGame(game)) {
            resolveError(call, "invalid_game", "지원하지 않는 HoYoLAB 게임입니다.");
            return;
        }
        if (rememberLogin && Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            resolveError(call, "storage_unavailable", "이 Android 버전에서는 로그인 정보를 안전하게 저장할 수 없습니다.");
            return;
        }

        String connectionId = "hoyo-" + UUID.randomUUID();
        pendingAuthentications.put(connectionId, new PendingAuthentication(game, rememberLogin));
        getActivity().runOnUiThread(() -> clearWebCookies(() -> openAuthenticationDialog(connectionId)));

        JSObject result = new JSObject();
        result.put("ok", true);
        result.put("connectionId", connectionId);
        call.resolve(result);
    }

    @PluginMethod
    public void completeHoyoConnection(PluginCall call) {
        String connectionId = call.getString("connectionId");
        PendingAuthentication pending = pendingAuthentications.get(connectionId);
        if (pending == null || !hasAuthenticatedCookies(pending.cookieHeader)) {
            resolveError(call, "authentication", "HoYoLAB 연결 창에서 로그인한 뒤 다시 시도해 주세요.");
            return;
        }

        execute(() -> {
            try {
                JSONObject account = pending.account != null
                    ? pending.account
                    : findGameAccount(pending.game, pending.cookieHeader);
                JSONObject connection = new JSONObject();
                connection.put("id", connectionId);
                connection.put("game", pending.game);
                connection.put("uid", account.optString("game_uid"));
                connection.put("server", account.optString("region"));
                connection.put("nickname", account.optString("nickname"));
                connection.put("level", account.optInt("level"));
                connection.put("rememberLogin", pending.rememberLogin);
                connection.put("refreshInterval", 15);

                if (pending.rememberLogin) {
                    getPreferences().edit()
                        .putString(CREDENTIAL_PREFIX + connectionId, encrypt(pending.cookieHeader))
                        .apply();
                } else {
                    temporaryCookies.put(connectionId, pending.cookieHeader);
                }
                saveConnection(connection);

                JSObject result = new JSObject();
                result.put("ok", true);
                result.put("connection", JSObject.fromJSONObject(connection));
                JSObject accountResult = new JSObject();
                accountResult.put("uid", account.optString("game_uid"));
                accountResult.put("nickname", account.optString("nickname"));
                accountResult.put("server", account.optString("region_name", account.optString("region")));
                accountResult.put("level", account.optInt("level"));
                result.put("account", accountResult);
                call.resolve(result);
            } catch (HoyoException error) {
                resolveError(call, error.code, error.getMessage());
            } catch (Exception error) {
                resolveError(call, "connection_failed", "HoYoLAB 게임 계정을 자동으로 연결하지 못했습니다.");
            }
        });
    }

    @PluginMethod
    public void closeHoyoAuthentication(PluginCall call) {
        String connectionId = call.getString("connectionId");
        PendingAuthentication pending = pendingAuthentications.remove(connectionId);
        getActivity().runOnUiThread(() -> {
            if (pending != null && pending.dialog != null && pending.dialog.isShowing()) pending.dialog.dismiss();
            if (pending != null && !pending.rememberLogin) clearWebCookies(null);
        });
        call.resolve(new JSObject());
    }

    @PluginMethod
    public void getHoyoAuthState(PluginCall call) {
        String connectionId = call.getString("connectionId");
        PendingAuthentication pending = pendingAuthentications.get(connectionId);
        String cookies = pending != null ? pending.cookieHeader : getStoredCookies(connectionId);
        JSObject result = new JSObject();
        result.put("connectionId", connectionId);
        result.put("signedIn", hasAuthenticatedCookies(cookies));
        result.put("windowOpen", pending != null && pending.windowOpen);
        call.resolve(result);
    }

    @PluginMethod
    public void checkHoyoStatus(PluginCall call) {
        String connectionId = call.getString("connectionId");
        JSONObject connection = findConnection(connectionId);
        if (connection == null) {
            resolveError(call, "connection_unavailable", "HoYoLAB 연결 정보를 찾지 못했습니다.");
            return;
        }
        String cookies = getStoredCookies(connectionId);
        if (!hasAuthenticatedCookies(cookies)) {
            resolveError(call, "authentication", "HoYoLAB 연결 창에서 다시 로그인해 주세요.");
            return;
        }

        execute(() -> {
            try {
                JSObject result = new JSObject();
                result.put("ok", true);
                result.put("status", buildStatus(connection, cookies));
                call.resolve(result);
            } catch (HoyoException error) {
                resolveError(call, error.code, error.getMessage());
            } catch (Exception error) {
                resolveError(call, "check_failed", "HoYoLAB 상태를 확인하지 못했습니다. 잠시 후 다시 시도해 주세요.");
            }
        });
    }

    private void openAuthenticationDialog(String connectionId) {
        PendingAuthentication pending = pendingAuthentications.get(connectionId);
        if (pending == null) return;

        Dialog dialog = new Dialog(getActivity());
        dialog.requestWindowFeature(Window.FEATURE_NO_TITLE);
        WebView webView = new WebView(getActivity());
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, true);
        webView.setBackgroundColor(Color.WHITE);
        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public void onProgressChanged(WebView view, int progress) {
                super.onProgressChanged(view, progress);
                if (progress == 100) {
                    PendingAuthentication pending = pendingAuthentications.get(connectionId);
                    if (pending != null && isAccountSite(view.getUrl()) && !pending.loginFormRequested) {
                        requestLoginForm(pending);
                    }
                    captureAuthenticationCookies(connectionId, view.getUrl());
                }
            }
        });
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                super.onPageFinished(view, url);
                PendingAuthentication pending = pendingAuthentications.get(connectionId);
                if (pending != null && isAccountSite(url) && !pending.loginFormRequested) {
                    requestLoginForm(pending);
                }
                captureAuthenticationCookies(connectionId, url);
            }
        });

        dialog.setContentView(webView);
        dialog.setOnDismissListener(ignored -> {
            PendingAuthentication current = pendingAuthentications.get(connectionId);
            if (current == null) return;
            current.windowOpen = false;
            emitAuthenticationState(connectionId, hasAuthenticatedCookies(current.cookieHeader), false);
        });
        dialog.show();
        if (dialog.getWindow() != null) {
            dialog.getWindow().setLayout(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT);
        }
        pending.dialog = dialog;
        pending.webView = webView;
        pending.windowOpen = true;
        webView.loadUrl(LOGIN_URL);
        scheduleAuthenticationCookieCheck(connectionId, pending);
    }

    private void captureAuthenticationCookies(String connectionId, String currentUrl) {
        PendingAuthentication pending = pendingAuthentications.get(connectionId);
        if (pending == null) return;
        String cookies = collectWebCookies(currentUrl);
        if (!hasAccountSessionCookies(cookies)) return;
        pending.cookieHeader = cookies;

        if (!hasAuthenticatedCookies(cookies)) {
            return;
        }
        verifyGameAccountBeforeConnecting(connectionId, pending);
    }

    private boolean isAccountSite(String url) {
        return url != null && (
            url.contains("://account.hoyolab.com/")
            || url.contains("://account.hoyoverse.com/")
        );
    }

    private void requestLoginForm(PendingAuthentication pending) {
        if (pending.webView == null) return;
        pending.loginFormRequested = true;
        pending.webView.evaluateJavascript(
            "(function(){var tries=0;function openLogin(){"
                + "if(document.querySelector('input[type=password]'))return;"
                + "var controls=Array.prototype.slice.call(document.querySelectorAll('button,a,[role=button]'));"
                + "var login=controls.find(function(control){return /(log\\s*in|로그인)/i.test((control.textContent||'').trim());});"
                + "if(login){login.click();return;}"
                + "if(++tries<10)setTimeout(openLogin,300);"
                + "}openLogin();})()",
            null
        );
    }

    private void scheduleAuthenticationCookieCheck(String connectionId, PendingAuthentication pending) {
        if (pending.authCookieCheckScheduled || !pending.windowOpen || pending.loginNotified) return;
        if (pending.authCookieCheckAttempts >= 300) return;
        pending.authCookieCheckScheduled = true;
        new Handler(Looper.getMainLooper()).postDelayed(() -> {
            pending.authCookieCheckScheduled = false;
            if (!pending.windowOpen || pending.loginNotified) return;
            pending.authCookieCheckAttempts += 1;
            captureAuthenticationCookies(connectionId,
                pending.webView != null ? pending.webView.getUrl() : null);
            scheduleAuthenticationCookieCheck(connectionId, pending);
        }, 1000);
    }

    private void verifyGameAccountBeforeConnecting(String connectionId, PendingAuthentication pending) {
        if (pending.loginNotified || pending.accountLookupInProgress) return;
        pending.accountLookupInProgress = true;
        execute(() -> {
            try {
                pending.account = findGameAccount(pending.game, pending.cookieHeader);
                pending.loginNotified = true;
                emitAuthenticationState(connectionId, true, pending.windowOpen);
            } catch (Exception ignored) {
                pending.accountLookupInProgress = false;
                pending.accountLookupAttempts += 1;
                if (pending.windowOpen && pending.accountLookupAttempts < 8) {
                    new Handler(Looper.getMainLooper()).postDelayed(
                        () -> captureAuthenticationCookies(connectionId,
                            pending.webView != null ? pending.webView.getUrl() : null), 1500
                    );
                } else if (pending.windowOpen) {
                    // 로그인 쿠키만 생긴 상태에서는 연결을 시도하지 않는다. 계정 선택·보안 검사가
                    // 끝난 뒤 페이지가 다시 로드되면 위 콜백이 재시도한다.
                    pending.accountLookupAttempts = 0;
                }
            }
        });
    }

    private void emitAuthenticationState(String connectionId, boolean signedIn, boolean windowOpen) {
        JSObject event = new JSObject();
        event.put("connectionId", connectionId);
        event.put("signedIn", signedIn);
        event.put("windowOpen", windowOpen);
        notifyListeners("hoyoAuthState", event, true);
    }

    private JSONObject findGameAccount(String game, String cookies) throws Exception {
        JSONObject data = requestJson("https://api-os-takumi.hoyoverse.com/binding/api/getUserGameRolesByCookie", cookies);
        JSONArray accounts = data.optJSONArray("list");
        String gameMarker = game.equals("genshin") ? "hk4e" : game.equals("starrail") ? "hkrpg" : "nap";
        JSONObject selected = null;
        int highestLevel = -1;
        if (accounts != null) {
            for (int index = 0; index < accounts.length(); index++) {
                JSONObject account = accounts.optJSONObject(index);
                if (account == null || !account.optString("game_biz").toLowerCase(Locale.ROOT).contains(gameMarker)) continue;
                int level = account.optInt("level", 0);
                if (selected == null || level > highestLevel) {
                    selected = account;
                    highestLevel = level;
                }
            }
        }
        if (selected == null) {
            throw new HoyoException("account_not_found", "로그인한 HoYoLAB 계정에서 선택한 게임 역할을 찾지 못했습니다.");
        }
        return selected;
    }

    private JSObject buildStatus(JSONObject connection, String cookies) throws Exception {
        String game = connection.optString("game");
        String uid = connection.optString("uid");
        String server = connection.optString("server");
        String endpoint;
        if (game.equals("genshin")) {
            endpoint = "https://sg-public-api.hoyolab.com/event/game_record/genshin/api/dailyNote";
        } else if (game.equals("starrail")) {
            endpoint = "https://bbs-api-os.hoyolab.com/game_record/hkrpg/api/note";
        } else if (game.equals("zzz")) {
            endpoint = "https://sg-act-public-api.hoyolab.com/event/game_record_zzz/api/zzz/note";
        } else {
            throw new HoyoException("invalid_game", "지원하지 않는 HoYoLAB 게임입니다.");
        }
        String query = "role_id=" + URLEncoder.encode(uid, "UTF-8")
            + "&server=" + URLEncoder.encode(server, "UTF-8");
        JSONObject data = requestJson(endpoint + "?" + query, cookies);
        JSObject status = new JSObject();
        status.put("provider", "hoyolab");
        status.put("game", game);
        status.put("checked_at", nowIsoUtc());

        if (game.equals("genshin")) {
            JSONObject dailyTask = data.optJSONObject("daily_task");
            int completed = dailyTask != null ? dailyTask.optInt("finished_num", -1) : -1;
            int maximum = dailyTask != null ? dailyTask.optInt("total_num", -1) : -1;
            boolean claimed = dailyTask != null && dailyTask.optBoolean("is_extra_task_reward_received", false);
            JSObject progress = new JSObject();
            progress.put("completed", completed >= 0 ? completed : JSONObject.NULL);
            progress.put("maximum", maximum >= 0 ? maximum : JSONObject.NULL);
            status.put("daily_task", progress);
            JSObject conditions = new JSObject();
            conditions.put("catherine_reward_claimed", dailyTask == null ? JSONObject.NULL : claimed);
            status.put("conditions", conditions);
        } else if (game.equals("starrail")) {
            int current = data.optInt("current_train_score", -1);
            int maximum = data.optInt("max_train_score", -1);
            JSObject progress = new JSObject();
            progress.put("current", current >= 0 ? current : JSONObject.NULL);
            progress.put("maximum", maximum >= 0 ? maximum : JSONObject.NULL);
            status.put("daily_training", progress);
            JSObject conditions = new JSObject();
            conditions.put("daily_training_completed", maximum > 0 && current >= 0 ? current >= maximum : JSONObject.NULL);
            status.put("conditions", conditions);
        } else {
            JSONObject vitality = data.optJSONObject("vitality");
            int current = vitality != null ? vitality.optInt("current", -1) : -1;
            int maximum = vitality != null ? vitality.optInt("max", -1) : -1;
            JSObject progress = new JSObject();
            progress.put("current", current >= 0 ? current : JSONObject.NULL);
            progress.put("maximum", maximum >= 0 ? maximum : JSONObject.NULL);
            status.put("daily_engagement", progress);
            JSObject conditions = new JSObject();
            conditions.put("daily_engagement_completed", maximum > 0 && current >= 0 ? current >= maximum : JSONObject.NULL);
            status.put("conditions", conditions);
        }
        return status;
    }

    private JSONObject requestJson(String url, String cookies) throws Exception {
        HttpURLConnection connection = (HttpURLConnection) new URL(url).openConnection();
        connection.setRequestMethod("GET");
        connection.setConnectTimeout(15000);
        connection.setReadTimeout(15000);
        connection.setRequestProperty("Accept", "application/json, text/plain, */*");
        connection.setRequestProperty("Cookie", cookies);
        connection.setRequestProperty("Referer", "https://www.hoyolab.com/");
        connection.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36");
        connection.setRequestProperty("x-rpc-app_version", "1.5.0");
        connection.setRequestProperty("x-rpc-client_type", "5");
        connection.setRequestProperty("x-rpc-language", "ko-kr");
        connection.setRequestProperty("x-rpc-lang", "ko-kr");
        connection.setRequestProperty("DS", dynamicSecret());

        int responseCode = connection.getResponseCode();
        InputStream stream = responseCode >= 400 ? connection.getErrorStream() : connection.getInputStream();
        String body = readStream(stream);
        connection.disconnect();
        JSONObject response = body.isEmpty() ? new JSONObject() : new JSONObject(body);
        int retcode = response.optInt("retcode", 0);
        if (responseCode >= 400 || retcode != 0) throw hoyoError(retcode, response.optString("message"));
        JSONObject data = response.optJSONObject("data");
        return data != null ? data : new JSONObject();
    }

    private HoyoException hoyoError(int retcode, String message) {
        if (retcode == -100 || retcode == 10001 || retcode == -1071) {
            return new HoyoException("authentication", "HoYoLAB 연결 창에서 다시 로그인해 주세요.");
        }
        if (retcode == 10102) {
            return new HoyoException("data_private", "HoYoLAB에서 이 게임의 실시간 메모를 활성화한 뒤 다시 시도해 주세요.");
        }
        if (retcode == 10103) {
            return new HoyoException("account_not_found", "HoYoLAB 계정에서 연결한 게임 계정을 찾지 못했습니다.");
        }
        if (retcode == 429 || retcode == -1009) {
            return new HoyoException("rate_limited", "HoYoLAB 요청이 잠시 제한되었습니다. 잠시 후 다시 시도해 주세요.");
        }
        return new HoyoException("check_failed", message == null || message.isEmpty()
            ? "HoYoLAB 상태를 확인하지 못했습니다."
            : "HoYoLAB 상태를 확인하지 못했습니다: " + message);
    }

    private String dynamicSecret() throws Exception {
        long timestamp = System.currentTimeMillis() / 1000L;
        String alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ";
        StringBuilder random = new StringBuilder();
        for (int index = 0; index < 6; index++) random.append(alphabet.charAt(secureRandom.nextInt(alphabet.length())));
        String input = "salt=" + DS_SALT + "&t=" + timestamp + "&r=" + random;
        byte[] digest = MessageDigest.getInstance("MD5").digest(input.getBytes(StandardCharsets.UTF_8));
        StringBuilder hash = new StringBuilder();
        for (byte value : digest) hash.append(String.format(Locale.ROOT, "%02x", value & 0xff));
        return timestamp + "," + random + "," + hash;
    }

    private String collectWebCookies(String currentUrl) {
        CookieManager cookieManager = CookieManager.getInstance();
        Map<String, String> cookies = new LinkedHashMap<>();
        addWebCookies(cookies, currentUrl == null ? null : cookieManager.getCookie(currentUrl));
        for (String url : COOKIE_URLS) {
            addWebCookies(cookies, cookieManager.getCookie(url));
        }
        StringBuilder result = new StringBuilder();
        for (Map.Entry<String, String> cookie : cookies.entrySet()) {
            if (result.length() > 0) result.append("; ");
            result.append(cookie.getKey()).append("=").append(cookie.getValue());
        }
        return result.toString();
    }

    private void addWebCookies(Map<String, String> cookies, String cookieHeader) {
        if (cookieHeader == null) return;
        for (String part : cookieHeader.split(";")) {
            String[] pair = part.trim().split("=", 2);
            if (pair.length == 2 && !pair[0].isEmpty() && !pair[1].isEmpty()) cookies.put(pair[0], pair[1]);
        }
    }

    private void clearWebCookies(Runnable done) {
        CookieManager cookieManager = CookieManager.getInstance();
        cookieManager.removeAllCookies(ignored -> {
            cookieManager.flush();
            if (done != null) done.run();
        });
    }

    private boolean hasAccountSessionCookies(String header) {
        return hasAuthenticatedCookies(header)
            || hasCookie(header, "login_ticket")
            || hasCookie(header, "login_ticket_v2");
    }

    private boolean hasAuthenticatedCookies(String header) {
        return hasLoginCookies(header)
            || (hasCookie(header, "account_id") && hasCookie(header, "cookie_token"))
            || (hasCookie(header, "account_id_v2") && hasCookie(header, "cookie_token_v2"));
    }

    private boolean hasLoginCookies(String header) {
        return (hasCookie(header, "ltuid") || hasCookie(header, "ltuid_v2"))
            && (hasCookie(header, "ltoken") || hasCookie(header, "ltoken_v2"));
    }

    private boolean hasCookie(String header, String expectedName) {
        if (header == null || header.isEmpty()) return false;
        for (String part : header.split(";")) {
            String[] pair = part.trim().split("=", 2);
            if (pair.length == 2 && pair[0].equals(expectedName) && !pair[1].isEmpty()) return true;
        }
        return false;
    }

    private String getStoredCookies(String connectionId) {
        String temporary = temporaryCookies.get(connectionId);
        if (temporary != null) return temporary;
        String encrypted = getPreferences().getString(CREDENTIAL_PREFIX + connectionId, null);
        if (encrypted == null) return "";
        try {
            return decrypt(encrypted);
        } catch (Exception error) {
            getPreferences().edit().remove(CREDENTIAL_PREFIX + connectionId).apply();
            return "";
        }
    }

    private String encrypt(String value) throws Exception {
        SecretKey key = getEncryptionKey();
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.ENCRYPT_MODE, key);
        byte[] encrypted = cipher.doFinal(value.getBytes(StandardCharsets.UTF_8));
        return Base64.encodeToString(cipher.getIV(), Base64.NO_WRAP) + ":"
            + Base64.encodeToString(encrypted, Base64.NO_WRAP);
    }

    private String decrypt(String value) throws Exception {
        String[] parts = value.split(":", 2);
        if (parts.length != 2) throw new IllegalArgumentException("Invalid credential");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, getEncryptionKey(), new GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)));
        return new String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), StandardCharsets.UTF_8);
    }

    private SecretKey getEncryptionKey() throws Exception {
        KeyStore keyStore = KeyStore.getInstance("AndroidKeyStore");
        keyStore.load(null);
        SecretKey existing = (SecretKey) keyStore.getKey(KEY_ALIAS, null);
        if (existing != null) return existing;
        KeyGenerator generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore");
        generator.init(new KeyGenParameterSpec.Builder(
            KEY_ALIAS,
            KeyProperties.PURPOSE_ENCRYPT | KeyProperties.PURPOSE_DECRYPT
        ).setBlockModes(KeyProperties.BLOCK_MODE_GCM)
            .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
            .build());
        return generator.generateKey();
    }

    private JSONArray loadConnections() {
        try {
            return new JSONArray(getPreferences().getString(CONNECTIONS_KEY, "[]"));
        } catch (Exception ignored) {
            return new JSONArray();
        }
    }

    private JSONObject findConnection(String connectionId) {
        JSONArray connections = loadConnections();
        for (int index = 0; index < connections.length(); index++) {
            JSONObject connection = connections.optJSONObject(index);
            if (connection != null && connectionId.equals(connection.optString("id"))) return connection;
        }
        return null;
    }

    private void saveConnection(JSONObject connection) {
        JSONArray existing = loadConnections();
        JSONArray updated = new JSONArray();
        for (int index = 0; index < existing.length(); index++) {
            JSONObject item = existing.optJSONObject(index);
            if (item != null && !connection.optString("id").equals(item.optString("id"))) updated.put(item);
        }
        updated.put(connection);
        getPreferences().edit().putString(CONNECTIONS_KEY, updated.toString()).apply();
    }

    private android.content.SharedPreferences getPreferences() {
        return getContext().getSharedPreferences(PREFS, android.content.Context.MODE_PRIVATE);
    }

    private boolean isSupportedGame(String game) {
        return "genshin".equals(game) || "starrail".equals(game) || "zzz".equals(game);
    }

    private String readStream(InputStream stream) throws Exception {
        if (stream == null) return "";
        StringBuilder body = new StringBuilder();
        try (BufferedReader reader = new BufferedReader(new InputStreamReader(stream, StandardCharsets.UTF_8))) {
            String line;
            while ((line = reader.readLine()) != null) body.append(line);
        }
        return body.toString();
    }

    private String nowIsoUtc() {
        SimpleDateFormat formatter = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss'Z'", Locale.US);
        formatter.setTimeZone(TimeZone.getTimeZone("UTC"));
        return formatter.format(new Date());
    }

    private void resolveError(PluginCall call, String code, String message) {
        JSObject result = new JSObject();
        result.put("ok", false);
        result.put("code", code);
        result.put("message", message);
        call.resolve(result);
    }

    private static final class HoyoException extends Exception {
        final String code;

        HoyoException(String code, String message) {
            super(message);
            this.code = code;
        }
    }
}
