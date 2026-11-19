# Keep the WebView JavaScript bridge class and all @JavascriptInterface methods intact under R8.
-keep class dev.hadith.app.HadithJsBridge {
    *;
}
-keepattributes JavascriptInterface
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}
