package dev.hadith.app

import android.annotation.SuppressLint
import android.app.Activity
import android.app.DownloadManager
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.Intent
import android.content.res.ColorStateList
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.os.Handler
import android.os.Looper
import android.os.Message
import android.view.View
import android.webkit.CookieManager
import android.webkit.ServiceWorkerController
import android.webkit.URLUtil
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.browser.customtabs.CustomTabColorSchemeParams
import androidx.browser.customtabs.CustomTabsIntent
import androidx.core.content.ContextCompat
import androidx.core.net.toUri
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.core.view.isVisible
import androidx.core.view.updatePadding
import com.google.android.material.bottomsheet.BottomSheetDialog
import dev.hadith.app.databinding.ActivityMainBinding
import dev.hadith.app.databinding.BottomSheetMoreBinding

/**
 * Primary host activity wrapping https://hadith.dev inside a configured Android WebView
 * with native Material 3 bottom navigation, pull-to-refresh, offline retry state,
 * fullscreen video playback, file upload support, and deep link handling.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private lateinit var insetsController: WindowInsetsControllerCompat
    private lateinit var connectivityManager: ConnectivityManager

    private var firstPageReady = false
    private var hasMainFrameError = false
    private var failedUrl: String = HadithUrls.BASE_URL
    private var isDarkTheme = false
    private var isUpdatingNavSelection = false
    private var isImeVisible = false

    private var customView: View? = null
    private var customViewCallback: WebChromeClient.CustomViewCallback? = null
    private var filePathCallback: ValueCallback<Array<Uri>>? = null

    private val mainHandler = Handler(Looper.getMainLooper())

    private val fileChooserLauncher = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        val callback = filePathCallback ?: return@registerForActivityResult
        filePathCallback = null
        val uris = WebChromeClient.FileChooserParams.parseResult(result.resultCode, result.data)
            ?: extractClipDataUris(result.resultCode, result.data)
        callback.onReceiveValue(uris)
    }

    private val networkCallback = object : ConnectivityManager.NetworkCallback() {
        override fun onAvailable(network: Network) {
            mainHandler.post {
                if (binding.errorOverlay.isVisible) {
                    reloadAfterError()
                }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        val splashScreen = installSplashScreen()
        splashScreen.setKeepOnScreenCondition { !firstPageReady }
        mainHandler.postDelayed({ firstPageReady = true }, SPLASH_MAX_WAIT_MS)

        enableEdgeToEdge()
        super.onCreate(savedInstanceState)

        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        insetsController = WindowInsetsControllerCompat(window, window.decorView).apply {
            isAppearanceLightStatusBars = false
        }
        connectivityManager = getSystemService(ConnectivityManager::class.java)

        setupWindowInsets()
        setupWebView()
        setupSwipeRefresh()
        setupBottomNavigation()
        setupErrorOverlay()
        setupBackNavigation()
        applyTheme(isDark = false)

        if (savedInstanceState != null) {
            val restored = binding.webView.restoreState(savedInstanceState)
            if (restored == null) {
                binding.webView.loadUrl(resolveStartUrl(intent))
            }
        } else {
            binding.webView.loadUrl(resolveStartUrl(intent))
        }
    }

    override fun onStart() {
        super.onStart()
        runCatching { connectivityManager.registerDefaultNetworkCallback(networkCallback) }
    }

    override fun onStop() {
        runCatching { connectivityManager.unregisterNetworkCallback(networkCallback) }
        super.onStop()
    }

    override fun onPause() {
        CookieManager.getInstance().flush()
        binding.webView.onPause()
        super.onPause()
    }

    override fun onResume() {
        super.onResume()
        binding.webView.onResume()
    }

    override fun onDestroy() {
        mainHandler.removeCallbacksAndMessages(null)
        filePathCallback?.onReceiveValue(null)
        filePathCallback = null
        binding.webView.stopLoading()
        binding.webView.destroy()
        super.onDestroy()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        val url = resolveStartUrl(intent)
        if (HadithUrls.isInternalSiteUrl(url)) {
            loadSiteUrl(url)
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        binding.webView.saveState(outState)
    }

    private fun setupWindowInsets() {
        ViewCompat.setOnApplyWindowInsetsListener(binding.rootContainer) { root, insets ->
            val sysBars = insets.getInsets(
                WindowInsetsCompat.Type.statusBars() or WindowInsetsCompat.Type.displayCutout()
            )
            val navBars = insets.getInsets(WindowInsetsCompat.Type.navigationBars())
            val ime = insets.getInsets(WindowInsetsCompat.Type.ime())
            isImeVisible = insets.isVisible(WindowInsetsCompat.Type.ime()) && ime.bottom > 0

            val leftInset = maxOf(sysBars.left, navBars.left)
            val rightInset = maxOf(sysBars.right, navBars.right)

            if (customView != null) {
                root.updatePadding(left = 0, top = 0, right = 0, bottom = 0)
            } else if (isImeVisible) {
                binding.bottomNav.visibility = View.GONE
                binding.bottomNavDivider.visibility = View.GONE
                root.updatePadding(
                    left = leftInset,
                    top = sysBars.top,
                    right = rightInset,
                    bottom = ime.bottom,
                )
            } else {
                binding.bottomNav.visibility = View.VISIBLE
                binding.bottomNavDivider.visibility = View.VISIBLE
                root.updatePadding(
                    left = leftInset,
                    top = sysBars.top,
                    right = rightInset,
                    bottom = 0,
                )
                binding.bottomNav.updatePadding(bottom = navBars.bottom)
            }
            WindowInsetsCompat.CONSUMED
        }
    }

    @SuppressLint("SetJavaScriptEnabled")
    private fun setupWebView() {
        if (BuildConfig.DEBUG) {
            WebView.setWebContentsDebuggingEnabled(true)
        }

        val webView = binding.webView
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            @Suppress("DEPRECATION")
            databaseEnabled = true
            useWideViewPort = true
            loadWithOverviewMode = true
            builtInZoomControls = true
            displayZoomControls = false
            cacheMode = WebSettings.LOAD_DEFAULT
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            allowFileAccess = false
            allowContentAccess = true
            setSupportMultipleWindows(true)
            javaScriptCanOpenWindowsAutomatically = true
            mediaPlaybackRequiresUserGesture = false
            userAgentString = "$userAgentString HadithAndroid/${BuildConfig.VERSION_NAME}"
        }

        CookieManager.getInstance().apply {
            setAcceptCookie(true)
            setAcceptThirdPartyCookies(webView, true)
        }

        ServiceWorkerController.getInstance().serviceWorkerWebSettings.apply {
            allowContentAccess = true
            allowFileAccess = false
            cacheMode = WebSettings.LOAD_DEFAULT
            blockNetworkLoads = false
        }

        webView.addJavascriptInterface(
            HadithJsBridge(this, webView) { isDark -> applyTheme(isDark) },
            JS_BRIDGE_NAME,
        )

        webView.webViewClient = object : WebViewClient() {
            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url?.toString() ?: return false
                if (!request.isForMainFrame) return false
                if (HadithUrls.isInternalSiteUrl(url)) return false
                if (HadithUrls.isDownloadUrl(url)) {
                    enqueueDownload(url, view.settings.userAgentString, null, null)
                    return true
                }
                openExternalUrl(url)
                return true
            }

            override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
                super.onPageStarted(view, url, favicon)
                hasMainFrameError = false
                if (!url.isNullOrBlank()) {
                    failedUrl = url
                }
            }

            override fun onPageCommitVisible(view: WebView, url: String?) {
                super.onPageCommitVisible(view, url)
                firstPageReady = true
                if (!hasMainFrameError) {
                    binding.errorOverlay.visibility = View.GONE
                }
            }

            override fun doUpdateVisitedHistory(view: WebView, url: String?, isReload: Boolean) {
                super.doUpdateVisitedHistory(view, url, isReload)
                syncNavAndSwipeState(url)
            }

            override fun onPageFinished(view: WebView, url: String?) {
                super.onPageFinished(view, url)
                firstPageReady = true
                binding.swipeRefresh.isRefreshing = false
                syncNavAndSwipeState(url)
                if (HadithUrls.isInternalSiteUrl(url)) {
                    injectThemeObserver()
                }
            }

            override fun onReceivedError(
                view: WebView,
                request: WebResourceRequest,
                error: WebResourceError,
            ) {
                super.onReceivedError(view, request, error)
                if (!request.isForMainFrame) return
                val code = error.errorCode
                val isNetworkFailure =
                    code == ERROR_HOST_LOOKUP ||
                        code == ERROR_CONNECT ||
                        code == ERROR_TIMEOUT ||
                        code == ERROR_IO ||
                        (code == ERROR_UNKNOWN && !isNetworkOnline())
                if (!isNetworkFailure) return

                firstPageReady = true
                hasMainFrameError = true
                failedUrl = request.url?.toString() ?: HadithUrls.BASE_URL
                binding.swipeRefresh.isRefreshing = false
                binding.errorOverlay.visibility = View.VISIBLE
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onProgressChanged(view: WebView, newProgress: Int) {
                super.onProgressChanged(view, newProgress)
                if (newProgress in 1..99) {
                    binding.progressBar.visibility = View.VISIBLE
                    binding.progressBar.setProgressCompat(newProgress, true)
                } else {
                    binding.progressBar.visibility = View.GONE
                    binding.swipeRefresh.isRefreshing = false
                }
            }

            override fun onCreateWindow(
                view: WebView,
                isDialog: Boolean,
                isUserGesture: Boolean,
                resultMsg: Message?,
            ): Boolean {
                val transport = resultMsg?.obj as? WebView.WebViewTransport ?: return false
                val tempWebView = WebView(this@MainActivity)
                tempWebView.webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(
                        popupView: WebView,
                        request: WebResourceRequest,
                    ): Boolean {
                        val targetUrl = request.url?.toString()
                        if (!targetUrl.isNullOrBlank()) {
                            if (HadithUrls.isInternalSiteUrl(targetUrl)) {
                                loadSiteUrl(targetUrl)
                            } else if (HadithUrls.isDownloadUrl(targetUrl)) {
                                enqueueDownload(targetUrl, binding.webView.settings.userAgentString, null, null)
                            } else {
                                openExternalUrl(targetUrl)
                            }
                        }
                        popupView.destroy()
                        return true
                    }
                }
                transport.webView = tempWebView
                resultMsg.sendToTarget()
                return true
            }

            override fun onShowCustomView(view: View?, callback: CustomViewCallback?) {
                if (view == null) {
                    callback?.onCustomViewHidden()
                    return
                }
                if (customView != null) {
                    callback?.onCustomViewHidden()
                    return
                }
                customView = view
                customViewCallback = callback
                binding.fullscreenContainer.addView(view)
                binding.fullscreenContainer.visibility = View.VISIBLE
                binding.bottomNav.visibility = View.GONE
                binding.bottomNavDivider.visibility = View.GONE
                insetsController.systemBarsBehavior =
                    WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
                insetsController.hide(WindowInsetsCompat.Type.systemBars())
                ViewCompat.requestApplyInsets(binding.rootContainer)
            }

            override fun onHideCustomView() {
                exitFullscreen()
            }

            override fun onShowFileChooser(
                webView: WebView?,
                filePathCallback: ValueCallback<Array<Uri>>?,
                fileChooserParams: FileChooserParams?,
            ): Boolean {
                this@MainActivity.filePathCallback?.onReceiveValue(null)
                this@MainActivity.filePathCallback = filePathCallback
                return try {
                    val intent = fileChooserParams?.createIntent()
                        ?: Intent(Intent.ACTION_GET_CONTENT).apply {
                            addCategory(Intent.CATEGORY_OPENABLE)
                            type = "*/*"
                        }
                    fileChooserLauncher.launch(intent)
                    true
                } catch (_: Exception) {
                    this@MainActivity.filePathCallback = null
                    Toast.makeText(this@MainActivity, R.string.toast_cannot_open, Toast.LENGTH_SHORT).show()
                    false
                }
            }
        }

        webView.setDownloadListener { url, userAgent, contentDisposition, mimetype, _ ->
            enqueueDownload(url, userAgent, contentDisposition, mimetype)
        }
    }

    private fun setupSwipeRefresh() {
        binding.swipeRefresh.setColorSchemeColors(
            ContextCompat.getColor(this, R.color.brand_emerald),
            ContextCompat.getColor(this, R.color.brand_gold),
        )
        binding.swipeRefresh.setOnChildScrollUpCallback { _, _ ->
            binding.webView.scrollY > 0 || HadithUrls.isGraphRoute(binding.webView.url)
        }
        binding.swipeRefresh.setOnRefreshListener {
            binding.webView.reload()
        }
    }

    private fun setupBottomNavigation() {
        binding.bottomNav.setOnItemSelectedListener { item ->
            if (isUpdatingNavSelection) return@setOnItemSelectedListener true
            when (item.itemId) {
                R.id.nav_home -> {
                    loadSiteUrl(HadithUrls.BASE_URL)
                    true
                }
                R.id.nav_search -> {
                    loadSiteUrl(HadithUrls.SEARCH_URL)
                    true
                }
                R.id.nav_books -> {
                    loadSiteUrl(HadithUrls.BOOKS_URL)
                    true
                }
                R.id.nav_narrators -> {
                    loadSiteUrl(HadithUrls.NARRATORS_URL)
                    true
                }
                R.id.nav_more -> {
                    showMoreSheet()
                    false
                }
                else -> false
            }
        }

        binding.bottomNav.setOnItemReselectedListener { item ->
            if (item.itemId == R.id.nav_more) {
                showMoreSheet()
                return@setOnItemReselectedListener
            }
            if (binding.errorOverlay.isVisible) {
                val retryTarget = when (item.itemId) {
                    R.id.nav_home -> HadithUrls.BASE_URL
                    R.id.nav_search -> HadithUrls.SEARCH_URL
                    R.id.nav_books -> HadithUrls.BOOKS_URL
                    R.id.nav_narrators -> HadithUrls.NARRATORS_URL
                    else -> HadithUrls.BASE_URL
                }
                loadSiteUrl(retryTarget)
            } else {
                binding.webView.evaluateJavascript(
                    "window.scrollTo({top: 0, behavior: 'smooth'});",
                    null,
                )
            }
        }
    }

    private fun setupErrorOverlay() {
        binding.btnRetry.setOnClickListener {
            reloadAfterError()
        }
        binding.btnOpenOffline.setOnClickListener {
            loadSiteUrl(HadithUrls.OFFLINE_URL)
        }
    }

    private fun setupBackNavigation() {
        onBackPressedDispatcher.addCallback(
            this,
            object : OnBackPressedCallback(true) {
                override fun handleOnBackPressed() {
                    if (customView != null) {
                        exitFullscreen()
                        return
                    }
                    if (binding.webView.canGoBack()) {
                        binding.webView.goBack()
                        return
                    }
                    isEnabled = false
                    onBackPressedDispatcher.onBackPressed()
                }
            },
        )
    }

    private fun showMoreSheet() {
        val dialog = BottomSheetDialog(this)
        val sheet = BottomSheetMoreBinding.inflate(layoutInflater)
        dialog.setContentView(sheet.root)

        val currentUrl = binding.webView.url?.takeIf { HadithUrls.isInternalSiteUrl(it) }
            ?: HadithUrls.BASE_URL
        val currentTitle = binding.webView.title?.takeIf { it.isNotBlank() }
            ?: getString(R.string.app_name)

        sheet.sheetPageTitle.text = currentTitle
        sheet.sheetPageUrl.text = currentUrl
        sheet.sheetVersion.text = getString(R.string.more_version, BuildConfig.VERSION_NAME)

        applySheetTheme(sheet)

        sheet.rowOffline.setOnClickListener {
            dialog.dismiss()
            loadSiteUrl(HadithUrls.OFFLINE_URL)
        }
        sheet.rowSaved.setOnClickListener {
            dialog.dismiss()
            loadSiteUrl(HadithUrls.SAVED_URL)
        }
        sheet.rowShare.setOnClickListener {
            dialog.dismiss()
            val intent = Intent(Intent.ACTION_SEND).apply {
                type = "text/plain"
                putExtra(Intent.EXTRA_SUBJECT, currentTitle)
                putExtra(Intent.EXTRA_TEXT, "$currentTitle\n$currentUrl")
            }
            startActivity(Intent.createChooser(intent, getString(R.string.more_share)))
        }
        sheet.rowCopy.setOnClickListener {
            dialog.dismiss()
            val clipboard = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            clipboard.setPrimaryClip(ClipData.newPlainText(getString(R.string.app_name), currentUrl))
            Toast.makeText(this, R.string.toast_copied, Toast.LENGTH_SHORT).show()
        }
        sheet.rowRefresh.setOnClickListener {
            dialog.dismiss()
            binding.errorOverlay.visibility = View.GONE
            binding.webView.reload()
        }

        dialog.show()
    }

    private fun applySheetTheme(sheet: BottomSheetMoreBinding) {
        val surface = ContextCompat.getColor(
            this,
            if (isDarkTheme) R.color.surface_dark else R.color.surface_light,
        )
        val ink = ContextCompat.getColor(
            this,
            if (isDarkTheme) R.color.ink_dark else R.color.ink_light,
        )
        val muted = ContextCompat.getColor(
            this,
            if (isDarkTheme) R.color.muted_dark else R.color.muted_light,
        )
        val border = ContextCompat.getColor(
            this,
            if (isDarkTheme) R.color.border_dark else R.color.border_light,
        )
        val accent = ContextCompat.getColor(
            this,
            if (isDarkTheme) R.color.brand_gold else R.color.brand_emerald,
        )

        sheet.sheetRoot.setBackgroundColor(surface)
        sheet.sheetHandle.setBackgroundColor(border)
        sheet.sheetDividerTop.setBackgroundColor(border)
        sheet.sheetDividerBottom.setBackgroundColor(border)
        sheet.sheetPageTitle.setTextColor(ink)
        sheet.sheetPageUrl.setTextColor(muted)
        sheet.sheetVersion.setTextColor(muted)

        val labels = listOf(
            sheet.labelOffline,
            sheet.labelSaved,
            sheet.labelShare,
            sheet.labelCopy,
            sheet.labelRefresh,
        )
        labels.forEach { it.setTextColor(ink) }

        val icons = listOf(
            sheet.iconOffline,
            sheet.iconSaved,
            sheet.iconShare,
            sheet.iconCopy,
            sheet.iconRefresh,
        )
        icons.forEach { it.imageTintList = ColorStateList.valueOf(accent) }
    }

    private fun applyTheme(isDark: Boolean) {
        isDarkTheme = isDark
        val paper = ContextCompat.getColor(
            this,
            if (isDark) R.color.paper_dark else R.color.paper_light,
        )
        val surface = ContextCompat.getColor(
            this,
            if (isDark) R.color.surface_dark else R.color.surface_light,
        )
        val border = ContextCompat.getColor(
            this,
            if (isDark) R.color.border_dark else R.color.border_light,
        )
        val muted = ContextCompat.getColor(
            this,
            if (isDark) R.color.muted_dark else R.color.muted_light,
        )
        val active = ContextCompat.getColor(
            this,
            if (isDark) R.color.brand_gold else R.color.brand_emerald,
        )
        val activeIndicator = if (isDark) {
            0x26C9A96B
        } else {
            0x1A0F3D2E
        }

        val itemColors = ColorStateList(
            arrayOf(
                intArrayOf(android.R.attr.state_checked),
                intArrayOf(),
            ),
            intArrayOf(active, muted),
        )

        binding.contentContainer.setBackgroundColor(paper)
        binding.errorOverlay.setBackgroundColor(paper)
        binding.errorIcon.imageTintList = ColorStateList.valueOf(active)
        binding.errorTitle.setTextColor(active)
        binding.errorMessage.setTextColor(muted)
        binding.btnOpenOffline.setTextColor(active)
        binding.btnOpenOffline.strokeColor = ColorStateList.valueOf(active)

        binding.bottomNavDivider.setBackgroundColor(border)
        binding.bottomNav.setBackgroundColor(surface)
        binding.bottomNav.itemIconTintList = itemColors
        binding.bottomNav.itemTextColor = itemColors
        binding.bottomNav.itemActiveIndicatorColor = ColorStateList.valueOf(activeIndicator)

        insetsController.isAppearanceLightStatusBars = false
        insetsController.isAppearanceLightNavigationBars = !isDark
    }

    private fun syncNavAndSwipeState(url: String?) {
        val targetItemId = when (HadithUrls.resolveTab(url)) {
            HadithUrls.NavTab.HOME -> R.id.nav_home
            HadithUrls.NavTab.SEARCH -> R.id.nav_search
            HadithUrls.NavTab.BOOKS -> R.id.nav_books
            HadithUrls.NavTab.NARRATORS -> R.id.nav_narrators
            HadithUrls.NavTab.MORE -> R.id.nav_more
        }
        if (binding.bottomNav.selectedItemId != targetItemId) {
            isUpdatingNavSelection = true
            binding.bottomNav.selectedItemId = targetItemId
            isUpdatingNavSelection = false
        }
        binding.swipeRefresh.isEnabled = !HadithUrls.isGraphRoute(url)
    }

    private fun injectThemeObserver() {
        val js = """
            (function() {
              if (!window.hadithAndroid) return;
              var report = function() {
                window.hadithAndroid.onThemeChanged(document.documentElement.classList.contains('dark'));
              };
              report();
              if (!window.__hadithThemeObserver) {
                window.__hadithThemeObserver = new MutationObserver(report);
                window.__hadithThemeObserver.observe(document.documentElement, {
                  attributes: true,
                  attributeFilter: ['class']
                });
              }
            })();
        """.trimIndent()
        binding.webView.evaluateJavascript(js, null)
    }

    private fun loadSiteUrl(url: String) {
        hasMainFrameError = false
        binding.errorOverlay.visibility = View.GONE
        binding.webView.loadUrl(url)
    }

    private fun reloadAfterError() {
        hasMainFrameError = false
        binding.errorOverlay.visibility = View.GONE
        val target = failedUrl.takeIf { HadithUrls.isInternalSiteUrl(it) } ?: HadithUrls.BASE_URL
        if (binding.webView.url == target) {
            binding.webView.reload()
        } else {
            binding.webView.loadUrl(target)
        }
    }

    private fun exitFullscreen() {
        val view = customView ?: return
        binding.fullscreenContainer.removeView(view)
        binding.fullscreenContainer.visibility = View.GONE
        customView = null
        customViewCallback?.onCustomViewHidden()
        customViewCallback = null
        insetsController.show(WindowInsetsCompat.Type.systemBars())
        if (!isImeVisible) {
            binding.bottomNav.visibility = View.VISIBLE
            binding.bottomNavDivider.visibility = View.VISIBLE
        }
        ViewCompat.requestApplyInsets(binding.rootContainer)
    }

    private fun openExternalUrl(url: String) {
        val uri = runCatching { url.toUri() }.getOrNull() ?: return
        val scheme = uri.scheme?.lowercase()
        if (scheme == "http" || scheme == "https") {
            val colors = CustomTabColorSchemeParams.Builder()
                .setToolbarColor(ContextCompat.getColor(this, R.color.brand_emerald))
                .build()
            val customTabs = CustomTabsIntent.Builder()
                .setDefaultColorSchemeParams(colors)
                .setShowTitle(true)
                .build()
            val openedInCustomTabs = runCatching {
                customTabs.launchUrl(this, uri)
                true
            }.getOrDefault(false)
            if (openedInCustomTabs) return
        }

        val fallback = Intent(Intent.ACTION_VIEW, uri).apply {
            addCategory(Intent.CATEGORY_BROWSABLE)
        }
        runCatching { startActivity(fallback) }.onFailure {
            Toast.makeText(this, R.string.toast_cannot_open, Toast.LENGTH_SHORT).show()
        }
    }

    private fun enqueueDownload(
        url: String,
        userAgent: String?,
        contentDisposition: String?,
        mimetype: String?,
    ) {
        if (!url.startsWith("https://") && !url.startsWith("http://")) {
            openExternalUrl(url)
            return
        }
        runCatching {
            val request = DownloadManager.Request(url.toUri()).apply {
                if (!mimetype.isNullOrBlank()) {
                    setMimeType(mimetype)
                }
                val cookies = CookieManager.getInstance().getCookie(url)
                if (!cookies.isNullOrBlank()) {
                    addRequestHeader("Cookie", cookies)
                }
                if (!userAgent.isNullOrBlank()) {
                    addRequestHeader("User-Agent", userAgent)
                }
                val filename = URLUtil.guessFileName(url, contentDisposition, mimetype)
                setTitle(filename)
                setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename)
            }
            val dm = getSystemService(DownloadManager::class.java)
            dm.enqueue(request)
            Toast.makeText(this, R.string.toast_download_started, Toast.LENGTH_SHORT).show()
        }.onFailure {
            openExternalUrl(url)
        }
    }

    private fun resolveStartUrl(intent: Intent?): String {
        val data = intent?.dataString
        return HadithUrls.sanitizeIncomingUrl(data)
    }

    private fun isNetworkOnline(): Boolean {
        val network = connectivityManager.activeNetwork ?: return false
        val caps = connectivityManager.getNetworkCapabilities(network) ?: return false
        return caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
    }

    private fun extractClipDataUris(resultCode: Int, data: Intent?): Array<Uri>? {
        if (resultCode != Activity.RESULT_OK || data == null) return null
        val clip = data.clipData ?: return data.data?.let { arrayOf(it) }
        return Array(clip.itemCount) { i -> clip.getItemAt(i).uri }
    }

    companion object {
        private const val JS_BRIDGE_NAME = "hadithAndroid"
        private const val SPLASH_MAX_WAIT_MS = 1500L
    }
}
