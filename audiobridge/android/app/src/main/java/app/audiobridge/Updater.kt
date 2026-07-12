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

data class UpdateInfo(val versionCode: Long, val versionName: String, val apkUrl: String)

/**
 * 앱 내 업데이트: GitHub Release의 latest.json으로 새 버전을 확인하고,
 * APK를 받아 시스템 설치 화면을 띄운다. (동일 서명 키 → 덮어쓰기 설치)
 */
object Updater {
    private const val LATEST_URL =
        "https://github.com/jykim5215/-/releases/download/v1.0.0-build/latest.json"
    private const val MAX_APK_BYTES = 100L * 1024 * 1024

    fun currentVersionCode(context: Context): Long {
        val pi = context.packageManager.getPackageInfo(context.packageName, 0)
        return if (Build.VERSION.SDK_INT >= 28) pi.longVersionCode
        else @Suppress("DEPRECATION") pi.versionCode.toLong()
    }

    /** 새 버전이 있으면 UpdateInfo, 없거나 확인 실패면 null (조용히). */
    suspend fun check(context: Context): UpdateInfo? = withContext(Dispatchers.IO) {
        try {
            val conn = URL(LATEST_URL).openConnection() as HttpURLConnection
            conn.connectTimeout = 6000
            conn.readTimeout = 6000
            val text = conn.inputStream.use { String(it.readBytes(), Charsets.UTF_8) }
            if (text.length > 4096) return@withContext null
            val obj = JSONObject(text)
            val code = obj.optLong("versionCode", -1)
            val url = obj.optString("apkUrl", "")
            // 신뢰 도메인(이 저장소의 릴리스)만 허용
            if (code <= 0 || !url.startsWith("https://github.com/jykim5215/")) return@withContext null
            if (code <= currentVersionCode(context)) return@withContext null
            UpdateInfo(code, obj.optString("versionName", code.toString()), url)
        } catch (_: Exception) {
            null
        }
    }

    /** APK 다운로드 후 설치 화면 호출. 성공 시 null, 실패 시 사용자용 오류 메시지. */
    suspend fun downloadAndInstall(
        context: Context,
        info: UpdateInfo,
        onProgress: (Float) -> Unit,
    ): String? = withContext(Dispatchers.IO) {
        try {
            val file = File(context.cacheDir, "update.apk")
            val conn = URL(info.apkUrl).openConnection() as HttpURLConnection
            conn.connectTimeout = 8000
            conn.readTimeout = 60000
            val total = conn.contentLengthLong
            if (total > MAX_APK_BYTES) return@withContext "업데이트 파일이 비정상적으로 큽니다"
            var done = 0L
            conn.inputStream.use { input ->
                file.outputStream().use { out ->
                    val buf = ByteArray(64 * 1024)
                    while (true) {
                        val n = input.read(buf)
                        if (n < 0) break
                        out.write(buf, 0, n)
                        done += n
                        if (done > MAX_APK_BYTES) return@withContext "업데이트 파일이 비정상적으로 큽니다"
                        if (total > 0) onProgress(done.toFloat() / total)
                    }
                }
            }
            if (done == 0L) return@withContext "업데이트 파일을 받지 못했습니다"
            val uri = FileProvider.getUriForFile(context, context.packageName + ".fileprovider", file)
            context.startActivity(
                Intent(Intent.ACTION_VIEW)
                    .setDataAndType(uri, "application/vnd.android.package-archive")
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_GRANT_READ_URI_PERMISSION)
            )
            null
        } catch (e: Exception) {
            "업데이트 다운로드 실패: ${e.message}"
        }
    }
}
