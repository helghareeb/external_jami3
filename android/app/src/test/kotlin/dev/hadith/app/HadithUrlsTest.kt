package dev.hadith.app

import dev.hadith.app.HadithUrls.NavTab
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HadithUrlsTest {

    @Test
    fun internalUrlsStayInApp() {
        assertTrue(HadithUrls.isInternalSiteUrl("https://hadith.dev"))
        assertTrue(HadithUrls.isInternalSiteUrl("https://hadith.dev/"))
        assertTrue(HadithUrls.isInternalSiteUrl("https://hadith.dev/hadith/15048"))
        assertTrue(HadithUrls.isInternalSiteUrl("https://www.hadith.dev/search?q=test"))
        assertTrue(HadithUrls.isInternalSiteUrl("https://hadith.dev/offline"))
    }

    @Test
    fun externalAndInsecureUrlsLeaveWebView() {
        assertFalse(HadithUrls.isInternalSiteUrl("http://hadith.dev"))
        assertFalse(HadithUrls.isInternalSiteUrl("https://files.hadith.dev/db/hadith.dump"))
        assertFalse(HadithUrls.isInternalSiteUrl("https://wa.me/61426047327"))
        assertFalse(HadithUrls.isInternalSiteUrl("https://hadith.dev.evil.example/"))
        assertFalse(HadithUrls.isInternalSiteUrl("javascript:alert(1)"))
        assertFalse(HadithUrls.isInternalSiteUrl(null))
        assertFalse(HadithUrls.isInternalSiteUrl(""))
    }

    @Test
    fun downloadUrlsAreDetected() {
        assertTrue(HadithUrls.isDownloadUrl("https://files.hadith.dev/offline/manifest.json"))
        assertTrue(HadithUrls.isDownloadUrl("https://files.hadith.dev/db/hadith-public-2026-10-16.dump"))
        assertTrue(HadithUrls.isDownloadUrl("https://hadith.dev/api/cite/123.ris"))
        assertTrue(HadithUrls.isDownloadUrl("https://hadith.dev/export/refs.bib"))
        assertTrue(HadithUrls.isDownloadUrl("https://hadith.dev/app.apk"))
        assertFalse(HadithUrls.isDownloadUrl("https://hadith.dev/books/1"))
        assertFalse(HadithUrls.isDownloadUrl("mailto:user@hadith.dev"))
    }

    @Test
    fun graphRoutesDisableSwipeRefresh() {
        assertTrue(HadithUrls.isGraphRoute("https://hadith.dev/isnad-tree?id=10"))
        assertTrue(HadithUrls.isGraphRoute("https://hadith.dev/narrators/network?id=55"))
        assertFalse(HadithUrls.isGraphRoute("https://hadith.dev/narrators/55"))
        assertFalse(HadithUrls.isGraphRoute("https://hadith.dev/books"))
        assertFalse(HadithUrls.isGraphRoute(null))
    }

    @Test
    fun resolvesBottomTabsAcrossRoutes() {
        assertEquals(NavTab.HOME, HadithUrls.resolveTab("https://hadith.dev"))
        assertEquals(NavTab.HOME, HadithUrls.resolveTab("https://hadith.dev/"))
        assertEquals(NavTab.SEARCH, HadithUrls.resolveTab("https://hadith.dev/search?q=الصلاة"))
        assertEquals(NavTab.BOOKS, HadithUrls.resolveTab("https://hadith.dev/books/1"))
        assertEquals(NavTab.BOOKS, HadithUrls.resolveTab("https://hadith.dev/hadith/15048"))
        assertEquals(NavTab.NARRATORS, HadithUrls.resolveTab("https://hadith.dev/narrators/42"))
        assertEquals(NavTab.NARRATORS, HadithUrls.resolveTab("https://hadith.dev/companions"))
        assertEquals(NavTab.MORE, HadithUrls.resolveTab("https://hadith.dev/offline"))
        assertEquals(NavTab.MORE, HadithUrls.resolveTab("https://hadith.dev/saved"))
    }

    @Test
    fun sanitizesIncomingDeepLinks() {
        assertEquals(
            "https://hadith.dev/hadith/15048",
            HadithUrls.sanitizeIncomingUrl("https://hadith.dev/hadith/15048"),
        )
        assertEquals(
            HadithUrls.BASE_URL,
            HadithUrls.sanitizeIncomingUrl("https://evil.example/phish"),
        )
        assertEquals(
            HadithUrls.BASE_URL,
            HadithUrls.sanitizeIncomingUrl("http://hadith.dev/books"),
        )
        assertEquals(
            HadithUrls.BASE_URL,
            HadithUrls.sanitizeIncomingUrl(null),
        )
    }
}
