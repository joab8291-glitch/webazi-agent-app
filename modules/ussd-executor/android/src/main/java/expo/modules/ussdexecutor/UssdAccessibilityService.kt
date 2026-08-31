package expo.modules.ussdexecutor

import android.accessibilityservice.AccessibilityService
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.accessibility.AccessibilityNodeInfo
import android.view.accessibility.AccessibilityEvent

class UssdAccessibilityService : AccessibilityService() {

  // onAccessibilityEvent() (which calls typeAndSend()/clickSendButton())
  // runs on the main/UI thread. The old code used Thread.sleep() there
  // directly for the inter-step delay, which blocks the main thread for
  // up to 3x keyInputDelayMs per menu step — at the allowed max of
  // 5000ms that's up to ~15s, well past Android's ANR threshold. This
  // Handler posts the follow-up work instead, so the delay no longer
  // blocks the UI thread.
  private val mainHandler = Handler(Looper.getMainLooper())

  companion object {
    private const val TAG = "UssdAccessibility"

    @Volatile
    var pendingInputs: MutableList<String> = mutableListOf()

    @Volatile
    var onResult: ((String) -> Unit)? = null

    /**
     * Delay (ms) used between each step of sending a queued menu input:
     * after ACTION_SET_TEXT before reading the field back to verify it,
     * again before clicking Send, and before clicking Send generally.
     * Configurable from JS (Settings → USSD Settings → Key Input Delay)
     * so a slower device/carrier can be given more breathing room
     * between steps of a multi-step Advanced/Normal dial. Defaults to
     * the value this code used to hardcode (250ms) if the caller never
     * sets it.
     */
    @Volatile
    var keyInputDelayMs: Long = 250L

    @Volatile
    private var waitingForFinalResult = false

    @Volatile
    private var requestActive = false

    fun beginRequest(inputs: List<String>, keyInputDelayMs: Long = 250L) {
      pendingInputs = inputs.toMutableList()
      requestActive = true
      waitingForFinalResult = inputs.isEmpty()
      this.keyInputDelayMs = keyInputDelayMs.coerceIn(1L, 5000L)

      Log.d(
        TAG,
        "USSD request started. pendingInputs=${pendingInputs.size} keyInputDelayMs=${this.keyInputDelayMs}"
      )
    }

    fun cancelRequest() {
      pendingInputs.clear()
      requestActive = false
      waitingForFinalResult = false
      onResult = null

      Log.d(TAG, "USSD request cancelled")
    }

    @Volatile
    private var instance: UssdAccessibilityService? = null

    /**
     * Dismiss whatever dialog is currently on screen (e.g. a lingering
     * USSD dialog from a previous session) before starting a new dial.
     * Uses the standard "back" global action — safe to call even when
     * nothing is showing.
     */
    fun dismissLingeringDialog() {
      cancelRequest()

      try {
        instance?.performGlobalAction(GLOBAL_ACTION_BACK)
      } catch (e: Exception) {
        Log.w(TAG, "dismissLingeringDialog failed: ${e.message}")
      }
    }
  }

  override fun onServiceConnected() {
    super.onServiceConnected()
    instance = this
    Log.d(TAG, "Accessibility service connected")
  }

  override fun onDestroy() {
    super.onDestroy()
    if (instance == this) {
      instance = null
    }
    Log.d(TAG, "Accessibility service destroyed")
  }

  override fun onAccessibilityEvent(event: AccessibilityEvent?) {
    if (event == null) return

    if (!requestActive) {
      return
    }

    Log.d(
      TAG,
      "Event: type=${event.eventType} " +
        "package=${event.packageName} " +
        "class=${event.className}"
    )

    val rootNode = rootInActiveWindow ?: return

    logNodeTree(rootNode, 0)

    val dialogText = extractText(rootNode)

    if (dialogText.isNullOrBlank()) {
      return
    }

    Log.d(TAG, "Extracted USSD text: $dialogText")

    /*
     * IMPORTANT:
     *
     * A USSD session normally starts with a dialog/menu.
     *
     * We must NOT immediately report that dialog as the final result.
     *
     * If there are queued menu inputs, look for an editable field and
     * submit the next input.
     */
    if (pendingInputs.isNotEmpty()) {
      val editField = findEditableNode(rootNode)

      if (editField != null) {
        val nextInput = pendingInputs.removeAt(0)

        Log.d(
          TAG,
          "USSD input field found. Sending queued input: $nextInput"
        )

        typeAndSend(rootNode, editField, nextInput)

        if (pendingInputs.isEmpty()) {
          waitingForFinalResult = true
        }

        return
      }

      /*
       * The dialog has text but no editable field.
       *
       * It may be an intermediate confirmation screen. Do not mark it
       * successful. Wait for the next accessibility event.
       */
      Log.d(
        TAG,
        "Dialog contains text but no editable field yet. Waiting."
      )

      return
    }

    /*
     * No more menu inputs.
     *
     * Now we are waiting for the carrier's final response.
     *
     * Only invoke onResult after we have a meaningful final dialog.
     *
     * IMPORTANT — transient placeholder dialog:
     * Right after ACTION_CALL is placed, Android shows a brief system
     * dialog with placeholder text like "Running USSD code..." before
     * it's replaced by the real carrier response. When there are no
     * menu inputs (e.g. a balance check), waitingForFinalResult is true
     * from the start of the request, so without this check that
     * placeholder — not the real response — would be captured as the
     * "final" result, and the service would stop listening before the
     * actual response (and its OK button) ever appeared.
     */
    if (waitingForFinalResult) {
      if (isTransientPlaceholder(dialogText)) {
        Log.d(
          TAG,
          "Ignoring transient USSD placeholder: $dialogText"
        )
        return
      }

      Log.d(
        TAG,
        "Final USSD response detected: $dialogText"
      )

      waitingForFinalResult = false
      requestActive = false

      val callback = onResult
      onResult = null

      callback?.invoke(dialogText)

      /*
       * Auto-dismiss the final response dialog (tap Send/OK/Continue) so
       * the person doesn't have to tap it themselves. Best-effort: if no
       * clickable button is found, the dialog is simply left on screen
       * for manual dismissal as before.
       */
      clickSendButton(rootNode)
    }
  }

  /**
   * True for the brief system placeholder Android shows immediately
   * after a USSD call is placed (e.g. "Running USSD code..." /
   * "Running the request..."), before the carrier's real response
   * replaces it. Never a legitimate carrier answer — extend this list
   * if other OEM dialers show a different transient message.
   */
  private fun isTransientPlaceholder(text: String): Boolean {
    val lower = text.lowercase()

    return lower.contains("running ussd code") ||
      lower.contains("running the request") ||
      lower.contains("running...") ||
      (lower.contains("running") && lower.contains("ussd"))
  }

  override fun onInterrupt() {
    Log.d(TAG, "Accessibility service interrupted")
  }

  private fun logNodeTree(
    node: AccessibilityNodeInfo,
    depth: Int
  ) {
    /*
     * Prevent an unexpectedly huge accessibility tree from flooding
     * logcat.
     */
    if (depth > 15) return

    val indent = "  ".repeat(depth)

    Log.d(
      TAG,
      "$indent[${node.className}] " +
        "text='${node.text}' " +
        "editable=${node.isEditable} " +
        "clickable=${node.isClickable} " +
        "id=${node.viewIdResourceName}"
    )

    for (i in 0 until node.childCount) {
      try {
        node.getChild(i)?.let {
          logNodeTree(it, depth + 1)
        }
      } catch (_: Exception) {
      }
    }
  }

  private fun extractText(
    node: AccessibilityNodeInfo
  ): String? {
    val builder = StringBuilder()

    collectText(node, builder)

    return builder
      .toString()
      .replace(Regex("\\s+"), " ")
      .trim()
      .ifBlank { null }
  }

  private fun collectText(
    node: AccessibilityNodeInfo,
    builder: StringBuilder
  ) {
    node.text?.let {
      builder.append(it).append(" ")
    }

    for (i in 0 until node.childCount) {
      try {
        node.getChild(i)?.let {
          collectText(it, builder)
        }
      } catch (_: Exception) {
      }
    }
  }

  /**
   * Send a menu/input value into the current USSD dialog.
   *
   * IMPORTANT:
   *
   * ACTION_SET_TEXT replaces the complete contents of the field.
   * Therefore we set the complete input ONCE.
   *
   * The old implementation attempted to send one character at a time
   * using ACTION_SET_TEXT. That does not behave like keyboard typing and
   * can leave only the final character in the field.
   */
  private fun typeAndSend(
    root: AccessibilityNodeInfo,
    editField: AccessibilityNodeInfo,
    input: String
  ) {
    try {
      Log.d(TAG, "=== SETTING USSD INPUT ===")
      Log.d(TAG, "Input='$input'")

      val args = Bundle()

      args.putCharSequence(
        AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE,
        input
      )

      val setResult = editField.performAction(
        AccessibilityNodeInfo.ACTION_SET_TEXT,
        args
      )

      Log.d(
        TAG,
        "ACTION_SET_TEXT result=$setResult"
      )

      // Non-blocking: verify the field content and click Send after two
      // short delays, posted to the main-thread Handler instead of
      // Thread.sleep()-ing the thread this callback already runs on.
      mainHandler.postDelayed({
        val currentText =
          editField.text?.toString() ?: ""

        Log.d(
          TAG,
          "Field after input='$currentText'"
        )

        if (currentText != input) {
          Log.w(
            TAG,
            "USSD input verification mismatch. " +
              "Expected='$input' actual='$currentText'"
          )
        }

        mainHandler.postDelayed({
          clickSendButton(root)
        }, keyInputDelayMs)
      }, keyInputDelayMs)

    } catch (e: Exception) {
      Log.e(
        TAG,
        "Error entering USSD input: ${e.message}",
        e
      )

      /*
       * If an input cannot be entered, do not report success.
       */
    }
  }

  private fun clickSendButton(
    root: AccessibilityNodeInfo
  ) {
    try {
      Log.d(TAG, "Finding USSD send/OK button")

      val sendButton =
        findClickableButton(root)

      if (sendButton == null) {
        Log.w(
          TAG,
          "No clickable USSD send/OK button found"
        )
        return
      }

      // Non-blocking: click after the configured delay instead of
      // Thread.sleep()-ing the main thread.
      mainHandler.postDelayed({
        val clicked =
          sendButton.performAction(
            AccessibilityNodeInfo.ACTION_CLICK
          )

        Log.d(
          TAG,
          "USSD send button clicked=$clicked"
        )
      }, keyInputDelayMs)

    } catch (e: Exception) {
      Log.e(
        TAG,
        "Error clicking USSD send button: ${e.message}",
        e
      )
    }
  }

  private fun findEditableNode(
    node: AccessibilityNodeInfo
  ): AccessibilityNodeInfo? {
    if (node.isEditable) {
      return node
    }

    for (i in 0 until node.childCount) {
      try {
        node.getChild(i)?.let { child ->
          findEditableNode(child)?.let {
            return it
          }
        }
      } catch (_: Exception) {
      }
    }

    return null
  }

  private fun findClickableButton(
    node: AccessibilityNodeInfo
  ): AccessibilityNodeInfo? {

    val className =
      node.className?.toString()?.lowercase() ?: ""

    val text =
      node.text?.toString()?.lowercase() ?: ""

    /*
     * Prefer obvious Send/OK/Continue buttons.
     */
    if (
      node.isClickable &&
      (
        text == "send" ||
        text == "ok" ||
        text == "yes" ||
        text == "continue" ||
        text == "submit" ||
        className.contains("button")
      )
    ) {
      return node
    }

    for (i in 0 until node.childCount) {
      try {
        node.getChild(i)?.let { child ->
          findClickableButton(child)?.let {
            return it
          }
        }
      } catch (_: Exception) {
      }
    }

    return null
  }
}
