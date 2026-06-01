# vm-scripts — шпаргалка

Скрипты для сборки/запуска GitBor под Linux в VirtualBox (Ubuntu).
Лежат в общей папке: на Windows — `D:\Users\Admin\Desktop\Skycode\gitbor\vm-scripts\`,
в VM — `/media/sf_gitbor/vm-scripts/`.

> Все скрипты в формате LF (Unix). Запуск: `bash <путь>`.

## Скрипты

| Файл | Когда запускать | Что делает |
|------|-----------------|------------|
| `vm-setup.sh` | Один раз на свежей Ubuntu | Ставит Guest Additions, group vboxsf, git, Node.js 22, библиотеки для Electron. После — `sudo reboot` |
| `project-setup.sh` | Один раз / при пересоздании | Копирует проект из общей папки в `~/gitbor`, ставит зависимости (root + renderer), правит chrome-sandbox |
| `dev.sh` | Каждый запуск в dev | Чинит sandbox (если нужно) и поднимает `npm run dev` |
| `release-linux.sh` | После правок на Windows, для релиза | Синкает код Win→VM, ставит зависимости, собирает AppImage+deb, кладёт в `linux-release/` (видно на Windows) |
| `copy-release.sh` | Если собрал вручную | Просто копирует готовые артефакты из `~/gitbor/release` в общую папку |
| `install-appimage.sh` | Поставить AppImage с ярлыком | Кладёт AppImage в `~/Applications`, создаёт иконку и ярлык в меню (без админа). Авто-апдейт заменяет файл на месте |
| `install-deb.sh` | Поставить как обычный юзер (Ubuntu/Debian) | Сносит старую установку (AppImage + deb), ставит свежий `.deb` через apt. Иконка и меню — автоматом. Авто-апдейта нет |
| `uninstall-clean.sh` | Полностью снести GitBor | Удаляет deb, AppImage, ярлыки, иконки, конфиг (`~/.config/GitBor`), кэш, остатки в `/opt`. Для чистой переустановки |

## Команды

```bash
# первая настройка системы (один раз)
bash /media/sf_gitbor/vm-scripts/vm-setup.sh
sudo reboot

# развернуть проект в ~/gitbor (один раз)
bash /media/sf_gitbor/vm-scripts/project-setup.sh

# запустить GitBor в dev
bash ~/gitbor/vm-scripts/dev.sh

# собрать релизные Linux-артефакты после правок на Windows
bash /media/sf_gitbor/vm-scripts/release-linux.sh

# поставить AppImage с ярлыком в меню (без админа)
bash /media/sf_gitbor/vm-scripts/install-appimage.sh

# поставить как обычный юзер через deb (иконка автоматом, без авто-апдейта)
bash /media/sf_gitbor/vm-scripts/install-deb.sh
```

## Релизный цикл Linux

1. **Windows:** поправил код, поднял `version` в `package.json` И `src/renderer/package.json` (должны совпадать).
2. **VM:** `bash /media/sf_gitbor/vm-scripts/release-linux.sh`
3. **Windows:** залить 3 файла из `linux-release\` в бакет `gitbor/stable/linux/` (перезаписать):
   - `GitBor-X.Y.Z.AppImage`
   - `gitbor_X.Y.Z_amd64.deb`
   - `latest-linux.yml`
4. **Проверка:** `https://storage.yandexcloud.net/gitbor/stable/linux/latest-linux.yml` → HTTP 200.

Сайт трогать не надо — версия резолвится из `latest-linux.yml` автоматически.

## Запуск AppImage (3 ситуации)

```bash
cd ~/gitbor/release
chmod +x GitBor-0.1.XX.AppImage

# обычный запуск
./GitBor-0.1.XX.AppImage

# нет libfuse2 (Ubuntu 24+, часть RedOS/Astra)
./GitBor-0.1.XX.AppImage --appimage-extract-and-run

# + зарезан sandbox (Ubuntu 24 AppArmor)
./GitBor-0.1.XX.AppImage --appimage-extract-and-run --no-sandbox
```

Имя файла регистрозависимо: `GitBor` с большой **B** (помогает Tab-автодополнение).

## Авто-обновление (electron-updater)

- Работает только для **AppImage** (deb — через apt, авто-апдейта нет).
- Feed-URL по платформе зашит в `src/main/AppUpdater.ts` → Linux читает
  `stable/linux/latest-linux.yml`.
- Срабатывает, только если версия в бакете **выше** установленной.
- Стартовая проверка ~8 c после запуска, модалка как на Windows.
- **Важно:** авто-апдейт работает начиная с версии **0.1.12** (в ней появился
  фикс feed-URL). Версии 0.1.11 и раньше его не имеют — обновить с них
  можно только вручную.
- Лог: `~/.config/GitBor/logs/ГГГГ-ММ-ДД.log` (нужен `GITBOR_LOG_LEVEL=debug`).

## Грабли (с чем столкнулись)

| Симптом | Причина | Решение |
|---------|---------|---------|
| `$'\r': command not found` | скрипт сохранён в Windows (CRLF) | конвертировать в LF |
| `Cannot find module '@rollup/rollup-linux-x64-gnu'` | у рендерера свой `node_modules` (Windows-бинарь) | в `src/renderer`: удалить `node_modules` + `package-lock.json`, `npm install` |
| `ERESOLVE` на `eslint-plugin-jsx-a11y` | плагин не объявил поддержку eslint 10 | `npm install --legacy-peer-deps` |
| `chrome-sandbox ... mode 4755` (dev/deb) | sandbox не setuid-root | `chown root:root` + `chmod 4755` (делает `dev.sh`) |
| `error loading libfuse.so.2` | нет FUSE | `--appimage-extract-and-run` или `sudo apt install libfuse2` |
| `SUID sandbox ... aborting` (AppImage) | userns зарезан AppArmor | `--no-sandbox` или `sysctl kernel.apparmor_restrict_unprivileged_userns=0` |
| `/media/sf_gitbor` пустая | не в группе `vboxsf` без reboot | `usermod -aG vboxsf $USER` + reboot |
| сайт отдаёт старую версию | кэш резолвера `revalidate: 60` | подождать ~60 c |

## Полезное

- Общая папка в VM: `/media/sf_gitbor` (нужно быть в группе `vboxsf` + reboot).
- Артефакты сборки: `~/gitbor/release/`. Установленный AppImage: `~/Applications/GitBor.AppImage`.
- `dist:linux` собирается **только в Linux** (на Windows AppImage/deb не собрать).
- Сборка только **x86_64**. Для ARM-Linux нужен отдельный таргет `--arm64`.
- Версию поднимать **в двух местах**: `package.json` и `src/renderer/package.json` (должны совпадать).
- Папки `vm-scripts/` (если вернёшь в игнор) и `linux-release/` — билд-выхлоп.
- РФ-ОС (RedOS, Astra, ALT, РОСА) — все glibc/x86_64, один AppImage работает на всех.
