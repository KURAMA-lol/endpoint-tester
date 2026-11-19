package com.endpointtester.app

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import org.json.JSONObject
import java.io.BufferedReader
import java.io.File
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private val executor = Executors.newCachedThreadPool()
    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    companion object {
        private const val REQ_FILE = 2001
        private const val DATA_PREFS = "app_data_backup"
        private const val KEY_SNAPSHOT = "snapshot_json"
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        requestNotifPermission()
        HealthCheckReceiver.ensureChannel(this)

        webView = findViewById(R.id.webView)
        webView.setBackgroundColor(Color.parseColor("#0b0b10"))
        webView.isHapticFeedbackEnabled = false
        webView.isFocusable = true
        webView.isFocusableInTouchMode = true
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            webView.defaultFocusHighlightEnabled = false
        }

        val settings = webView.settings
        settings.javaScriptEnabled = true
        settings.domStorageEnabled = true
        settings.databaseEnabled = true
        settings.allowFileAccess = true
        settings.allowContentAccess = true
        settings.mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
        settings.cacheMode = WebSettings.LOAD_DEFAULT
        settings.useWideViewPort = true
        settings.loadWithOverviewMode = true
        settings.builtInZoomControls = false
        settings.displayZoomControls = false
        settings.mediaPlaybackRequiresUserGesture = false
        @Suppress("DEPRECATION")
        settings.allowUniversalAccessFromFileURLs = true
        @Suppress("DEPRECATION")
        settings.allowFileAccessFromFileURLs = true

        webView.addJavascriptInterface(NativeHttpBridge(), "NativeHttp")
        webView.addJavascriptInterface(HealthBridge(), "NativeHealth")
        webView.addJavascriptInterface(DataBridge(), "NativeData")

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView?, request: WebResourceRequest?): Boolean = false
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?
            ): Boolean {
                this@MainActivity.filePathCallback?.onReceiveValue(null)
                this@MainActivity.filePathCallback = filePathCallback
                val intent = fileChooserParams?.createIntent() ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                    type = "*/*"
                    addCategory(Intent.CATEGORY_OPENABLE)
                }
                return try {
                    startActivityForResult(intent, REQ_FILE)
                    true
                } catch (e: Exception) {
                    this@MainActivity.filePathCallback = null
                    false
                }
            }
        }

        webView.loadUrl("file:///android_asset/index.html")
    }

    @Deprecated("Deprecated in Java")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_FILE) {
            val result = if (resultCode == Activity.RESULT_OK && data != null) {
                WebChromeClient.FileChooserParams.parseResult(resultCode, data)
            } else null
            filePathCallback?.onReceiveValue(result)
            filePathCallback = null
        }
    }

    private fun requestNotifPermission() {
        if (Build.VERSION.SDK_INT >= 33) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
            ) {
                ActivityCompat.requestPermissions(this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), 1001)
            }
        }
    }

    inner class DataBridge {
        @JavascriptInterface
        fun saveSnapshot(json: String) {
            getSharedPreferences(DATA_PREFS, MODE_PRIVATE)
                .edit()
                .putString(KEY_SNAPSHOT, json)
                .apply()
            // also mirror to files dir for durability within app lifecycle
            try {
                File(filesDir, "endpoint-backup.json").writeText(json)
            } catch (_: Exception) {}
        }

        @JavascriptInterface
        fun loadSnapshot(): String {
            val prefs = getSharedPreferences(DATA_PREFS, MODE_PRIVATE).getString(KEY_SNAPSHOT, null)
            if (!prefs.isNullOrBlank()) return prefs
            return try {
                val f = File(filesDir, "endpoint-backup.json")
                if (f.exists()) f.readText() else ""
            } catch (_: Exception) { "" }
        }

        @JavascriptInterface
        fun exportToDownloads(json: String): String {
            return try {
                val name = "endpoint-tester-backup.json"
                if (Build.VERSION.SDK_INT >= 29) {
                    val resolver = contentResolver
                    val values = android.content.ContentValues().apply {
                        put(android.provider.MediaStore.Downloads.DISPLAY_NAME, name)
                        put(android.provider.MediaStore.Downloads.MIME_TYPE, "application/json")
                        put(android.provider.MediaStore.Downloads.IS_PENDING, 1)
                    }
                    val uri = resolver.insert(android.provider.MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
                        ?: return "error: cannot create file"
                    resolver.openOutputStream(uri)?.use { it.write(json.toByteArray(Charsets.UTF_8)) }
                    values.clear()
                    values.put(android.provider.MediaStore.Downloads.IS_PENDING, 0)
                    resolver.update(uri, values, null, null)
                    "Downloads/$name"
                } else {
                    val dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS)
                    if (!dir.exists()) dir.mkdirs()
                    val f = File(dir, name)
                    f.writeText(json)
                    f.absolutePath
                }
            } catch (e: Exception) {
                "error: ${e.message}"
            }
        }
    }

    inner class HealthBridge {
        @JavascriptInterface
        fun configure(json: String) {
            try {
                val o = JSONObject(json)
                val prefs = getSharedPreferences(HealthCheckReceiver.PREFS, MODE_PRIVATE)
                val enabled = o.optBoolean("enabled", false)
                val interval = o.optLong("intervalMs", 3_600_000L).coerceAtLeast(15_000L)
                prefs.edit()
                    .putBoolean(HealthCheckReceiver.KEY_ENABLED, enabled)
                    .putBoolean(HealthCheckReceiver.KEY_NOTIFY_OK, o.optBoolean("notifyOk", false))
                    .putBoolean(HealthCheckReceiver.KEY_NOTIFY_DOWN, o.optBoolean("notifyDown", true))
                    .putLong(HealthCheckReceiver.KEY_INTERVAL_MS, interval)
                    .putBoolean(HealthCheckReceiver.KEY_SOUND, o.optBoolean("sound", true))
                    .putBoolean(HealthCheckReceiver.KEY_VIBRATE, o.optBoolean("vibrate", true))
                    .apply()
                if (enabled) HealthCheckReceiver.startNow(this@MainActivity)
                else HealthCheckReceiver.cancel(this@MainActivity)
            } catch (_: Exception) {}
        }

        @JavascriptInterface
        fun syncProviders(json: String) {
            try {
                getSharedPreferences(HealthCheckReceiver.PREFS, MODE_PRIVATE)
                    .edit().putString(HealthCheckReceiver.KEY_PROVIDERS, json).apply()
            } catch (_: Exception) {}
        }

        @JavascriptInterface
        fun runOnce() {
            executor.execute {
                HealthCheckReceiver.runChecks(this@MainActivity)
                HealthCheckReceiver.scheduleNext(this@MainActivity)
            }
        }

        @JavascriptInterface
        fun getStatus(): String {
            val prefs = getSharedPreferences(HealthCheckReceiver.PREFS, MODE_PRIVATE)
            return JSONObject()
                .put("enabled", prefs.getBoolean(HealthCheckReceiver.KEY_ENABLED, false))
                .put("notifyOk", prefs.getBoolean(HealthCheckReceiver.KEY_NOTIFY_OK, false))
                .put("notifyDown", prefs.getBoolean(HealthCheckReceiver.KEY_NOTIFY_DOWN, true))
                .put("intervalMs", prefs.getLong(HealthCheckReceiver.KEY_INTERVAL_MS, 3_600_000L))
                .put("lastRunAt", prefs.getLong("last_run_at", 0L))
                .put("lastStatus", prefs.getString(HealthCheckReceiver.KEY_LAST_STATUS, "{}"))
                .put("lastSkip", prefs.getString("last_skip_reason", ""))
                .toString()
        }
    }

    inner class NativeHttpBridge {
        @JavascriptInterface
        fun request(callbackId: String, method: String, urlStr: String, headersJson: String, body: String?) {
            executor.execute {
                try {
                    var result = executeOnce(method, urlStr, headersJson, body)
                    val gateway = result.status == 502 || result.status == 503 || result.status == 504 ||
                        result.body.contains("empty gateway", ignoreCase = true)
                    if (gateway) {
                        Thread.sleep(800)
                        val second = executeOnce(method, urlStr, headersJson, body)
                        if (second.status in 200..299 || (second.error == null && second.body.length >= result.body.length)) {
                            result = second
                        }
                    }
                    if (result.error != null && result.status == 0) {
                        deliver(callbackId, result.error, 0, "", "{}")
                    } else {
                        deliver(callbackId, null, result.status, result.body, result.headers)
                    }
                } catch (e: Exception) {
                    deliver(callbackId, e.message ?: e.toString(), 0, "", "{}")
                }
            }
        }

        @JavascriptInterface
        fun stream(callbackId: String, urlStr: String, headersJson: String, body: String?) {
            executor.execute {
                var conn: HttpURLConnection? = null
                try {
                    conn = openConn("POST", urlStr, headersJson, body)
                    val status = conn.responseCode
                    if (status >= 400) {
                        val errBody = readAll(conn.errorStream)
                        emitDone(callbackId, status, errBody.ifBlank { "HTTP $status" })
                        return@execute
                    }
                    val reader = BufferedReader(InputStreamReader(conn.inputStream, Charsets.UTF_8))
                    val buf = StringBuilder()
                    var lastFlush = android.os.SystemClock.elapsedRealtime()
                    while (true) {
                        val line = reader.readLine() ?: break
                        val trimmed = line.trim()
                        if (!trimmed.startsWith("data:")) continue
                        val data = trimmed.removePrefix("data:").trim()
                        if (data == "[DONE]") break
                        if (data.isEmpty()) continue
                        try {
                            val obj = JSONObject(data)
                            val choice = obj.optJSONArray("choices")?.optJSONObject(0)
                            val delta = choice?.optJSONObject("delta")
                            val piece = delta?.optString("content", "") ?: ""
                            if (piece.isNotEmpty()) buf.append(piece)
                        } catch (_: Exception) {
                        }
                        val now = android.os.SystemClock.elapsedRealtime()
                        if (buf.length >= 24 || now - lastFlush > 48) {
                            if (buf.isNotEmpty()) {
                                emitDelta(callbackId, buf.toString())
                                buf.setLength(0)
                                lastFlush = now
                            }
                        }
                    }
                    if (buf.isNotEmpty()) emitDelta(callbackId, buf.toString())
                    emitDone(callbackId, status, null)
                } catch (e: Exception) {
                    emitDone(callbackId, 0, e.message ?: e.toString())
                } finally {
                    conn?.disconnect()
                }
            }
        }

        private data class HttpResult(val status: Int, val body: String, val headers: String, val error: String?)

        private fun executeOnce(method: String, urlStr: String, headersJson: String, body: String?): HttpResult {
            var conn: HttpURLConnection? = null
            try {
                conn = openConn(method, urlStr, headersJson, body)
                val status = conn.responseCode
                val stream = if (status >= 400) conn.errorStream else conn.inputStream
                val respBody = readAll(stream)
                val respHeaders = JSONObject()
                conn.headerFields?.forEach { (k, v) ->
                    if (k != null) respHeaders.put(k.lowercase(), v?.joinToString(", ") ?: "")
                }
                return HttpResult(status, respBody, respHeaders.toString(), null)
            } catch (e: Exception) {
                return HttpResult(0, "", "{}", e.message ?: e.toString())
            } finally {
                conn?.disconnect()
            }
        }

        private fun openConn(method: String, urlStr: String, headersJson: String, body: String?): HttpURLConnection {
            val conn = (URL(urlStr).openConnection() as HttpURLConnection)
            conn.requestMethod = method.uppercase()
            conn.connectTimeout = 30000
            conn.readTimeout = 120000
            conn.doInput = true
            conn.instanceFollowRedirects = true
            conn.setRequestProperty("User-Agent", "EndpointTester/2.1 (Android)")
            conn.setRequestProperty("Accept", "application/json, text/event-stream")
            conn.setRequestProperty("Accept-Encoding", "identity")
            conn.setRequestProperty("Connection", "close")
            try {
                val headers = JSONObject(if (headersJson.isBlank()) "{}" else headersJson)
                val keys = headers.keys()
                while (keys.hasNext()) {
                    val k = keys.next()
                    conn.setRequestProperty(k, headers.getString(k))
                }
            } catch (_: Exception) {
            }
            if (body != null && method.uppercase() != "GET" && method.uppercase() != "HEAD") {
                val bytes = body.toByteArray(Charsets.UTF_8)
                conn.doOutput = true
                conn.setFixedLengthStreamingMode(bytes.size)
                conn.outputStream.use { it.write(bytes) }
            }
            return conn
        }

        private fun readAll(stream: java.io.InputStream?): String {
            if (stream == null) return ""
            return BufferedReader(InputStreamReader(stream, Charsets.UTF_8)).use { it.readText() }
        }

        private fun emitDelta(callbackId: String, text: String) {
            val id = JSONObject.quote(callbackId)
            val t = JSONObject.quote(text)
            val script = "(function(){try{var h=window.__streamHandlers&&window.__streamHandlers[" + id + "];if(h&&h.delta)h.delta(" + t + ");}catch(e){}})();"
            webView.post { webView.evaluateJavascript(script, null) }
        }

        private fun emitDone(callbackId: String, status: Int, err: String?) {
            val id = JSONObject.quote(callbackId)
            val e = if (err == null) "null" else JSONObject.quote(err)
            val script = "(function(){try{var h=window.__streamHandlers&&window.__streamHandlers[" + id + "];if(h&&h.done)h.done(" + status + "," + e + ");}catch(ex){}})();"
            webView.post { webView.evaluateJavascript(script, null) }
        }

        private fun deliver(callbackId: String, err: String?, status: Int, body: String, headersJson: String) {
            val safeId = callbackId.replace("'", "\'")
            val errJs = if (err == null) "null" else JSONObject.quote(err)
            val bodyJs = JSONObject.quote(body)
            val headersJs = JSONObject.quote(headersJson)
            val script = """
                (function(){
                  try {
                    var cb = window.__nativeHttpCallbacks && window.__nativeHttpCallbacks['$safeId'];
                    if (cb) cb($errJs, $status, $bodyJs, $headersJs);
                  } catch (e) { console.error(e); }
                })();
            """.trimIndent()
            webView.post { webView.evaluateJavascript(script, null) }
        }
    }

    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        if (::webView.isInitialized && webView.canGoBack()) webView.goBack()
        else {
            @Suppress("DEPRECATION")
            super.onBackPressed()
        }
    }
}
