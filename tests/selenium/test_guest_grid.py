"""Part II Section 6.2.3: Guest Web Player flows on Selenium Grid 4 (run with: pytest -n 3 tests/selenium/)."""
import time
import uuid

import requests
from selenium.webdriver.common.by import By
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import WebDriverWait


def tid(name):
    return (By.CSS_SELECTOR, f'[data-testid="{name}"]')


def fresh_live_match(api_base):
    """A brand-new in-progress match so parallel tests never share state."""
    mid = f"sel-{uuid.uuid4().hex[:8]}"
    post = lambda t, p: requests.post(f"{api_base}/audit/v1/events",
                                      json={"event_id": f"{mid}-{t}", "match_id": mid, "type": t, "payload": p}, timeout=10)
    assert post("match_init", {"sport_id": "football", "home_team_id": "club-alpha-1", "away_team_id": "club-alpha-2"}).status_code == 201
    assert post("match_start", {}).status_code == 201
    return mid


def test_1_qr_resolution_and_zero_friction_load(driver, web_base):
    driver.get(f"{web_base}/q/m1-live")
    assert driver.current_url.endswith("/web/matches/match-m1/live")
    WebDriverWait(driver, 3).until(EC.visibility_of_element_located(tid("guest-video-player")))
    WebDriverWait(driver, 3).until(EC.visibility_of_element_located(tid("live-score-banner")))
    assert " - " in driver.find_element(*tid("live-score-banner")).text
    assert not driver.find_element(*tid("progressive-auth-modal")).is_displayed()


def test_2_guest_write_block_and_progressive_modal(driver, web_base, api_base):
    mid = fresh_live_match(api_base)
    driver.get(f"{web_base}/web/matches/{mid}/live")
    text = f"hello from guest {uuid.uuid4().hex[:6]}"
    field = WebDriverWait(driver, 5).until(EC.element_to_be_clickable(tid("chat-input-field")))
    field.send_keys(text)
    driver.find_element(*tid("chat-send-btn")).click()
    WebDriverWait(driver, 5).until(EC.visibility_of_element_located(tid("progressive-auth-modal")))
    assert text not in driver.find_element(*tid("chat-message-list")).text


def test_3_guest_cart_staging_and_realtime_score_sync(driver, web_base, api_base):
    mid = fresh_live_match(api_base)
    driver.get(f"{web_base}/web/matches/{mid}/live")
    WebDriverWait(driver, 5).until(EC.element_to_be_clickable(tid("add-to-guest-cart-btn"))).click()
    WebDriverWait(driver, 5).until(EC.text_to_be_present_in_element(tid("guest-cart-count"), "1"))
    banner = driver.find_element(*tid("live-score-banner"))
    assert banner.text == "0 - 0"
    time.sleep(1)  # let the page's WebSocket subscription settle
    r = requests.post(f"{api_base}/audit/v1/events", json={"event_id": f"{mid}-goal", "match_id": mid, "type": "score",
                                                           "payload": {"team_id": "club-alpha-1", "event_type": "goal"}}, timeout=10)
    assert r.status_code == 201
    started = time.monotonic()
    WebDriverWait(driver, 0.5, poll_frequency=0.05).until(EC.text_to_be_present_in_element(tid("live-score-banner"), "1 - 0"))
    assert time.monotonic() - started < 0.5
