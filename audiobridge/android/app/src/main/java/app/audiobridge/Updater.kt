package app.audiobridge

import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.content.FileProvider
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL
import java.security.MessageDigest

data class UpdateInfo(
    val versionCode: Long,
    val versionName: String,
    val apkUrl: String,
    val apkSha256: String,
)

/** GitHub rolling release updater with cache bypass and SHA-256 verification. */
object Updater {
    private const val LATEST_URL =
        "https://github.com/jykim5215/-/releases/download/v1.0.0-build/latest.json"
    private const val MAX_APK_BYTES = 100L * 1024 * 1024

    fun currentVersionCode(context: Context): Long {
        val info = context.packageManager.getPackageInfo(context.packageName, 0)
        return if (Build.VERSION.SDK_INT >= 28) info.longVersionCode
        else @Suppress("DEPRECATION") info.versionCode.toLong()
    }

    /** Returns a newer release, or null when current/offline/invalid. */
    suspend fun check(context: Context): UpdateInfo? = withContext(Dispatchers.IO) {
        try {
            val url = "$LATEST_URL?t=${System.currentTimeMillis()}"
            val connection = open(url, 6_000, 6_000)
            val text = connection.inputStream.use { String(it.readBytes(), Charsets.UTF_8) }
            if (text.length > 4_096) return@withContext null
            val json = JSONObject(text)
            val code = json.optLong("versionCode", -1)
            val apkUrl = json.optString("apkUrl", "")
            val hash = json.optString("apkSha256", "").lowercase()
            if (code <= currentVersionCode(context)) return@withContext null
            if (!isTrustedReleaseUrl(apkUrl) || !isSha256(hash)) return@withContext null
            UpdateInfo(
                code,
                json.optString("versionName", code.toString()),
                apkUrl,
                hash,
            )
        } catch (_: Exception) {
            null
        }
    }

    /** Downloads, verifies, then opens Android's package installer. */
    suspend fun downloadAndInstall(
        context: Context,
        info: UpdateInfo,
        onProgress: (Float) -> Unit,
    ): String? = withContext(Dispatchers.IO) {
        val file = File(context.cacheDir, "update-${info.versionCode}.apk")
        try {
            if (!isTrustedReleaseUrl(info.apkUrl) || !isSha256(info.apkSha256)) {
                return@withContext "업데이트 정보가 올바르지 않습니다."
            }
            val connection = open(info.apkUrl, 8_000, 60_000)
            val total = connection.contentLengthLong
            if (total > MAX_APK_BYTES) return@withContext "업데이트 파일이 비정상적으로 큽니다."

            val digest = MessageDigest.getInstance("SHA-256")
            var done = 0L
            connection.inputStream.use { input ->
                file.outputStream().use { output ->
                    val buffer = ByteArray(64 * 1024)
                    while (true) {
                        val read = input.read(buffer)
                        if (read < 0) break
                        done += read
                        if (done > MAX_APK_BYTES) {
                            throw IllegalStateException("업데이트 파일이 비정상적으로 큽니다.")
                        }
                        output.write(buffer, 0, read)
                        digest.update(buffer, 0, read)
                        if (total > 0) onProgress(done.toFloat() / total)
                    }
                }
            }
            if (done == 0L) throw IllegalStateException("업데이트 파일을 받지 못했습니다.")
            val actualHash = digest.digest().joinToString("") { "%02x".format(it) }
            if (!MessageDigest.isEqual(
                    actualHash.toByteArray(Charsets.US_ASCII),
                    info.apkSha256.toByteArray(Charsets.US_ASCII),
                )
            ) {
                file.delete()
                throw IllegalStateException("업데이트 무결성 확인에 실패했습니다.")
            }

            val uri = FileProvider.getUriForFile(
                context,
                context.packageName + ".fileprovider",
                file,
            )
            context.startActivity(
                Intent(Intent.ACTION_VIEW)
                    .setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
            )
            null
        } catch (e: Exception) {
            file.delete()
            "업데이트 다운로드 실패: ${e.message}"
        }
    }

    private fun open(url: String, connectTimeout: Int, readTimeout: Int): HttpURLConnection {
        val connection = URL(url).openConnection() as HttpURLConnection
        connection.connectTimeout = connectTimeout
        connection.readTimeout = readTimeout
        connection.instanceFollowRedirects = true
        connection.useCaches = false
        connection.setRequestProperty("Cache-Control", "no-cache, no-store")
        connection.setRequestProperty("User-Agent", "AudioBridge-Android-Updater/1.0")
        val status = connection.responseCode
        if (status !in 200..299) throw IllegalStateException("HTTP $status")
        return connection
    }

    private fun isTrustedReleaseUrl(value: String): Boolean = runCatching {
        val url = URL(value)
        url.protocol == "https" &&
            url.host.equals("github.com", ignoreCase = true) &&
            url.path.startsWith("/jykim5215/-/releases/download/")
    }.getOrDefault(false)

    private fun isSha256(value: String): Boolean =
        value.length == 64 && value.all { it in '0'..'9' || it in 'a'..'f' || it in 'A'..'F' }
}
