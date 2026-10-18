"""Remote WebDriver sessions on Selenium Grid 4 (hub :4444, 2x Chrome + 1x Firefox nodes)."""
import os

import pytest
from selenium import webdriver

GRID_URL = os.environ.get("GRID_URL", "http://localhost:4444")
# Browsers run inside the Grid's Docker network, where the backend is reachable as http://backend:8080.
WEB_BASE = os.environ.get("WEB_BASE", "http://backend:8080")
# The test runner itself posts score events to the API.
API_BASE = os.environ.get("API_BASE", "http://localhost:8080")


def _options(browser):
    opts = webdriver.ChromeOptions() if browser == "chrome" else webdriver.FirefoxOptions()
    opts.add_argument("--headless=new" if browser == "chrome" else "-headless")
    if browser == "chrome":
        opts.add_argument("--window-size=1280,900")
    return opts


@pytest.fixture(params=["chrome", "firefox"])
def driver(request):
    d = webdriver.Remote(command_executor=GRID_URL, options=_options(request.param))
    d.set_page_load_timeout(20)
    yield d
    d.quit()


@pytest.fixture
def web_base():
    return WEB_BASE


@pytest.fixture
def api_base():
    return API_BASE
