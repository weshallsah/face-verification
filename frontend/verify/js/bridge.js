// Tells the host app how the flow ended. The host is detected when an event is sent:
//   React Native WebView  window.ReactNativeWebView.postMessage(string)
//   Android WebView       window.AndroidBridge.postMessage(string)          (@JavascriptInterface)
//   iOS WKWebView         window.webkit.messageHandlers.faceVerification.postMessage(object)
//   plain web             nothing is posted; `closed` redirects to ?returnUrl (if it passed the allowlist)
//
// Message (RN and Android get it as a JSON string, iOS as the object itself):
//   { "source": "face-verification", "version": 1, "event": "<name>", "data": { ... } }
//
// Events:
//   verification_finished { verdict }       a final result is on screen. verdict is one of
//                                           VERIFIED | DUPLICATE | IN_REVIEW | ALREADY_VERIFIED
//   closed { reason: "done", verdict }      the person pressed Continue / Got it on a final result
//   camera_denied { }                       camera permission was refused
//   login_requested { url }                 "Log in to my account" was pressed (the page then goes to url)
//   support_requested { url }               "I think this is a mistake" was pressed (the page then opens url)

export const SOURCE = 'face-verification';
export const VERSION = 1;

export function detectHost(win) {
  if (typeof win.ReactNativeWebView?.postMessage === 'function') return 'react-native';
  if (typeof win.AndroidBridge?.postMessage === 'function') return 'android';
  if (typeof win.webkit?.messageHandlers?.faceVerification?.postMessage === 'function') return 'ios';
  return 'web';
}

export function createBridge({ win = window, returnUrl = null } = {}) {
  function emit(event, data = {}) {
    const msg = { source: SOURCE, version: VERSION, event, data };
    const host = detectHost(win);
    try {
      if (host === 'react-native') win.ReactNativeWebView.postMessage(JSON.stringify(msg));
      else if (host === 'android') win.AndroidBridge.postMessage(JSON.stringify(msg));
      else if (host === 'ios') win.webkit.messageHandlers.faceVerification.postMessage(msg);
      else if (event === 'closed' && returnUrl) {
        const url = new URL(returnUrl);
        if (data.verdict) url.searchParams.set('fv_verdict', data.verdict);   // informational: the app must re-check with its server
        win.location.assign(url.toString());
      }
    } catch (err) {
      console.error('bridge', err);   // a broken host must never break the page
    }
    return host;
  }
  return { emit, host: () => detectHost(win) };
}
