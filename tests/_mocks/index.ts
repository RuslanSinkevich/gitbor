/**
 * Общие mock-фабрики и узкие mock-типы для тестов SkyFork.
 *
 * Подход: каждая фабрика возвращает «ровно те поля, что используются», а
 * не Partial<полный класс>. При необходимости новый кейс расширяет тип
 * добавлением одного-двух полей в соответствующий mock — никаких
 * god-объектов «всё со всеми методами».
 */
export * from './git';
export * from './queue';
export * from './safety';
export * from './state';
export * from './bridge';
export * from './registry';
