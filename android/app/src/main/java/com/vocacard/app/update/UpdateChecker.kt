package com.vocacard.app.update

import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import com.vocacard.app.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.util.concurrent.TimeUnit

/**
 * GitHub 공개 릴리즈 API 기반 자체 업데이트.
 *
 * 보안 원칙
 *  - **토큰/자격증명을 사용하지 않는다.** 공개 저장소의 공개 엔드포인트만 호출한다.
 *  - 다운로드 URL 은 반드시 `https://github.com` 또는 `https://objects.githubusercontent.com`
 *    호스트여야 하며, 그 외 호스트는 거부한다(릴리즈 노트에 삽입된 임의 링크 방지).
 *  - APK 는 앱 전용 캐시에만 저장하고 FileProvider 로만 노출한다.
 *  - 확인 실패는 절대 앱 사용을 막지 않는다. 오류 메시지만 돌려준다.
 */
class UpdateChecker(
    private val context: Context,
    private val client: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(8, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .build(),
) {
    private val json = Json { ignoreUnknownKeys = true }

    val currentVersion: String get() = BuildConfig.VERSION_NAME.substringBefore("-")

    sealed interface Result {
        data class UpToDate(val current: String) : Result
        data class Available(
            val version: String,
            val changelog: String,
            val apkUrl: String?,
            val pageUrl: String,
            val sizeBytes: Long,
        ) : Result

        data class Failed(val message: String) : Result
    }

    /**
     * 최신 릴리즈를 찾는다.
     *
     * `releases/latest` 를 쓰지 않는 이유: 이 저장소에는 **다른 프로젝트의 릴리즈도 섞여 있다.**
     * `latest` 는 저장소 전체에서 가장 최근 것을 돌려주므로, 다른 앱의 APK 를 이 앱의
     * 업데이트로 착각해 내려받을 수 있다. 그래서 목록을 받아
     * `vocacard-v` 태그 + `VocaCard-*.apk` 자산인 것만 골라낸다.
     */
    suspend fun check(): Result = withContext(Dispatchers.IO) {
        try {
            val url = "https://api.github.com/repos/${BuildConfig.UPDATE_REPO}/releases?per_page=30"
            val req = Request.Builder().url(url)
                .header("Accept", "application/vnd.github+json")
                .header("X-GitHub-Api-Version", "2022-11-28")
                .build()
            client.newCall(req).execute().use { res ->
                if (res.code == 404) return@withContext Result.UpToDate(currentVersion)
                if (!res.isSuccessful) return@withContext Result.Failed("업데이트 서버 응답 오류 (${res.code})")
                val body = res.body?.string().orEmpty()
                if (body.isBlank()) return@withContext Result.UpToDate(currentVersion)

                val release = json.decodeFromString<List<GhRelease>>(body)
                    .asSequence()
                    .filter { !it.draft && !it.prerelease }
                    .filter { it.tagName?.startsWith(TAG_PREFIX) == true }
                    .maxByOrNull { Semver.key(it.tagName!!.removePrefix(TAG_PREFIX)) }
                    ?: return@withContext Result.UpToDate(currentVersion)

                val latest = release.tagName!!.removePrefix(TAG_PREFIX).trim()
                if (latest.isEmpty() || Semver.compare(latest, currentVersion) <= 0) {
                    return@withContext Result.UpToDate(currentVersion)
                }

                val apk = release.assets.orEmpty().firstOrNull {
                    val n = it.name.orEmpty()
                    n.startsWith(ASSET_PREFIX, ignoreCase = true) && n.endsWith(".apk", ignoreCase = true)
                }
                Result.Available(
                    version = latest,
                    changelog = release.body?.trim().orEmpty().ifEmpty { "변경 내용이 제공되지 않았어요." },
                    apkUrl = apk?.browserDownloadUrl?.takeIf { isTrustedHost(it) },
                    pageUrl = release.htmlUrl ?: "https://github.com/${BuildConfig.UPDATE_REPO}/releases",
                    sizeBytes = apk?.size ?: 0L,
                )
            }
        } catch (e: Exception) {
            Result.Failed("업데이트를 확인하지 못했어요. 네트워크를 확인해 주세요.")
        }
    }

    /** 승인 후 APK 다운로드. 진행률(0f~1f)을 콜백으로 보고한다. */
    suspend fun download(
        url: String,
        version: String,
        onProgress: (Float) -> Unit = {},
    ): File? = withContext(Dispatchers.IO) {
        if (!isTrustedHost(url)) return@withContext null
        try {
            val dir = File(context.cacheDir, "updates").apply { mkdirs() }
            dir.listFiles()?.forEach { it.delete() }
            val out = File(dir, "VocaCard-$version.apk")
            client.newCall(Request.Builder().url(url).build()).execute().use { res ->
                if (!res.isSuccessful) return@withContext null
                val body = res.body ?: return@withContext null
                val total = body.contentLength().takeIf { it > 0 } ?: -1L
                var read = 0L
                body.byteStream().use { input ->
                    out.outputStream().use { output ->
                        val buf = ByteArray(64 * 1024)
                        while (true) {
                            val n = input.read(buf)
                            if (n < 0) break
                            output.write(buf, 0, n)
                            read += n
                            if (total > 0) onProgress((read.toFloat() / total).coerceIn(0f, 1f))
                        }
                    }
                }
            }
            onProgress(1f)
            out
        } catch (e: Exception) {
            null
        }
    }

    /** 시스템 패키지 설치 화면을 띄운다. 실제 설치 승인은 사용자가 한다. */
    fun installIntent(apk: File): Intent {
        val uri: Uri = FileProvider.getUriForFile(
            context, "${context.packageName}.fileprovider", apk
        )
        return Intent(Intent.ACTION_VIEW).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
        }
    }

    private companion object {
        /** 이 앱의 릴리즈만 골라내기 위한 태그 접두사. 워크플로의 tag_name 과 반드시 일치해야 한다. */
        const val TAG_PREFIX = "vocacard-v"
        const val ASSET_PREFIX = "VocaCard-"
    }

    fun releasePageIntent(url: String): Intent =
        Intent(Intent.ACTION_VIEW, Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)

    private fun isTrustedHost(url: String): Boolean = runCatching {
        val host = Uri.parse(url).host.orEmpty().lowercase()
        Uri.parse(url).scheme.equals("https", true) &&
            (host == "github.com" || host.endsWith(".github.com") ||
                host == "objects.githubusercontent.com" || host.endsWith(".githubusercontent.com"))
    }.getOrDefault(false)
}

/** semantic versioning 비교. a>b 면 양수. */
object Semver {
    fun compare(a: String, b: String): Int {
        val pa = parse(a)
        val pb = parse(b)
        for (i in 0..2) {
            val d = pa[i].compareTo(pb[i])
            if (d != 0) return d
        }
        return 0
    }

    /** 정렬용 비교 키. major*1e6 + minor*1e3 + patch */
    fun key(v: String): Long {
        val p = parse(v)
        return p[0] * 1_000_000L + p[1] * 1_000L + p[2]
    }

    private fun parse(v: String): IntArray {
        val parts = v.trim().removePrefix("v").split(".", "-", "+")
        return IntArray(3) { i -> parts.getOrNull(i)?.filter { it.isDigit() }?.toIntOrNull() ?: 0 }
    }
}

/* ────────── GitHub Releases API 응답(필요한 필드만) ────────── */

@Serializable
private data class GhRelease(
    @SerialName("tag_name") val tagName: String? = null,
    @SerialName("html_url") val htmlUrl: String? = null,
    val name: String? = null,
    val body: String? = null,
    val draft: Boolean = false,
    val prerelease: Boolean = false,
    val assets: List<GhAsset>? = null,
)

@Serializable
private data class GhAsset(
    val name: String? = null,
    val size: Long = 0,
    @SerialName("browser_download_url") val browserDownloadUrl: String? = null,
)
