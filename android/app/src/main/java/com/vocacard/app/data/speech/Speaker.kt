package com.vocacard.app.data.speech

import android.content.Context
import android.speech.tts.TextToSpeech
import android.speech.tts.TextToSpeech.OnInitListener
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.Locale

/**
 * 단어 발음 재생.
 *
 * 안드로이드에 내장된 TTS 엔진을 쓴다. 오디오 파일을 앱에 넣지 않는 이유:
 *  - 1,222 단어의 음원을 담으면 APK 가 몇십 MB 씩 불어난다.
 *  - 사용자가 직접 추가한 단어는 어차피 음원이 없다.
 * 대신 엔진이 없거나 영어 음성 데이터가 없는 기기가 있으므로, **항상 조용히 실패**하고
 * [available] 로 상태를 알려 UI 가 버튼을 숨길 수 있게 한다.
 */
class Speaker(context: Context) {

    private val _available = MutableStateFlow(false)
    val available: StateFlow<Boolean> = _available.asStateFlow()

    /** 영어 음성 데이터가 없어 안내가 필요한 경우 메시지가 담긴다. */
    private val _problem = MutableStateFlow<String?>(null)
    val problem: StateFlow<String?> = _problem.asStateFlow()

    private var engine: TextToSpeech? = null

    init {
        val listener = OnInitListener { status ->
            if (status != TextToSpeech.SUCCESS) {
                _problem.value = "이 기기에서 음성 엔진을 쓸 수 없어요."
                return@OnInitListener
            }
            val tts = engine ?: return@OnInitListener
            val result = tts.setLanguage(Locale.US)
            if (result == TextToSpeech.LANG_MISSING_DATA ||
                result == TextToSpeech.LANG_NOT_SUPPORTED
            ) {
                _problem.value = "영어 음성 데이터가 없어요. 기기 설정에서 TTS 음성을 내려받아 주세요."
                return@OnInitListener
            }
            // 단어 하나씩 듣는 용도라 기본 속도보다 조금 느리게.
            tts.setSpeechRate(0.92f)
            tts.setPitch(1.0f)
            _available.value = true
        }
        engine = runCatching { TextToSpeech(context.applicationContext, listener) }.getOrNull()
        if (engine == null) _problem.value = "이 기기에서 음성 엔진을 쓸 수 없어요."
    }

    /** 지금 재생 중인 것을 끊고 [text] 를 읽는다. 준비되지 않았으면 아무 일도 하지 않는다. */
    fun speak(text: String) {
        val trimmed = text.trim()
        if (trimmed.isEmpty() || !_available.value) return
        runCatching {
            engine?.speak(trimmed, TextToSpeech.QUEUE_FLUSH, null, trimmed.hashCode().toString())
        }
    }

    fun stop() {
        runCatching { engine?.stop() }
    }

    fun shutdown() {
        runCatching {
            engine?.stop()
            engine?.shutdown()
        }
        engine = null
        _available.value = false
    }
}
