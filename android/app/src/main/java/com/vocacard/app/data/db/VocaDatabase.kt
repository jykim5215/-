package com.vocacard.app.data.db

import android.content.Context
import androidx.room.Database
import androidx.room.Room
import androidx.room.RoomDatabase
import androidx.room.TypeConverters

@Database(
    entities = [
        WordEntity::class,
        StudyStateEntity::class,
        DayProgressEntity::class,
        ArchiveMarkEntity::class,
        SessionEntity::class,
    ],
    version = 1,
    exportSchema = false,
)
@TypeConverters(Converters::class)
abstract class VocaDatabase : RoomDatabase() {
    abstract fun wordDao(): WordDao
    abstract fun studyStateDao(): StudyStateDao
    abstract fun archiveDao(): ArchiveDao
    abstract fun sessionDao(): SessionDao

    companion object {
        @Volatile
        private var instance: VocaDatabase? = null

        fun get(context: Context): VocaDatabase = instance ?: synchronized(this) {
            instance ?: Room.databaseBuilder(
                context.applicationContext,
                VocaDatabase::class.java,
                "vocacard.db",
            ).fallbackToDestructiveMigration().build().also { instance = it }
        }
    }
}
