"""Part II Section 6.2.3: Guest Web Player flows on Selenium Grid 4 (run with: pytest -n 3 tests/selenium/)."""
import time
import uuid

import requests
from selenium.webdriver.common.action_chains import ActionChains
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
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


CONTRAST_JS = """
function lum(c){var v=c.match(/[\\d.]+/g).slice(0,3).map(function(x){x/=255;return x<=0.03928?x/12.92:Math.pow((x+0.055)/1.055,2.4);});
  return 0.2126*v[0]+0.7152*v[1]+0.0722*v[2];}
function bg(el){for(;el;el=el.parentElement){var s=getComputedStyle(el);if(s.backgroundImage!=='none')return null;
  var m=s.backgroundColor.match(/[\\d.]+/g);if(m&&(m.length<4||+m[3]>0.99))return s.backgroundColor;}return 'rgb(255,255,255)';}
var out=[];document.querySelectorAll(arguments[0]).forEach(function(el){var b=bg(el);if(!b||!el.offsetParent)return;
  var f=lum(getComputedStyle(el).color),k=lum(b);out.push([el.id||el.className||el.tagName,(Math.max(f,k)+0.05)/(Math.min(f,k)+0.05)]);});
return out;"""


def test_4_wcag_aa_dom_inspection(driver, web_base):
    """NFR-8: contrast >= 4.5:1, touch targets >= 48x48 CSS px, ARIA on media/live regions, keyboard operable."""
    driver.get(f"{web_base}/web/matches/match-m1/live")
    WebDriverWait(driver, 5).until(EC.visibility_of_element_located(tid("guest-video-player")))
    ratios = driver.execute_script(CONTRAST_JS, "h1, h2, p, span, li, label, button, a")
    assert ratios, "no text elements measured"
    low = [(name, round(r, 2)) for name, r in ratios if r < 4.5]
    assert not low, f"contrast below 4.5:1: {low}"

    small = driver.execute_script("""return Array.from(document.querySelectorAll('button, input, select, textarea, .btn'))
      .filter(function(e){return e.offsetParent;}).map(function(e){var r=e.getBoundingClientRect();return [e.id||e.textContent.trim(), r.width, r.height];})
      .filter(function(x){return x[1] < 48 || x[2] < 48;});""")
    assert not small, f"touch targets under 48x48 px: {small}"

    video = driver.find_element(By.ID, "video")
    assert video.get_attribute("aria-label") and video.get_attribute("controls") is not None
    banner = driver.find_element(*tid("live-score-banner"))
    assert banner.get_attribute("role") == "status" and banner.get_attribute("aria-live") == "polite"
    assert driver.find_element(*tid("chat-message-list")).get_attribute("role") == "log"
    modal = driver.find_element(*tid("progressive-auth-modal"))
    assert modal.get_attribute("role") == "dialog" and modal.get_attribute("aria-modal") == "true"
    unlabeled = driver.execute_script("""return Array.from(document.querySelectorAll('input')).filter(function(i){
      return !i.getAttribute('aria-label') && !document.querySelector('label[for="' + i.id + '"]');}).map(function(i){return i.id;});""")
    assert not unlabeled, f"inputs without a label: {unlabeled}"

    # Keyboard only: Tab to "Add to cart" and press Enter.
    for _ in range(40):
        ActionChains(driver).send_keys(Keys.TAB).perform()
        if driver.switch_to.active_element.get_attribute("id") == "addcart":
            break
    assert driver.switch_to.active_element.get_attribute("id") == "addcart", "Add to cart is not reachable with Tab"
    driver.switch_to.active_element.send_keys(Keys.ENTER)
    WebDriverWait(driver, 5).until(EC.text_to_be_present_in_element(tid("guest-cart-count"), "1"))
