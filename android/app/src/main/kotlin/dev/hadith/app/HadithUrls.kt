package dev.hadith.app

import java.net.URI

/**
 * Pure URL routing, sanitization, and bottom-tab classification helpers for Hadith.dev.
 */
object HadithUrls {
    const val BASE_URL = "https://hadith.dev"
    const val SEARCH_URL = "$BASE_URL/search"
    const val BOOKS_URL = "$BASE_URL/books"
    const val NARRATORS_URL = "$BASE_URL/narrators"
    const val OFFLINE_URL = "$BASE_URL/database"
    const val SAVED_URL = "$BASE_URL/saved"

    private val SITE_HOSTS = setOf("hadith.dev", "www.hadith.dev")
    private const val FILES_HOST = "files.hadith.dev"
    private val DOWNLOAD_EXTENSIONS = setOf(
        ".dump", ".apk", ".zip", ".pdf", ".ris", ".bib", ".enw",
        ".exe", ".dmg", ".deb", ".appimage",
    )

    enum class NavTab {
        HOME,
        SEARCH,
        BOOKS,
        NARRATORS,
        MORE,
    }

    /**
     * Returns true only for HTTPS URLs belonging to hadith.dev / www.hadith.dev that are
     * navigable web pages rather than downloadable binary/export artifacts.
     */
    fun isInternalSiteUrl(url: String?): Boolean {
        val uri = parseUri(url) ?: return false
        val scheme = uri.scheme?.lowercase() ?: return false
        val host = uri.host?.lowercase() ?: return false
        if (scheme != "https" || host !in SITE_HOSTS) return false
        return !hasDownloadExtension(uri.path)
    }

    /**
     * Returns true for files.hadith.dev URLs or HTTP(S) paths pointing to binary/export files.
     */
    fun isDownloadUrl(url: String?): Boolean {
        val uri = parseUri(url) ?: return false
        val scheme = uri.scheme?.lowercase() ?: return false
        if (scheme != "https" && scheme != "http") return false
        val host = uri.host?.lowercase() ?: return false
        if (host == FILES_HOST) return true
        return hasDownloadExtension(uri.path)
    }

    /**
     * Returns true on interactive graph/tree routes so swipe-to-refresh does not conflict with panning.
     */
    fun isGraphRoute(url: String?): Boolean {
        val path = parsePath(url) ?: return false
        return path.contains("/isnad-tree") || path.contains("/narrators/network")
    }

    /**
     * Maps a Hadith.dev URL to the corresponding bottom navigation destination.
     */
    fun resolveTab(url: String?): NavTab {
        val path = parsePath(url) ?: return NavTab.HOME
        if (path.isEmpty() || path == "/") return NavTab.HOME
        if (path.startsWith("/search")) return NavTab.SEARCH
        if (
            path.startsWith("/books") ||
            path.startsWith("/hadith") ||
            path.startsWith("/chapters") ||
            path.startsWith("/isnad-tree") ||
            path.startsWith("/compound-matn") ||
            path.startsWith("/matn-compare")
        ) {
            return NavTab.BOOKS
        }
        if (
            path.startsWith("/narrators") ||
            path.startsWith("/narrator") ||
            path.startsWith("/companions") ||
            path.startsWith("/scholars") ||
            path.startsWith("/bio-search")
        ) {
            return NavTab.NARRATORS
        }
        return NavTab.MORE
    }

    /**
     * Validates an incoming deep link or shortcut URL and falls back to [BASE_URL] if untrusted.
     */
    fun sanitizeIncomingUrl(rawUrl: String?): String {
        val trimmed = rawUrl?.trim().orEmpty()
        return if (isInternalSiteUrl(trimmed)) trimmed else BASE_URL
    }

    private fun hasDownloadExtension(rawPath: String?): Boolean {
        val path = rawPath?.lowercase() ?: return false
        return DOWNLOAD_EXTENSIONS.any { path.endsWith(it) }
    }

    private fun parsePath(url: String?): String? {
        val uri = parseUri(url) ?: return null
        val host = uri.host?.lowercase()
        if (host != null && host !in SITE_HOSTS) return null
        return uri.path?.lowercase()
    }

    private fun parseUri(raw: String?): URI? {
        val trimmed = raw?.trim()
        if (trimmed.isNullOrEmpty()) return null
        return try {
            URI(trimmed)
        } catch (_: Exception) {
            null
        }
    }
}
