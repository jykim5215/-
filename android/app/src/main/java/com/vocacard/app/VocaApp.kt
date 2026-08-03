package com.vocacard.app

import android.app.Application
import android.content.Context
import com.vocacard.app.data.archive.ArchiveRepository
import com.vocacard.app.data.db.VocaDatabase
import com.vocacard.app.data.mywords.WordRepository
import com.vocacard.app.data.settings.SettingsStore
import com.vocacard.app.data.speech.Speaker
import com.vocacard.app.data.suggest.DictionaryApi
import com.vocacard.app.data.suggest.Suggester
import com.vocacard.app.update.UpdateChecker

/**
 * DI 프레임워크 없이 수동으로 구성하는 의존성 컨테이너.
 * 앱 규모가 작고 빌드 실패 지점을 줄이는 편이 낫다고 판단했다.
 */
class AppContainer(context: Context) {
    private val appContext = context.applicationContext
    private val db = VocaDatabase.get(appContext)

    val settings = SettingsStore(appContext)
    val archive = ArchiveRepository(appContext, db.archiveDao())
    val words = WordRepository(db.wordDao(), db.studyStateDao(), db.sessionDao())
    val dictionary = DictionaryApi()
    val suggester = Suggester(archive, words, dictionary)
    val updateChecker = UpdateChecker(appContext)

    /** 단어 발음(TTS). 엔진이 없으면 available=false 로만 남고 앱은 그대로 동작한다. */
    val speaker = Speaker(appContext)
}

class VocaApp : Application() {
    lateinit var container: AppContainer
        private set

    override fun onCreate() {
        super.onCreate()
        container = AppContainer(this)
    }
}

val Context.container: AppContainer
    get() = (applicationContext as VocaApp).container
