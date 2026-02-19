"""py2app setup for bundling Ludos Sync menubar as a macOS .app."""
from setuptools import setup

APP = ["ludos_sync_menubar.py"]
OPTIONS = {
    "argv_emulation": False,
    "plist": {
        "LSUIElement": True,
        "CFBundleName": "Ludos Sync",
        "CFBundleShortVersionString": "0.1.0",
        "CFBundleIdentifier": "com.ludos.sync.menubar",
    },
    "packages": ["rumps"],
}

setup(
    app=APP,
    options={"py2app": OPTIONS},
    setup_requires=["py2app"],
)
