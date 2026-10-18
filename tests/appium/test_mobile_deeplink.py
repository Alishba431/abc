"""Part II 6.3: nascon:// deep links bring the app to the foreground on the right screen (no login wall), and the
co-stream chat room stays in sync between the native app and the Guest Web Player."""
import time
import uuid

import pytest
import requests
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

from conftest import API_BASE, APP_PACKAGE, WEB_BASE

SESSION = "cs-session-101"
ROOM = f"chat-{SESSION}"
LOGIN = "//*[@resource-id='login-screen' or @text='Sign in to your account']"


def any_of(*parts):
    return "//*[" + " or ".join(parts) + "]"


def contains(text):
    return any_of(f"contains(@text, '{text}')", f"contains(@content-desc, '{text}')")


def open_link(driver, url):
    driver.execute_script("mobile: deepLink", {"url": url, "package": APP_PACKAGE})


def in_foreground_within(driver, seconds):
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        if driver.execute_script("mobile: queryAppState", {"appId": APP_PACKAGE}) == 4:  # 4 = running in foreground
            return True
        time.sleep(0.1)
    return False


def wait_xpath(driver, xpath, timeout):
    return WebDriverWait(driver, timeout, poll_frequency=0.25).until(lambda d: d.find_elements(By.XPATH, xpath))


@pytest.fixture(scope="module", autouse=True)
def costream_session():
    r = requests.post(f"{API_BASE}/audit/v1/costream/session", timeout=10, json={
        "session_id": SESSION, "host_player_id": "player-alpha-1", "layout": "grid_4",
        "participants": ["player-alpha-1", "player-alpha-2", "player-beta-1", "player-beta-2"]})
    assert r.status_code in (200, 201), r.text
    return r.json()


def test_1_match_deep_link_opens_match_screen_without_login(mobile):
    mobile.execute_script("mobile: terminateApp", {"appId": APP_PACKAGE})
    open_link(mobile, "nascon://entity/match-m1")
    assert in_foreground_within(mobile, 2.0), "app was not in the foreground within 2 s of the deep link"
    wait_xpath(mobile, any_of("@resource-id='match-screen'", "@text='MATCH CENTRE'"), 15)
    assert not mobile.find_elements(By.XPATH, LOGIN), "deep link stopped at the login screen"


def test_2_stream_deep_link_opens_costream_without_login(mobile):
    mobile.execute_script("mobile: terminateApp", {"appId": APP_PACKAGE})
    open_link(mobile, f"nascon://stream/{SESSION}")
    assert in_foreground_within(mobile, 2.0), "app was not in the foreground within 2 s of the deep link"
    wait_xpath(mobile, any_of("@resource-id='costream-screen'", f"@content-desc='Co-stream {SESSION}'", "@text='LIVE CHAT'"), 15)
    assert not mobile.find_elements(By.XPATH, LOGIN), "deep link stopped at the login screen"


def test_3_costream_chat_syncs_across_mobile_and_web(mobile, web):
    open_link(mobile, f"nascon://stream/{SESSION}")
    wait_xpath(mobile, any_of("@resource-id='costream-screen'", "@text='LIVE CHAT'"), 15)
    web.get(f"{WEB_BASE}/web/costream/{SESSION}")
    WebDriverWait(web, 10).until(lambda d: d.find_element(By.CSS_SELECTOR, '[data-testid="chat-message-list"]'))
    time.sleep(1)  # both surfaces' room sockets are open

    token = requests.post(f"{API_BASE}/api/v1/auth/login", timeout=10,
                          json={"email": "viewer@nascon.test", "password": "Nascon@26"}).json()["token"]
    text = f"sync check {uuid.uuid4().hex[:6]}"
    r = requests.post(f"{API_BASE}/api/v1/chat", json={"chat_room_id": ROOM, "text": text},
                      headers={"Authorization": f"Bearer {token}"}, timeout=10)
    assert r.status_code == 201, r.text

    wait_xpath(mobile, contains(text), 5)
    WebDriverWait(web, 5, poll_frequency=0.1).until(
        lambda d: text in d.find_element(By.CSS_SELECTOR, '[data-testid="chat-message-list"]').text)
