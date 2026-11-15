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
                var conn: HttpURLConnection? = null
                try {
                    val url = URL(urlStr)
                    conn = (url.openConnection() as HttpURLConnection).apply {
                        requestMethod = method.uppercase()
                        connectTimeout = 30000
                        readTimeout = 120000
                        doInput = true
                        instanceFollowRedirects = true
                    }
                    try {
                        val headers = JSONObject(headersJson.ifBlank { "{}" })
                        val keys = headers.keys()
                        while (keys.hasNext()) {
                            val k = keys.next()
                            conn.setRequestProperty(k, headers.getString(k))
                        }
                    } catch (_: Exception) {}
                    if (body != null && method.uppercase() != "GET" && method.uppercase() != "HEAD") {
                        conn.doOutput = true
                        OutputStreamWriter(conn.outputStream, Charsets.UTF_8).use { it.write(body) }
                    }
                    val status = try { conn.responseCode } catch (e: Exception) {
                        deliver(callbackId, e.message ?: "Network error", 0, "", "{}")
                        return@execute
                    }
                    val stream = if (status >= 400) conn.errorStream else conn.inputStream
                    val respBody = if (stream != null) {
                        BufferedReader(InputStreamReader(stream, Charsets.UTF_8)).use { it.readText() }
                    } else ""
                    val respHeaders = JSONObject()
                    conn.headerFields?.forEach { (k, v) ->
                        if (k != null) respHeaders.put(k.lowercase(), v?.joinToString(", ") ?: "")
                    }
                    deliver(callbackId, null, status, respBody, respHeaders.toString())
                } catch (e: Exception) {
                    deliver(callbackId, e.message ?: e.toString(), 0, "", "{}")
                } finally {
                    conn?.disconnect()
                }
            }
        }

        private fun deliver(callbackId: String, err: String?, status: Int, body: String, headersJson: String) {
            val safeId = callbackId.replace("'", "\\'")
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
