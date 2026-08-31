package expo.modules.smslistener

import android.app.AlarmManager
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder

/**
 * A minimal foreground service whose only job is to hold the process alive
 * with a low-priority notification while SmsListenerModule's BroadcastReceiver
 * is registered. Without this, Android can (and eventually will) kill the
 * app in the background and silently drop incoming payment SMS.
 *
 * Started from SmsListenerModule.startForegroundService() alongside
 * startListening(), and stopped from stopForegroundService() alongside
 * stopListening().
 *
 * Self-healing heartbeat: every time this service (re)starts, it schedules
 * a single AlarmManager alarm ~5 minutes out (see scheduleHeartbeat()).
 * When that alarm fires, HeartbeatReceiver calls startForegroundService()
 * again — which re-enters onStartCommand() and both (a) is a harmless
 * no-op if the service is still alive, since it just re-arms the next
 * heartbeat, and (b) resurrects the service if Android had killed it,
 * closing the loop.
 */
class SmsForegroundService : Service() {

  companion object {
    private const val CHANNEL_ID = "webazi_sms_listener"
    private const val NOTIFICATION_ID = 4271
    private const val HEARTBEAT_INTERVAL_MS = 5 * 60 * 1000L
    private const val HEARTBEAT_REQUEST_CODE = 4273
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    startForeground(NOTIFICATION_ID, buildNotification())
    scheduleHeartbeat()
    return START_STICKY
  }

  private fun heartbeatPendingIntent(): PendingIntent {
    val intent = Intent(this, HeartbeatReceiver::class.java)
    return PendingIntent.getBroadcast(
      this,
      HEARTBEAT_REQUEST_CODE,
      intent,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )
  }

  private fun scheduleHeartbeat() {
    val alarmManager = getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
    val pendingIntent = heartbeatPendingIntent()
    val triggerAt = System.currentTimeMillis() + HEARTBEAT_INTERVAL_MS

    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
        // Fires close to on-time even in Doze — this is the "re-fires and
        // restarts the foreground service" heartbeat.
        alarmManager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent)
      } else {
        alarmManager.set(AlarmManager.RTC_WAKEUP, triggerAt, pendingIntent)
      }
    } catch (e: SecurityException) {
      // Exact alarms not permitted on this OEM/Android version — fall back
      // to an inexact repeating alarm, which needs no special permission.
      alarmManager.setInexactRepeating(
        AlarmManager.RTC_WAKEUP,
        triggerAt,
        HEARTBEAT_INTERVAL_MS,
        pendingIntent
      )
    }
  }

  private fun cancelHeartbeat() {
    val alarmManager = getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
    alarmManager.cancel(heartbeatPendingIntent())
  }

  private fun buildNotification(): Notification {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val manager = getSystemService(NotificationManager::class.java)
      val existing = manager?.getNotificationChannel(CHANNEL_ID)

      if (existing == null) {
        val channel = NotificationChannel(
          CHANNEL_ID,
          "SMS Listener",
          NotificationManager.IMPORTANCE_MIN
        ).apply {
          description = "Keeps the M-Pesa SMS listener active in the background"
          setShowBadge(false)
        }

        manager?.createNotificationChannel(channel)
      }
    }

    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      @Suppress("DEPRECATION")
      Notification.Builder(this)
    }

    return builder
      .setContentTitle("Webazi")
      .setContentText("Listening for incoming messages")
      .setSmallIcon(android.R.drawable.stat_notify_sync)
      .setOngoing(true)
      .setPriority(Notification.PRIORITY_MIN)
      .build()
  }

  override fun onDestroy() {
    cancelHeartbeat()
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
    super.onDestroy()
  }

  /**
   * Called when the user swipes the app away from Recents. Without this,
   * Android is free to tear down the whole process — including the
   * BroadcastReceiver this service exists to keep alive — the moment the
   * task is removed, regardless of the foreground notification. Restarting
   * the service here brings the process back so a payment SMS that arrives
   * right after isn't silently dropped.
   *
   * This is a real improvement, not a guarantee: some OEMs (Xiaomi/MIUI,
   * Oppo, Vivo, Huawei) still kill background processes at the system
   * level regardless of foreground services, and typically need the user
   * to manually whitelist the app ("autostart" / disable battery
   * optimization) in their own settings — see the battery-exemption
   * functions in SmsListenerModule.kt and the "Background reliability"
   * section in Settings.
   */
  override fun onTaskRemoved(rootIntent: Intent?) {
    val restartIntent = Intent(applicationContext, SmsForegroundService::class.java)

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      applicationContext.startForegroundService(restartIntent)
    } else {
      applicationContext.startService(restartIntent)
    }

    super.onTaskRemoved(rootIntent)
  }
}
