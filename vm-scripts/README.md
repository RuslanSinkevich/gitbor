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

## Полезное

- Общая папка в VM: `/media/sf_gitbor` (нужно быть в группе `vboxsf` + reboot).
- Артефакты сборки: `~/gitbor/release/`.
- `dist:linux` собирается **только в Linux** (на Windows AppImage/deb не собрать).
- AppImage на Ubuntu 24+ для запуска требует `libfuse2`.
- Папки `vm-scripts/` и `linux-release/` — в `.gitignore`, в репозиторий не попадают.
