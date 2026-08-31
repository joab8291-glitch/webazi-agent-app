package expo.modules.smslistener

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.database.Cursor
import android.os.Build
import android.provider.Telephony
import android.telephony.SmsMessage
import android.telephony.SubscriptionManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SmsListenerModule : Module() {

  private var receiver: BroadcastReceiver? = null

  override fun definition() = ModuleDefinition {
    Name("SmsListener")

    Events("onSmsReceived")

    // Starts listening for incoming SMS on the till line
    Function("startListening") {
      val context = appContext.reactContext

      if (receiver == null && context != null) {
        receiver = object : BroadcastReceiver() {
          override fun onReceive(ctx: Context, intent: Intent) {
            if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return

            val bundle = intent.extras ?: return
            val pdus = bundle.get("pdus") as? Array<*> ?: return
            val format = bundle.getString("format")
            val subId = bundle.getInt("subscription", -1)

            val fullBody = StringBuilder()
            var sender = ""

            for (pdu in pdus) {
              val sms = if (format != null) {
                SmsMessage.createFromPdu(pdu as ByteArray, format)
              } else {
                @Suppress("DEPRECATION")
                SmsMessage.createFromPdu(pdu as ByteArray)
              }
              sender = sms.originatingAddress ?: ""
              fullBody.append(sms.messageBody)
            }

            sendEvent(
              "onSmsReceived",
              mapOf(
                "sender" to sender,
                "body" to fullBody.toString(),
                "subscriptionId" to subId,
                "timestamp" to System.currentTimeMillis()
              )
            )
          }
        }

        val filter = IntentFilter(Telephony.Sms.Intents.SMS_RECEIVED_ACTION)
        context.registerReceiver(receiver, filter)
      }
    }

    // Stops listening
    Function("stopListening") {
      val context = appContext.reactContext
      if (receiver != null && context != null) {
        context.unregisterReceiver(receiver)
        receiver = null
      }
    }

    // Starts the foreground service that keeps this module's BroadcastReceiver
    // alive in the background. Safe to call even if already running.
    Function("startForegroundService") {
      val context = appContext.reactContext ?: return@Function null

      val intent = Intent(context, SmsForegroundService::class.java)

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    // Stops the foreground service.
    Function("stopForegroundService") {
      val context = appContext.reactContext ?: return@Function null
      context.stopService(Intent(context, SmsForegroundService::class.java))
    }

    // Whether the app is currently exempt from Android's battery
    // optimizations (Doze/App Standby). Even with the foreground service
    // and onTaskRemoved() restart in place, several OEMs still throttle or
    // kill background processes unless this exemption is granted.
    Function("isIgnoringBatteryOptimizations") {
      val context = appContext.reactContext ?: return@Function false
      val powerManager =
        context.getSystemService(Context.POWER_SERVICE) as? android.os.PowerManager
      powerManager?.isIgnoringBatteryOptimizations(context.packageName) ?: false
    }

    // Opens the system dialog asking the user to exempt this app from
    // battery optimizations. Requires the REQUEST_IGNORE_BATTERY_OPTIMIZATIONS
    // permission (declared in AndroidManifest.xml) — Google Play policy
    // restricts this to apps with a genuine background-service need, which
    // applies here (the SMS listener has to keep running to catch payments).
    Function("requestIgnoreBatteryOptimizations") {
      val context = appContext.reactContext ?: return@Function null

      val intent = Intent(android.provider.Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
        data = android.net.Uri.parse("package:${context.packageName}")
        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      }

      context.startActivity(intent)
    }

    // Scans the device's actual SMS inbox for messages received on the given
    // subscription since `sinceMillis`, for the "missed messages while the
    // app/process was killed" recovery path. Requires READ_SMS (already
    // requested for live listening).
    Function("queryInboxSince") { sinceMillis: Double, subscriptionId: Int ->
      val context = appContext.reactContext ?: return@Function emptyList<Map<String, Any?>>()
      val result = mutableListOf<Map<String, Any?>>()

      val projection = arrayOf(
        Telephony.Sms._ID,
        Telephony.Sms.ADDRESS,
        Telephony.Sms.BODY,
        Telephony.Sms.DATE,
        Telephony.Sms.SUBSCRIPTION_ID
      )

      var cursor: Cursor? = null

      try {
        cursor = context.contentResolver.query(
          Telephony.Sms.Inbox.CONTENT_URI,
          projection,
          "${Telephony.Sms.DATE} >= ?",
          arrayOf(sinceMillis.toLong().toString()),
          "${Telephony.Sms.DATE} ASC"
        )

        cursor?.let { c ->
          val idCol = c.getColumnIndex(Telephony.Sms._ID)
          val addressCol = c.getColumnIndex(Telephony.Sms.ADDRESS)
          val bodyCol = c.getColumnIndex(Telephony.Sms.BODY)
          val dateCol = c.getColumnIndex(Telephony.Sms.DATE)
          val subCol = c.getColumnIndex(Telephony.Sms.SUBSCRIPTION_ID)

          while (c.moveToNext()) {
            // SUBSCRIPTION_ID isn't reliably populated on every OEM/Android
            // version for the inbox table. When it's missing (-1) we can't
            // safely attribute the message to a SIM, so we include it and
            // let the caller's own Till-SIM re-check decide — better to
            // surface a possible match than silently drop it.
            val rowSubId = if (subCol >= 0) c.getInt(subCol) else -1

            if (rowSubId != -1 && rowSubId != subscriptionId) {
              continue
            }

            result.add(
              mapOf(
                "id" to (if (idCol >= 0) c.getLong(idCol).toString() else ""),
                "sender" to (if (addressCol >= 0) c.getString(addressCol) else ""),
                "body" to (if (bodyCol >= 0) c.getString(bodyCol) else ""),
                "timestamp" to (if (dateCol >= 0) c.getLong(dateCol) else 0L),
                "subscriptionId" to (if (rowSubId != -1) rowSubId else subscriptionId)
              )
            )
          }
        }
      } catch (e: SecurityException) {
        // READ_SMS not granted yet — return whatever was collected (empty).
      } finally {
        cursor?.close()
      }

      result
    }

    // Sends an SMS from the given SIM (subscriptionId), used for the
    // Engage-on-trigger-text feature (guiding an already-recommended or
    // stuck customer) — see services/smsSender.ts. Requires SEND_SMS
    // (declared in this module's AndroidManifest.xml) to already be
    // granted; the JS side is responsible for requesting it first.
    // Long messages are auto-split into multiple parts.
    Function("sendSms") { phoneNumber: String, message: String, subscriptionId: Int ->
      val context = appContext.reactContext ?: return@Function false

      try {
        val smsManager: android.telephony.SmsManager =
          if (subscriptionId > 0 && Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP_MR1) {
            android.telephony.SmsManager.getSmsManagerForSubscriptionId(subscriptionId)
          } else {
            @Suppress("DEPRECATION")
            android.telephony.SmsManager.getDefault()
          }

        val parts = smsManager.divideMessage(message)

        if (parts.size <= 1) {
          smsManager.sendTextMessage(phoneNumber, null, message, null, null)
        } else {
          smsManager.sendMultipartTextMessage(phoneNumber, null, parts, null, null)
        }

        true
      } catch (e: Exception) {
        false
      }
    }

    // Whether BootReceiver should also relaunch the whole app (not just the
    // foreground service) ~5 seconds after a device reboot. Backed by plain
    // Android SharedPreferences (see BootPrefs.kt) rather than AsyncStorage,
    // since BootReceiver has to read this before any JS/RN engine exists.
    Function("setBootRelaunchEnabled") { enabled: Boolean ->
      val context = appContext.reactContext ?: return@Function
      BootPrefs.setBootRelaunchEnabled(context, enabled)
    }

    Function("isBootRelaunchEnabled") {
      val context = appContext.reactContext ?: return@Function false
      BootPrefs.isBootRelaunchEnabled(context)
    }

    // Returns info about available SIM slots, so the admin can pick which one is the Till line
    Function("getSimSlots") {
      val context = appContext.reactContext
      val result = mutableListOf<Map<String, Any?>>()

      if (context != null) {
        val subManager = context.getSystemService(Context.TELEPHONY_SUBSCRIPTION_SERVICE) as SubscriptionManager

        try {
          val subscriptions = subManager.activeSubscriptionInfoList
          subscriptions?.forEach { info ->
            result.add(
              mapOf(
                "subscriptionId" to info.subscriptionId,
                "slotIndex" to info.simSlotIndex,
                "carrierName" to info.carrierName?.toString(),
                "displayName" to info.displayName?.toString(),
                "number" to info.number
              )
            )
          }
        } catch (e: SecurityException) {
          // Permission not granted yet — return empty, JS side should prompt for permission
        }
      }

      result
    }
  }
}
