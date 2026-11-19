package dev.hadith.app

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.view.WindowManager
import android.webkit.JavascriptInterface
import android.webkit.WebView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

/**
 * JavaScript interface exposed to hadith.dev pages as `window.hadithAndroid`.
 * Every mutating action validates that the WebView is currently on an internal hadith.dev origin.
 */
class HadithJsBridge(
    private val activity: AppCompatActivity,
    private val webView: WebView,
    private val onThemeChange: (Boolean) -> Unit,
) {
    @JavascriptInterface
    fun isAndroid(): Boolean = true

    @JavascriptInterface
    fun getVersionName(): String = BuildConfig.VERSION_NAME

    @JavascriptInterface
    fun getVersionCode(): Int = BuildConfig.VERSION_CODE

    @JavascriptInterface
    fun share(title: String?, text: String?, url: String?) {
        runIfInternal {
            val safeUrl = url?.trim()?.takeIf {
                it.startsWith("https://") || it.startsWith("http://")
            } ?: webView.url ?: HadithUrls.BASE_URL
            val shareBody = buildString {
                if (!text.isNullOrBlank()) {
                    append(text.trim())
                    append('\n')
                }
                append(safeUrl)
            }
            val intent = Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                if (!title.isNullOrBlank()) {
                    putExtra(Intent.EXTRA_SUBJECT, title.trim())
                }
                putExtra(Intent.EXTRA_TEXT, shareBody)
            }
            activity.startActivity(
                Intent.createChooser(intent, activity.getString(R.string.more_share))
            )
        }
    }

    @JavascriptInterface
    fun copyText(text: String?) {
        val value = text ?: return
        runIfInternal {
            val clipboard = activity.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            clipboard.setPrimaryClip(ClipData.newPlainText(activity.getString(R.string.app_name), value))
            Toast.makeText(activity, R.string.toast_copied, Toast.LENGTH_SHORT).show()
        }
    }

    @JavascriptInterface
    fun setKeepScreenOn(enabled: Boolean) {
        runIfInternal {
            webView.keepScreenOn = enabled
            if (enabled) {
                activity.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            } else {
                activity.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            }
        }
    }

    @JavascriptInterface
    fun onThemeChanged(isDark: Boolean) {
        runIfInternal {
            onThemeChange(isDark)
        }
    }

    private inline fun runIfInternal(crossinline block: () -> Unit) {
        webView.post {
            if (HadithUrls.isInternalSiteUrl(webView.url)) {
                block()
            }
        }
    }
}
