"""Part II 6.3: nascon:// deep links bring the app to the foreground on the right screen (no login wall), and the
co-stream chat room syncs between the native app (Appium) and the Guest Web Player (Selenium Grid) within 3 s."""
import time
import uuid

import pytest
import requests
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait

from conftest import API_BASE, APP_PACKAGE, APPIUM_URL, WEB_BASE

SESSION = "cs-session-101"
ROOM = f"chat-{SESSION}"
MEMBER = {"email": "viewer@nascon.test", "password": "Nascon@26"}
LOGIN = "//*[@resource-id='login-screen' or @text='Sign in to your account']"
MATCH = "//*[@resource-id='match-screen' or @text='MATCH CENTRE']"
COSTREAM = f"//*[@resource-id='costream-screen' or @content-desc='Co-stream {SESSION}' or @text='LIVE CHAT']"


def desc(label):
    return f"//*[@content-desc='{label}']"


def wait_xpath(driver, xpath, timeout):
    return WebDriverWait(driver, timeout, poll_frequency=0.2).until(lambda d: d.find_elements(By.XPATH, xpath))


def fire(driver, url):
    """Same intent as `adb shell am start -W -a android.intent.action.VIEW -d <url>`; returns the start time."""
    started = time.monotonic()
    driver.execute_script("mobile: deepLink", {"url": url, "package": APP_PACKAGE})
    return started


def foreground_by(driver, deadline):
    while True:
        if driver.execute_script("mobile: queryAppState", {"appId": APP_PACKAGE}) == 4:  # 4 = running in foreground
            return time.monotonic() <= deadline
        if time.monotonic() > deadline:
            return False
        time.sleep(0.05)


@pytest.fixture(scope="module", autouse=True)
def costream_session():
    r = requests.post(f"{API_BASE}/audit/v1/costream/session", timeout=10, json={
        "session_id": SESSION, "host_player_id": "player-alpha-1", "layout": "grid_4",
        "participants": ["player-alpha-1", "player-alpha-2", "player-beta-1", "player-beta-2"]})
    assert r.status_code in (200, 201), r.text
    return r.json()


def test_0_appium_server_ready():
    r = requests.get(f"{APPIUM_URL}/status", timeout=10)
    assert r.status_code == 200 and r.json()["value"]["ready"] is True


def test_1_match_deep_link_opens_match_screen_without_login(mobile):
    mobile.execute_script("mobile: terminateApp", {"appId": APP_PACKAGE})
    started = fire(mobile, "nascon://entity/match-m1")
    assert foreground_by(mobile, started + 2.0), "app was not in the foreground within 2 s of the deep link"
    wait_xpath(mobile, MATCH, 15)
    assert not mobile.find_elements(By.XPATH, LOGIN), "deep link stopped at the login screen"


def test_2_stream_deep_link_opens_costream_without_login(mobile):
    mobile.execute_script("mobile: terminateApp", {"appId": APP_PACKAGE})
    started = fire(mobile, f"nascon://stream/{SESSION}")
    assert foreground_by(mobile, started + 2.0), "app was not in the foreground within 2 s of the deep link"
    wait_xpath(mobile, COSTREAM, 15)
    assert not mobile.find_elements(By.XPATH, LOGIN), "deep link stopped at the login screen"


def join_costream_as_member(mobile):
    fire(mobile, f"nascon://stream/{SESSION}")
    wait_xpath(mobile, COSTREAM, 15)
    if mobile.find_elements(By.XPATH, desc("Chat message")):
        return
    # Guest on the device: chat is a protected write, so sign in through the app's own prompt first.
    # The deep link remounts the screen, so retry the tap until the sign-in form is actually showing.
    for _ in range(5):
        for el in mobile.find_elements(By.XPATH, desc("Sign in to chat")):
            el.click()
            break
        try:
            wait_xpath(mobile, desc("Email"), 3)
            break
        except Exception:
            continue
    wait_xpath(mobile, desc("Email"), 10)[0].send_keys(MEMBER["email"])
    mobile.find_element(By.XPATH, desc("Password")).send_keys(MEMBER["password"])
    mobile.find_element(By.XPATH, desc("Sign in")).click()
    wait_xpath(mobile, "//*[contains(@content-desc, ' tab')]", 15)
    fire(mobile, f"nascon://stream/{SESSION}")
    wait_xpath(mobile, desc("Chat message"), 15)


def test_3_mobile_joins_costream_and_chat_syncs_with_web_within_3s(mobile, web):
    # The app joins cs-session-101 (as a guest viewer); a Grid browser opens the same co-stream page.
    fire(mobile, f"nascon://stream/{SESSION}")
    wait_xpath(mobile, COSTREAM, 15)
    web.get(f"{WEB_BASE}/web/costream/{SESSION}")
    chat = WebDriverWait(web, 10).until(lambda d: d.find_element(By.CSS_SELECTOR, '[data-testid="chat-message-list"]'))
    time.sleep(1.5)  # both room sockets are open

    token = requests.post(f"{API_BASE}/api/v1/auth/login", json=MEMBER, timeout=10).json()["token"]
    text = f"sync check {uuid.uuid4().hex[:6]}"
    r = requests.post(f"{API_BASE}/api/v1/chat", json={"chat_room_id": ROOM, "text": text},
                      headers={"Authorization": f"Bearer {token}"}, timeout=10)
    assert r.status_code == 201, r.text
    sent = time.monotonic()
    WebDriverWait(web, 3.0, poll_frequency=0.05).until(lambda d: text in chat.text)
    wait_xpath(mobile, f"//*[contains(@text, '{text}') or contains(@content-desc, '{text}')]", 3)
    assert time.monotonic() - sent < 3.0, "chat did not reach both surfaces within 3 s"
