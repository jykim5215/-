package com.vocacard.app.data.settings

import android.content.Context
import androidx.datastore.core.DataStore
import androidx.datastore.preferences.core.Preferences
import androidx.datastore.preferences.core.booleanPreferencesKey
import androidx.datastore.preferences.core.edit
import androidx.datastore.preferences.core.longPreferencesKey
import androidx.datastore.preferences.core.stringPreferencesKey
import androidx.datastore.preferences.preferencesDataStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

private val Context.dataStore: DataStore<Preferences> by preferencesDataStore(name = "voca_settings")

enum class ThemeMode { SYSTEM, LIGHT, DARK }

data class Settings(
    val themeMode: ThemeMode = ThemeMode.SYSTEM,
    /** 학습 중 뜻→단어 방향으로 뒤집어 출제 */
    val reverseMode: Boolean = false,
    /** 온라인 사전 추천 사용 */
    val onlineSuggest: Boolean = true,
    /** 앱 실행 시 업데이트 자동 확인 */
    val autoCheckUpdate: Boolean = true,
    val lastDayId: String? = null,
    val lastUpdateCheck: Long = 0L,
    val skippedVersion: String? = null,
    val hapticFeedback: Boolean = true,
)

class SettingsStore(private val context: Context) {

    val settings: Flow<Settings> = context.dataStore.data.map { p ->
        Settings(
            themeMode = runCatching { ThemeMode.valueOf(p[KEY_THEME] ?: "SYSTEM") }.getOrDefault(ThemeMode.SYSTEM),
            reverseMode = p[KEY_REVERSE] ?: false,
            onlineSuggest = p[KEY_ONLINE] ?: true,
            autoCheckUpdate = p[KEY_AUTO_UPDATE] ?: true,
            lastDayId = p[KEY_LAST_DAY],
            lastUpdateCheck = p[KEY_LAST_CHECK] ?: 0L,
            skippedVersion = p[KEY_SKIPPED],
            hapticFeedback = p[KEY_HAPTIC] ?: true,
        )
    }

    suspend fun setTheme(mode: ThemeMode) = edit { it[KEY_THEME] = mode.name }
    suspend fun setReverse(v: Boolean) = edit { it[KEY_REVERSE] = v }
    suspend fun setOnlineSuggest(v: Boolean) = edit { it[KEY_ONLINE] = v }
    suspend fun setAutoCheckUpdate(v: Boolean) = edit { it[KEY_AUTO_UPDATE] = v }
    suspend fun setLastDay(dayId: String) = edit { it[KEY_LAST_DAY] = dayId }
    suspend fun setLastUpdateCheck(t: Long) = edit { it[KEY_LAST_CHECK] = t }
    suspend fun setSkippedVersion(v: String?) = edit { p ->
        if (v == null) p.remove(KEY_SKIPPED) else p[KEY_SKIPPED] = v
    }
    suspend fun setHaptic(v: Boolean) = edit { it[KEY_HAPTIC] = v }

    private suspend fun edit(block: (androidx.datastore.preferences.core.MutablePreferences) -> Unit) {
        context.dataStore.edit(block)
    }

    private companion object {
        val KEY_THEME = stringPreferencesKey("theme_mode")
        val KEY_REVERSE = booleanPreferencesKey("reverse_mode")
        val KEY_ONLINE = booleanPreferencesKey("online_suggest")
        val KEY_AUTO_UPDATE = booleanPreferencesKey("auto_check_update")
        val KEY_LAST_DAY = stringPreferencesKey("last_day")
        val KEY_LAST_CHECK = longPreferencesKey("last_update_check")
        val KEY_SKIPPED = stringPreferencesKey("skipped_version")
        val KEY_HAPTIC = booleanPreferencesKey("haptic")
    }
}
