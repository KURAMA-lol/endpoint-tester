package com.endpointtester.app

import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.SystemClock
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors

class HealthCheckReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent?) {
        val action = intent?.action ?: return
        when (action) {
            ACTION_CHECK, Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED -> {
                val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                if (!prefs.getBoolean(KEY_ENABLED, false)) return
                // Go async — BroadcastReceiver must return quickly
                val pending = goAsync()
                EXECUTOR.execute {
                    try {
                        runChecks(context)
                    } finally {
                        scheduleNext(context)
                        pending.finish()
                    }
                }
            }
        }
    }

    companion object {
        const val PREFS = "health_monitor"
        const val KEY_ENABLED = "enabled"
        const val KEY_NOTIFY_OK = "notify_ok"
        const val KEY_NOTIFY_DOWN = "notify_down"
        const val KEY_INTERVAL_MS = "interval_ms"
        const val KEY_PROVIDERS = "providers_json"
        const val KEY_LAST_STATUS = "last_status_json"
        const val ACTION_CHECK = "com.endpointtester.app.ACTION_HEALTH_CHECK"
        const val CHANNEL_ID = "health_checks"
        private val EXECUTOR = Executors.newSingleThreadExecutor()

        fun ensureChannel(context: Context) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val nm = context.getSystemService(NotificationManager::class.java)
                val ch = NotificationChannel(
                    CHANNEL_ID,
                    "Endpoint health",
                    NotificationManager.IMPORTANCE_DEFAULT
                ).apply {
                    description = "Alive / downtime alerts for saved providers"
                }
                nm?.createNotificationChannel(ch)
            }
        }

        fun scheduleNext(context: Context) {
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            if (!prefs.getBoolean(KEY_ENABLED, false)) {
                cancel(context)
                return
            }
            val interval = prefs.getLong(KEY_INTERVAL_MS, 3_600_000L).coerceAtLeast(15_000L)
            val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            val pi = pendingIntent(context)
            val trigger = SystemClock.elapsedRealtime() + interval
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, trigger, pi)
                } else {
                    @Suppress("DEPRECATION")
                    am.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, trigger, pi)
                }
            } catch (_: Exception) {
                am.set(AlarmManager.ELAPSED_REALTIME_WAKEUP, trigger, pi)
            }
        }

        fun cancel(context: Context) {
            val am = context.getSystemService(Context.ALARM_SERVICE) as AlarmManager
            am.cancel(pendingIntent(context))
        }

        fun startNow(context: Context) {
            ensureChannel(context)
            scheduleNext(context)
            // immediate check
            context.sendBroadcast(Intent(context, HealthCheckReceiver::class.java).setAction(ACTION_CHECK))
        }

        private fun pendingIntent(context: Context): PendingIntent {
            val i = Intent(context, HealthCheckReceiver::class.java).setAction(ACTION_CHECK)
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or
                (if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0)
            return PendingIntent.getBroadcast(context, 42, i, flags)
        }

        fun runChecks(context: Context) {
            ensureChannel(context)
            val prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            val notifyOk = prefs.getBoolean(KEY_NOTIFY_OK, false)
            val notifyDown = prefs.getBoolean(KEY_NOTIFY_DOWN, true)
            val raw = prefs.getString(KEY_PROVIDERS, "[]") ?: "[]"
            val arr = try { JSONArray(raw) } catch (_: Exception) { JSONArray() }
            if (arr.length() == 0) return

            val last = try {
                JSONObject(prefs.getString(KEY_LAST_STATUS, "{}") ?: "{}")
            } catch (_: Exception) { JSONObject() }

            val nowStatus = JSONObject()
            for (i in 0 until arr.length()) {
                val p = arr.optJSONObject(i) ?: continue
                val id = p.optString("id", "p$i")
                val name = p.optString("name", "Provider")
                val result = pingProvider(p)
                nowStatus.put(id, result.ok)
                val wasOk = if (last.has(id)) last.optBoolean(id) else true

                if (result.ok && notifyOk) {
                    notify(context, 1000 + i, "$name is up", result.detail, false)
                } else if (!result.ok && notifyDown) {
                    notify(context, 2000 + i, "$name is down", result.detail, true)
                } else if (!result.ok && !wasOk && notifyDown) {
                    // still down — already covered by notifyDown every time above
                }
            }
            prefs.edit().putString(KEY_LAST_STATUS, nowStatus.toString())
                .putLong("last_run_at", System.currentTimeMillis()).apply()
        }

        data class Ping(val ok: Boolean, val detail: String)

        fun pingProvider(p: JSONObject): Ping {
            val type = p.optString("type", "openai")
            val base = p.optString("baseUrl", "").trim().trimEnd('/')
            val key = p.optString("apiKey", "")
            if (base.isEmpty()) return Ping(false, "No base URL")
            return try {
                val urlStr = when (type) {
                    "gemini" -> {
                        if (key.isEmpty()) return Ping(false, "Missing API key")
                        "$base/models?key=${java.net.URLEncoder.encode(key, "UTF-8")}&pageSize=1"
                    }
                    else -> "$base/models"
                }
                val url = URL(urlStr)
                val conn = (url.openConnection() as HttpURLConnection).apply {
                    requestMethod = "GET"
                    connectTimeout = 15_000
                    readTimeout = 20_000
                    instanceFollowRedirects = true
                    if (type != "gemini" && key.isNotEmpty()) {
                        setRequestProperty("Authorization", "Bearer $key")
                    }
                    setRequestProperty("Accept", "application/json")
                }
                val code = try { conn.responseCode } catch (e: Exception) {
                    return Ping(false, e.message ?: "Network error")
                }
                val stream = if (code >= 400) conn.errorStream else conn.inputStream
                val body = stream?.let {
                    BufferedReader(InputStreamReader(it, Charsets.UTF_8)).use { r -> r.readText() }
                }?.take(200) ?: ""
                conn.disconnect()
                if (code in 200..299) Ping(true, "HTTP $code · healthy")
                else Ping(false, "HTTP $code ${body.take(80)}")
            } catch (e: Exception) {
                Ping(false, e.message ?: "Error")
            }
        }

        fun notify(context: Context, id: Int, title: String, body: String, isError: Boolean) {
            ensureChannel(context)
            val open = Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP
            }
            val flags = PendingIntent.FLAG_UPDATE_CURRENT or
                (if (Build.VERSION.SDK_INT >= 23) PendingIntent.FLAG_IMMUTABLE else 0)
            val pi = PendingIntent.getActivity(context, id, open, flags)
            val notif = NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(if (isError) NotificationCompat.PRIORITY_HIGH else NotificationCompat.PRIORITY_DEFAULT)
                .setAutoCancel(true)
                .setContentIntent(pi)
                .build()
            try {
                NotificationManagerCompat.from(context).notify(id, notif)
            } catch (_: SecurityException) {
                // missing POST_NOTIFICATIONS on Android 13+
            }
        }
    }
}
