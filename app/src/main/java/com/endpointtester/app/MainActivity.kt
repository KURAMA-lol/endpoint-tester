package com.endpointtester.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.webkit.JavascriptInterface
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
import java.io.InputStreamReader
import java.io.OutputStreamWriter
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private val executor = Executors.newCachedThreadPool()

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

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(
                view: WebView?,
                request: WebResourceRequest?
            ): Boolean = false
        }
        webView.webChromeClient = WebChromeClient()

        webView.loadUrl("file:///android_asset/index.html")
    }

    private fun requestNotifPermission() {
        if (Build.VERSION.SDK_INT >= 33) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
            ) {
                ActivityCompat.requestPermissions(
                    this,
                    arrayOf(Manifest.permission.POST_NOTIFICATIONS),
                    1001
                )
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
                    .apply()
                if (enabled) {
                    HealthCheckReceiver.startNow(this@MainActivity)
                } else {
                    HealthCheckReceiver.cancel(this@MainActivity)
                }
            } catch (_: Exception) {}
        }

        @JavascriptInterface
        fun syncProviders(json: String) {
            try {
                getSharedPreferences(HealthCheckReceiver.PREFS, MODE_PRIVATE)
                    .edit()
                    .putString(HealthCheckReceiver.KEY_PROVIDERS, json)
                    .apply()
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
            val js = """
                (function(){
                  try {
                    var cb = window.__nativeHttpCallbacks && window.__nativeHttpCallbacks['$safeId'];
                    if (cb) cb($errJs, $status, $bodyJs, $headersJs);
                  } catch (e) { console.error(e); }
                })();
            """.trimIndent()
            webView.post { webView.evaluateJavascript(js, null) }
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
