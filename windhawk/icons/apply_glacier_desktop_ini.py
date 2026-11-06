# -*- coding: utf-8 -*-
"""
Apply Glacier (星舰冰川) folder icons and desktop.ini across the user profile directory.
- Uses Path.home() and %LOCALAPPDATA%\\FolderAppearance\\glacier-icons by default
- Supports an optional `folder-icons.local.json` for custom user folder mappings
- Skips all NTFS junctions / reparse points
- Preserves LocalizedResourceName, [LocalizedFileNames], DefaultDropEffect, [ViewState], and InfoTip
- Writes UTF-16LE with BOM so Windows shell32.dll never garbles Chinese InfoTip text
- Sets Hidden+System attributes on desktop.ini and ReadOnly attribute on each directory
- Broadcasts SHChangeNotify to refresh Windows Explorer immediately
"""

import ctypes
import json
import os
import pathlib


HOME = pathlib.Path.home()
LOCAL_APP_DATA = pathlib.Path(os.environ.get("LOCALAPPDATA", str(HOME / "AppData" / "Local")))
ICO_DIR = LOCAL_APP_DATA / "FolderAppearance" / "glacier-icons"

# Default mapping for standard Windows Shell, Cloud, and common Developer directories
DEFAULT_FOLDER_TO_ICON: dict[str, str] = {
    # --- Tier 1: 领航键帽 ---
    "glacier":          "t1-glacier-orbit.ico",

    # --- Tier 2: 标准座舱键 (Windows Shell, Cloud & Dev Tooling) ---
    "Desktop":          "t2-monitor-desktop.ico",
    "Documents":        "t2-document-docs.ico",
    "Downloads":        "t2-download-inbox.ico",
    "Favorites":        "t2-star-favorites.ico",
    "Links":            "t2-link-shortcuts.ico",
    "Contacts":         "t2-people-contacts.ico",
    "Saved Games":      "t2-gamepad-games.ico",
    "Searches":         "t2-search-index.ico",
    "OneDrive":         "t2-cloud-personal.ico",
    "scoop":            "t2-package-scoop.ico",
    "go":               "t2-terminal-go.ico",
    ".claude":          "t2-spark-claude.ico",
    ".codex":           "t2-terminal-codex.ico",
    ".copilot":         "t2-spark-copilot.ico",
    ".vscode":          "t2-code-vscode.ico",
    ".ssh":             "t2-key-ssh.ico",
    ".config":          "t2-tools-config.ico",
    ".docker":          "t2-package-docker.ico",

    # --- Tier 3: 静默暗槽 (Background dotfiles, caches & AppData) ---
    ".aws":             "t3-cloud.ico",
    ".azure":           "t3-cloud.ico",
    ".cache":           "t3-package.ico",
    ".gnupg":           "t3-key.ico",
    ".gradle":          "t3-package.ico",
    ".local":           "t3-apps.ico",
    ".vcpkg":           "t3-package.ico",
    "AppData":          "t3-tools.ico",
}

DEFAULT_INFOTIPS: dict[str, str] = {
    "glacier": "Glacier（星舰冰川）设计系统：暗舱黑曜石、金星带 1px Oklab 刀锋与纯前端光学运镜引擎。",
}


def decode_ini_bytes(raw: bytes) -> str:
    for enc in ("utf-16", "utf-8-sig", "utf-8", "gbk", "cp1252"):
        try:
            return raw.decode(enc)
        except Exception:
            continue
    return raw.decode("utf-8", errors="replace")


def update_ini_text(existing_text: str, ico_path: pathlib.Path, default_infotip: str = "") -> str:
    if not existing_text.strip():
        lines = [
            "[.ShellClassInfo]",
            f"IconResource={ico_path},0",
        ]
        if default_infotip:
            lines.append(f"InfoTip={default_infotip}")
        return "\r\n".join(lines) + "\r\n"

    raw_lines = existing_text.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    out_lines: list[str] = []
    current_section = ""
    replaced_icon_resource = False
    has_infotip = False

    for line in raw_lines:
        stripped = line.strip()
        if stripped.startswith("[") and stripped.endswith("]"):
            if current_section.lower() == "[.shellclassinfo]":
                if not replaced_icon_resource:
                    out_lines.append(f"IconResource={ico_path},0")
                    replaced_icon_resource = True
                if not has_infotip and default_infotip:
                    out_lines.append(f"InfoTip={default_infotip}")
                    has_infotip = True
            current_section = stripped

        if current_section.lower() in ("[.shellclassinfo.a]", "[.shellclassinfo.w]"):
            continue

        if current_section.lower() == "[.shellclassinfo]":
            low = stripped.lower()
            if low.startswith("iconresource="):
                out_lines.append(f"IconResource={ico_path},0")
                replaced_icon_resource = True
                continue
            if low.startswith("iconfile="):
                out_lines.append(f"IconFile={ico_path}")
                continue
            if low.startswith("iconindex="):
                out_lines.append("IconIndex=0")
                continue
            if low.startswith("infotip="):
                has_infotip = True
                out_lines.append(stripped)
                continue

        if stripped or (out_lines and out_lines[-1] != ""):
            out_lines.append(stripped)

    if current_section.lower() == "[.shellclassinfo]":
        if not replaced_icon_resource:
            out_lines.append(f"IconResource={ico_path},0")
        if not has_infotip and default_infotip:
            out_lines.append(f"InfoTip={default_infotip}")

    while out_lines and out_lines[-1] == "":
        out_lines.pop()

    return "\r\n".join(out_lines) + "\r\n"


FILE_ATTRIBUTE_READONLY = 0x01
FILE_ATTRIBUTE_HIDDEN = 0x02
FILE_ATTRIBUTE_SYSTEM = 0x04
INVALID_FILE_ATTRIBUTES = 0xFFFFFFFF


def set_folder_and_ini_attributes(folder: pathlib.Path, ini_file: pathlib.Path):
    kernel32 = ctypes.windll.kernel32
    ini_attrs = kernel32.GetFileAttributesW(str(ini_file))
    if ini_attrs == INVALID_FILE_ATTRIBUTES:
        ini_attrs = 0
    kernel32.SetFileAttributesW(str(ini_file), ini_attrs | FILE_ATTRIBUTE_HIDDEN | FILE_ATTRIBUTE_SYSTEM)

    dir_attrs = kernel32.GetFileAttributesW(str(folder))
    if dir_attrs != INVALID_FILE_ATTRIBUTES:
        kernel32.SetFileAttributesW(str(folder), dir_attrs | FILE_ATTRIBUTE_READONLY)


def notify_shell_refresh(folders: list[pathlib.Path]):
    shell32 = ctypes.windll.shell32
    SHCNE_UPDATEDIR = 0x00001000
    SHCNE_ASSOCCHANGED = 0x08000000
    SHCNF_IDLIST = 0x0000
    SHCNF_PATHW = 0x0005
    SHCNF_FLUSHNOWAIT = 0x2000

    for f in folders:
        shell32.SHChangeNotify(SHCNE_UPDATEDIR, SHCNF_PATHW | SHCNF_FLUSHNOWAIT, ctypes.c_wchar_p(str(f)), None)
    shell32.SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, None, None)


def main():
    kernel32 = ctypes.windll.kernel32
    mapping = dict(DEFAULT_FOLDER_TO_ICON)

    # Optional user-local override file (gitignored)
    local_cfg = pathlib.Path(__file__).with_name("folder-icons.local.json")
    if local_cfg.exists():
        mapping.update(json.loads(local_cfg.read_text(encoding="utf-8")))

    backup_data: dict[str, str] = {}
    updated_folders: list[pathlib.Path] = []

    for folder_name, ico_name in sorted(mapping.items()):
        folder = HOME / folder_name
        if not folder.exists() or os.path.islink(folder):
            continue
        ico_path = ICO_DIR / ico_name
        if not ico_path.exists():
            continue

        ini_path = folder / "desktop.ini"
        existing_txt = ""
        if ini_path.exists():
            existing_txt = decode_ini_bytes(ini_path.read_bytes())
            backup_data[folder_name] = existing_txt
            kernel32.SetFileAttributesW(str(ini_path), 0x80)

        new_txt = update_ini_text(existing_txt, ico_path, DEFAULT_INFOTIPS.get(folder_name, ""))
        ini_path.write_bytes(new_txt.encode("utf-16"))
        set_folder_and_ini_attributes(folder, ini_path)
        updated_folders.append(folder)

    if backup_data:
        ICO_DIR.mkdir(parents=True, exist_ok=True)
        (ICO_DIR / "backup-desktop-ini.json").write_text(
            json.dumps(backup_data, ensure_ascii=False, indent=2), encoding="utf-8"
        )

    notify_shell_refresh(updated_folders)
    print(f"Updated desktop.ini for {len(updated_folders)} folders in {HOME}")


if __name__ == "__main__":
    main()
