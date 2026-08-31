package expo.modules.smslistener

import android.content.Context

/**
 * Thin wrapper around a plain Android SharedPreferences file — deliberately
 * NOT React Native's AsyncStorage (which lives in a SQLite DB owned by the
 * JS engine and can't be read reliably from a BroadcastReceiver that fires
 * before the app/JS has ever started, e.g. right after a device reboot).
 * This lets BootReceiver read the "boot_flag" setting synchronously with
 * no RN engine running.
 */
object BootPrefs {
  private const val PREFS_NAME = "webazi_prefs"
  private const val KEY_BOOT_RELAUNCH = "boot_flag"

  fun isBootRelaunchEnabled(context: Context): Boolean {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    return prefs.getBoolean(KEY_BOOT_RELAUNCH, false)
  }

  fun setBootRelaunchEnabled(context: Context, enabled: Boolean) {
    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    prefs.edit().putBoolean(KEY_BOOT_RELAUNCH, enabled).apply()
  }
}
