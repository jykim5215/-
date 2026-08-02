package com.vocacard.app.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import com.vocacard.app.AppContainer

/** 수동 DI 컨테이너를 ViewModel 에 넘겨 주는 최소한의 팩토리. */
class VocaViewModelFactory(
    private val container: AppContainer,
    private val creators: Map<Class<*>, (AppContainer) -> ViewModel>,
) : ViewModelProvider.Factory {
    @Suppress("UNCHECKED_CAST")
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        val creator = creators[modelClass]
            ?: throw IllegalArgumentException("Unknown ViewModel: ${modelClass.name}")
        return creator(container) as T
    }
}

fun factoryOf(container: AppContainer, vararg pairs: Pair<Class<*>, (AppContainer) -> ViewModel>) =
    VocaViewModelFactory(container, pairs.toMap())
