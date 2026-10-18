"""Appium 2 + UiAutomator2 session on the installed League Ops APK (package com.leagueops.app).

Needs: a phone (USB debugging) or emulator in `adb devices`, the APK installed with its Server setting pointing at this
laptop, and `appium --port 4723` running.  Run:
    pytest tests/appium -v -p no:cacheprovider --junitxml=tests/reports/appium-report.xml
"""
import os

import pytest

APPIUM_URL = os.environ.get("APPIUM_URL", "http://127.0.0.1:4723")
APP_PACKAGE = os.environ.get("APP_PACKAGE", "com.leagueops.app")
API_BASE = os.environ.get("API_BASE", "http://localhost:8080")
GRID_URL = os.environ.get("GRID_URL", "http://localhost:4444")
# Grid browsers live on the compose network, where the API is reachable as http://backend:8080.
WEB_BASE = os.environ.get("WEB_BASE", "http://backend:8080")


def _caps():
    caps = {
        "platformName": "Android",
        "appium:automationName": "UiAutomator2",
        "appium:appPackage": APP_PACKAGE,
        "appium:appActivity": ".MainActivity",
        "appium:noReset": True,
        "appium:autoGrantPermissions": True,
        "appium:newCommandTimeout": 180,
    }
    if os.environ.get("ANDROID_SERIAL"):
        caps["appium:udid"] = os.environ["ANDROID_SERIAL"]
    if os.environ.get("APK_PATH"):
        caps["appium:app"] = os.path.abspath(os.environ["APK_PATH"])
    return caps


def _remote():
    try:
        from appium import webdriver
        from appium.options.common import AppiumOptions

        opts = AppiumOptions()
        opts.load_capabilities(_caps())
        return webdriver.Remote(APPIUM_URL, options=opts)
    except ImportError:
        # Appium speaks W3C WebDriver, so the plain Selenium client drives it just as well.
        from selenium import webdriver
        from selenium.webdriver.common.options import ArgOptions

        opts = ArgOptions()
        for key, value in _caps().items():
            opts.set_capability(key, value)
        return webdriver.Remote(command_executor=APPIUM_URL, options=opts)


@pytest.fixture(scope="module")
def mobile():
    d = _remote()
    d.implicitly_wait(0)
    yield d
    d.quit()


@pytest.fixture
def web():
    """A Grid Chrome session on the Guest Web Player, for cross-surface checks."""
    from selenium import webdriver

    opts = webdriver.ChromeOptions()
    opts.add_argument("--headless=new")
    d = webdriver.Remote(command_executor=GRID_URL, options=opts)
    d.set_page_load_timeout(20)
    yield d
    d.quit()
