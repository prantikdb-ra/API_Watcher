// API Watcher - Injected Script (page context)
// Intercepts ALL fetch + XHR, emits two events:
//   __apiwatcher_net__      — every call (for passive network log)
//   __apiwatcher_captured__ — will be filtered in content.js for matched watches

(function () {
  'use strict';

  const originalFetch        = window.fetch;
  const originalXHROpen      = XMLHttpRequest.prototype.open;
  const originalXHRSend      = XMLHttpRequest.prototype.send;
  const originalXHRSetHeader = XMLHttpRequest.prototype.setRequestHeader;

  function emit(detail) {
    window.dispatchEvent(new CustomEvent('__apiwatcher_net__', { detail }));
  }

  // ── Fetch ──────────────────────────────────────────────────────────────────
  window.fetch = async function (...args) {
    const input = args[0];
    const init  = args[1] || {};
    let url = '', method = 'GET', requestHeaders = {};

    if (typeof input === 'string' || input instanceof URL) {
      url    = input.toString();
      method = (init.method || 'GET').toUpperCase();
      if (init.headers) {
        if (init.headers instanceof Headers) {
          init.headers.forEach((v, k) => { requestHeaders[k] = v; });
        } else {
          requestHeaders = { ...init.headers };
        }
      }
    } else if (input instanceof Request) {
      url    = input.url;
      method = input.method.toUpperCase();
      input.headers.forEach((v, k) => { requestHeaders[k] = v; });
    }

    let response, responseStatus = null, responseBody = null, contentType = '';
    try {
      response       = await originalFetch.apply(this, args);
      responseStatus = response.status;
      contentType    = response.headers.get('content-type') || '';
      try {
        const text = await response.clone().text();
        try { responseBody = JSON.parse(text); } catch { responseBody = text; }
      } catch {}
      return response;
    } finally {
      emit({ source: 'fetch', url, method, requestHeaders, responseStatus, responseBody, contentType });
    }
  };

  // ── XHR ───────────────────────────────────────────────────────────────────
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__aw_method__  = method ? method.toUpperCase() : 'GET';
    this.__aw_url__     = url ? url.toString() : '';
    this.__aw_headers__ = {};
    return originalXHROpen.apply(this, [method, url, ...rest]);
  };

  XMLHttpRequest.prototype.setRequestHeader = function (header, value) {
    if (this.__aw_headers__) this.__aw_headers__[header] = value;
    return originalXHRSetHeader.apply(this, arguments);
  };

  XMLHttpRequest.prototype.send = function (body) {
    const xhr = this;
    xhr.addEventListener('readystatechange', function () {
      if (xhr.readyState !== 4) return;
      const ct = xhr.getResponseHeader('content-type') || '';
      let responseBody = null;
      try { responseBody = ct.includes('json') ? JSON.parse(xhr.responseText) : xhr.responseText; } catch {}
      emit({
        source: 'xhr',
        url:            xhr.__aw_url__     || '',
        method:         xhr.__aw_method__  || 'GET',
        requestHeaders: xhr.__aw_headers__ || {},
        responseStatus: xhr.status,
        responseBody,
        contentType:    ct
      });
    });
    return originalXHRSend.apply(this, arguments);
  };
})();
